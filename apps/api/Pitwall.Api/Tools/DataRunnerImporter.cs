using System.Text.Json;
using Amazon.Runtime;
using Amazon.S3;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Errors;
using Pitwall.Services.Storage;

namespace Pitwall.Tools;

/// <summary>
/// One-off: brings DataRunner's own support history into Pitwall, so moving to Pitwall loses no
/// conversation. Reads DataRunner's database (the <c>legacy_*</c> tables its MoveSupportToPitwall
/// migration left, or the original names if that has not run yet) and copies, into the product
/// <c>Import:ProductSlug</c> (default <c>datarunner</c>):
///
///   - tickets, keeping their ids — notifications and e-mails already sent link to them by id;
///   - messages, with team replies attributed to the staff member of the same e-mail when there is one;
///   - attachments, bytes included, from DataRunner's bucket (or folder) into Pitwall's store;
///   - the last 30 days of server errors, with signatures recomputed the Pitwall way so a ticket
///     and its errors still group together.
///
/// Idempotent: a ticket, message, attachment or error already in Pitwall (same id) is skipped,
/// so an interrupted run is simply run again.
///
///   dotnet Pitwall.Api.dll import-datarunner [--dry-run]
///   Import__SourceConnectionString=Host=…;Database=datarunner;…
///   Import__SourceStorage__Provider=s3|fs, …__Path | …__ServiceUrl, …__AccessKey, …__SecretKey, …__Bucket, …__Region
/// </summary>
public sealed class DataRunnerImporter(PitwallDb db, AttachmentStore store, IConfiguration config, ILogger<DataRunnerImporter> logger)
{
    public sealed record Result(int Tickets, int Messages, int Attachments, int MissingBlobs, int ServerErrors, int Skipped);

    public async Task<Result> RunAsync(bool dryRun, CancellationToken ct)
    {
        var source = config["Import:SourceConnectionString"]
            ?? throw new InvalidOperationException("Import:SourceConnectionString (DataRunner's database) is required.");
        var slug = config["Import:ProductSlug"] ?? "datarunner";
        var product = await db.Products.FirstOrDefaultAsync(p => p.Slug == slug, ct)
            ?? throw new InvalidOperationException($"No product '{slug}' in Pitwall. Create it in the console first.");
        var sourceBlobs = SourceBlobs();

        await using var conn = new NpgsqlConnection(source);
        await conn.OpenAsync(ct);
        var prefix = await TableExistsAsync(conn, "legacy_support_tickets", ct) ? "legacy_"
            : await TableExistsAsync(conn, "support_tickets", ct) ? ""
            : throw new InvalidOperationException("Neither legacy_support_tickets nor support_tickets exists in the source database.");
        logger.LogInformation("Importing DataRunner support from {Prefix}support_* into product {Slug}{Dry}", prefix, slug, dryRun ? " (dry run)" : "");

        var staffByEmail = await db.Staff.AsNoTracking().ToDictionaryAsync(s => s.Email.ToLowerInvariant(), s => (s.Id, s.Name), ct);

        // ── Server errors first: their old → new signatures re-label the tickets. ──
        var signatureMap = new Dictionary<string, string>();
        var errorRows = 0;
        var existingErrors = (await db.ServerErrors.AsNoTracking().Where(e => e.ProductId == product.Id).Select(e => e.Id).ToListAsync(ct)).ToHashSet();
        if (await TableExistsAsync(conn, $"{prefix}server_errors", ct))
        {
            await using var cmd = new NpgsqlCommand($"""
                SELECT id, trace_id, workspace_id, user_id, method, path, route_template, status_code,
                       exception_type, message, stack_trace, signature, release, occurred_at
                FROM {prefix}server_errors WHERE occurred_at > now() - interval '30 days'
                """, conn);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var id = r.GetGuid(0);
                var type = r.GetString(8);
                var route = r.IsDBNull(6) ? r.GetString(5) : r.GetString(6);
                var stack = r.IsDBNull(10) ? null : r.GetString(10);
                var newSignature = ErrorSignature.Compute(type, route, stack, product.Settings.OwnFramePrefixes);
                signatureMap.TryAdd(r.GetString(11), newSignature);
                if (existingErrors.Contains(id)) continue;
                db.ServerErrors.Add(new ServerError
                {
                    Id = id, ProductId = product.Id, TraceId = r.GetString(1),
                    CustomerRef = r.IsDBNull(2) ? null : r.GetGuid(2).ToString(),
                    UserRef = r.IsDBNull(3) ? null : r.GetGuid(3).ToString(),
                    Method = r.GetString(4), Path = r.GetString(5), RouteTemplate = r.IsDBNull(6) ? null : r.GetString(6),
                    StatusCode = r.GetInt32(7), ExceptionType = type, Message = r.GetString(9), StackTrace = stack,
                    Signature = newSignature, Release = r.IsDBNull(12) ? null : r.GetString(12),
                    OccurredAt = DateTime.SpecifyKind(r.GetDateTime(13), DateTimeKind.Utc), ReceivedAt = DateTime.UtcNow,
                });
                errorRows++;
            }
        }

        // ── Tickets ──
        var existingTickets = (await db.Tickets.AsNoTracking().Where(t => t.ProductId == product.Id).Select(t => new { t.Id, t.Code }).ToListAsync(ct));
        var existingIds = existingTickets.Select(t => t.Id).ToHashSet();
        var existingCodes = existingTickets.Select(t => t.Code).ToHashSet();
        var imported = new HashSet<Guid>();
        var skipped = 0;
        await using (var cmd = new NpgsqlCommand($"""
            SELECT t.id, t.workspace_id, w.name, t.code, t.opened_by, u.email, u.display_name, t.title, t.body,
                   t.category, t.severity, t.status, a.email, t.route, t.diagnostics::text, t.trace_ids::text,
                   t.error_signature, t.fixed_in, t.resolution_note, t.created_at, t.updated_at,
                   t.last_customer_message_at, t.last_admin_message_at, t.resolved_at, t.closed_at
            FROM {prefix}support_tickets t
            LEFT JOIN workspaces w ON w.id = t.workspace_id
            LEFT JOIN users u ON u.id = t.opened_by
            LEFT JOIN users a ON a.id = t.assignee_id
            ORDER BY t.created_at
            """, conn))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                var id = r.GetGuid(0);
                var code = r.GetString(3);
                if (existingIds.Contains(id)) { skipped++; continue; }
                if (existingCodes.Contains(code))
                {
                    logger.LogWarning("Ticket {Code} ({Id}) skipped: the code is already taken in Pitwall by another ticket", code, id);
                    skipped++;
                    continue;
                }
                var oldSignature = r.IsDBNull(16) ? null : r.GetString(16);
                var assigneeEmail = r.IsDBNull(12) ? null : r.GetString(12).ToLowerInvariant();
                db.Tickets.Add(new Ticket
                {
                    Id = id, ProductId = product.Id, Code = code,
                    CustomerRef = r.GetGuid(1).ToString(), CustomerName = Str(r, 2),
                    OpenedByRef = r.IsDBNull(4) ? null : r.GetGuid(4).ToString(),
                    OpenedByEmail = Str(r, 5), OpenedByName = Str(r, 6) ?? Str(r, 5),
                    Title = r.GetString(7), Body = r.GetString(8),
                    Category = TicketCategories.IsValid(Str(r, 9)) ? r.GetString(9) : TicketCategories.Bug,
                    Severity = TicketSeverities.IsValid(Str(r, 10)) ? r.GetString(10) : TicketSeverities.Normal,
                    Status = TicketStatuses.IsValid(Str(r, 11)) ? r.GetString(11) : TicketStatuses.Open,
                    AssigneeId = assigneeEmail is not null && staffByEmail.TryGetValue(assigneeEmail, out var staff) ? staff.Id : null,
                    Route = Str(r, 13), DiagnosticsJson = Str(r, 14),
                    TraceIds = ParseArray(Str(r, 15)),
                    ErrorSignature = oldSignature is null ? null : signatureMap.GetValueOrDefault(oldSignature, oldSignature),
                    FixedIn = Str(r, 17), ResolutionNote = Str(r, 18),
                    CreatedAt = Utc(r, 19)!.Value, UpdatedAt = Utc(r, 20)!.Value,
                    LastCustomerMessageAt = Utc(r, 21), LastTeamMessageAt = Utc(r, 22),
                    ResolvedAt = Utc(r, 23), ClosedAt = Utc(r, 24),
                });
                imported.Add(id);
            }
        }

        // ── Messages ──
        var messages = 0;
        var messageFromTeam = new Dictionary<Guid, bool>();
        await using (var cmd = new NpgsqlCommand($"""
            SELECT m.id, m.ticket_id, m.author_id, u.email, u.display_name, m.from_admin, m.internal, m.body, m.created_at
            FROM {prefix}support_ticket_messages m LEFT JOIN users u ON u.id = m.author_id
            ORDER BY m.created_at
            """, conn))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                var ticketId = r.GetGuid(1);
                messageFromTeam[r.GetGuid(0)] = r.GetBoolean(5);
                if (!imported.Contains(ticketId)) continue;
                var fromTeam = r.GetBoolean(5);
                var email = Str(r, 3)?.ToLowerInvariant();
                var staff = fromTeam && email is not null && staffByEmail.TryGetValue(email, out var s) ? s : ((Guid Id, string Name)?)null;
                db.TicketMessages.Add(new TicketMessage
                {
                    Id = r.GetGuid(0), TicketId = ticketId, ProductId = product.Id,
                    FromTeam = fromTeam, Internal = fromTeam && r.GetBoolean(6),
                    AuthorRef = staff?.Id.ToString() ?? (r.IsDBNull(2) ? null : r.GetGuid(2).ToString()),
                    AuthorName = staff?.Name ?? Str(r, 4) ?? Str(r, 3),
                    Body = r.GetString(7), CreatedAt = Utc(r, 8)!.Value,
                });
                messages++;
            }
        }

        // ── Attachments (bytes copied) ──
        var attachments = 0;
        var missing = 0;
        var pending = new List<(Guid Id, Guid TicketId, Guid? MessageId, string? UploadedBy, string Kind, string Name, string ContentType, long Size, string Key, string? Meta, DateTime CreatedAt)>();
        await using (var cmd = new NpgsqlCommand($"""
            SELECT id, ticket_id, message_id, uploaded_by, kind, name, content_type, size_bytes, storage_key, meta::text, created_at
            FROM {prefix}support_ticket_attachments ORDER BY created_at
            """, conn))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                if (!imported.Contains(r.GetGuid(1))) continue;
                pending.Add((r.GetGuid(0), r.GetGuid(1), r.IsDBNull(2) ? null : r.GetGuid(2),
                    r.IsDBNull(3) ? null : r.GetGuid(3).ToString(), r.GetString(4), r.GetString(5), r.GetString(6),
                    r.GetInt64(7), r.GetString(8), Str(r, 9), Utc(r, 10)!.Value));
            }
        }
        foreach (var a in pending)
        {
            var key = AttachmentStore.Key(product.Id, a.TicketId, a.Id, a.ContentType);
            if (!dryRun)
            {
                await using var bytes = sourceBlobs is null ? null : await sourceBlobs.GetAsync(a.Key, ct);
                if (bytes is null)
                {
                    logger.LogWarning("Attachment {Id} ({Key}) not found in the source storage; the row is skipped", a.Id, a.Key);
                    missing++;
                    continue;
                }
                await store.PutAsync(key, bytes, a.ContentType, ct);
            }
            db.TicketAttachments.Add(new TicketAttachment
            {
                Id = a.Id, TicketId = a.TicketId, ProductId = product.Id, MessageId = a.MessageId,
                FromTeam = a.MessageId is Guid mid && messageFromTeam.GetValueOrDefault(mid),
                UploadedByRef = a.UploadedBy, Kind = AttachmentKinds.All.Contains(a.Kind) ? a.Kind : AttachmentKinds.File,
                Name = a.Name, ContentType = a.ContentType, SizeBytes = a.Size, StorageKey = key, MetaJson = a.Meta,
                CreatedAt = a.CreatedAt,
            });
            attachments++;
        }

        var result = new Result(imported.Count, messages, attachments, missing, errorRows, skipped);
        if (dryRun)
        {
            logger.LogInformation("Dry run: would import {Result}; nothing written", result);
            return result;
        }
        await db.SaveChangesAsync(ct);
        logger.LogInformation("Imported {Result}", result);
        return result;
    }

    private IBlobStore? SourceBlobs()
    {
        var s = config.GetSection("Import:SourceStorage");
        var provider = s["Provider"];
        if (string.Equals(provider, "s3", StringComparison.OrdinalIgnoreCase))
        {
            var s3Config = new AmazonS3Config { ForcePathStyle = true };
            if (!string.IsNullOrWhiteSpace(s["ServiceUrl"])) s3Config.ServiceURL = s["ServiceUrl"];
            else s3Config.RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(s["Region"] ?? "us-east-1");
            return new S3BlobStore(new AmazonS3Client(new BasicAWSCredentials(s["AccessKey"], s["SecretKey"]), s3Config),
                s["Bucket"] ?? throw new InvalidOperationException("Import:SourceStorage:Bucket is required."));
        }
        if (string.Equals(provider, "fs", StringComparison.OrdinalIgnoreCase))
            return new FileSystemBlobStore(s["Path"] ?? throw new InvalidOperationException("Import:SourceStorage:Path is required."));
        logger.LogWarning("No Import:SourceStorage configured: attachments will be skipped (their rows too).");
        return null;
    }

    private static async Task<bool> TableExistsAsync(NpgsqlConnection conn, string table, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("SELECT to_regclass(@t) IS NOT NULL", conn);
        cmd.Parameters.AddWithValue("t", table);
        return (bool)(await cmd.ExecuteScalarAsync(ct))!;
    }

    private static string? Str(NpgsqlDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);

    private static DateTime? Utc(NpgsqlDataReader r, int i) =>
        r.IsDBNull(i) ? null : DateTime.SpecifyKind(r.GetDateTime(i), DateTimeKind.Utc);

    private static string[] ParseArray(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<string[]>(json) ?? []; }
        catch (JsonException) { return []; }
    }
}
