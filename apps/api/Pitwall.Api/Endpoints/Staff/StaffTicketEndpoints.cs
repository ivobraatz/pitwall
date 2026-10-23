using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Storage;
using Pitwall.Services.Webhooks;

namespace Pitwall.Endpoints.Staff;

/// <summary>
/// Tickets, the team's side: one queue across every product, the dossier a ticket arrived with
/// (recordings, the browser's log, the server's stack traces), and the reply that goes back.
/// </summary>
public static class StaffTicketEndpoints
{
    public static IEndpointRouteBuilder MapStaffTicketEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff").RequireAuthorization(Policies.Staff).WithTags("Staff");
        group.MapGet("/summary", GetSummary);
        group.MapGet("/tickets", ListTickets);
        group.MapGet("/tickets/{id:guid}", GetTicket);
        group.MapPost("/tickets/{id:guid}/messages", PostMessage);
        group.MapPatch("/tickets/{id:guid}", UpdateTicket);
        group.MapPost("/tickets/{id:guid}/attachments", UploadAttachment).DisableAntiforgery();
        group.MapGet("/tickets/{id:guid}/attachments/{attachmentId:guid}", GetAttachment);
        return app;
    }

    private static async Task<IResult> GetSummary(PitwallDb db, CancellationToken ct, [FromQuery] Guid? productId = null)
    {
        var tickets = db.Tickets.AsNoTracking();
        if (productId is not null) tickets = tickets.Where(t => t.ProductId == productId);
        var byStatus = await tickets.GroupBy(t => t.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToListAsync(ct);
        var weekAgo = DateTime.UtcNow.AddDays(-7);
        // First-response time over the last week: created → first team reply. A ticket still
        // unanswered does not count, so this is what we did, not what we owe.
        var firsts = await tickets
            .Where(t => t.CreatedAt > weekAgo && t.LastTeamMessageAt != null)
            .Select(t => new
            {
                t.CreatedAt,
                First = db.TicketMessages.Where(m => m.TicketId == t.Id && m.FromTeam && !m.Internal).Min(m => (DateTime?)m.CreatedAt),
            })
            .ToListAsync(ct);
        var minutes = firsts.Where(f => f.First != null).Select(f => (f.First!.Value - f.CreatedAt).TotalMinutes).Order().ToList();
        var unanswered = await tickets.CountAsync(t => TicketStatuses.Active.Contains(t.Status)
            && (t.LastTeamMessageAt == null || t.LastCustomerMessageAt > t.LastTeamMessageAt), ct);
        var openedThisWeek = await tickets.CountAsync(t => t.CreatedAt > weekAgo, ct);
        var topSignatures = await tickets
            .Where(t => t.ErrorSignature != null && TicketStatuses.Active.Contains(t.Status))
            .GroupBy(t => new { t.ProductId, Signature = t.ErrorSignature! })
            .Select(g => new { g.Key.ProductId, g.Key.Signature, Tickets = g.Count(), Customers = g.Select(t => t.CustomerRef).Distinct().Count() })
            .OrderByDescending(g => g.Tickets).Take(5).ToListAsync(ct);
        // Last 14 days, one point per day (UTC), zero-filled: what the console's charts draw.
        var from = DateTime.UtcNow.Date.AddDays(-13);
        var ticketDays = await tickets.Where(t => t.CreatedAt >= from)
            .GroupBy(t => t.CreatedAt.Date).Select(g => new { Day = g.Key, Count = g.Count() }).ToListAsync(ct);
        var errorQuery = db.ServerErrors.AsNoTracking().Where(e => e.OccurredAt >= from);
        if (productId is not null) errorQuery = errorQuery.Where(e => e.ProductId == productId);
        var errorDays = await errorQuery.GroupBy(e => e.OccurredAt.Date).Select(g => new { Day = g.Key, Count = g.Count() }).ToListAsync(ct);
        var series = Enumerable.Range(0, 14).Select(i => from.AddDays(i)).Select(d => new
        {
            date = d.ToString("yyyy-MM-dd"),
            tickets = ticketDays.FirstOrDefault(x => x.Day == d)?.Count ?? 0,
            errors = errorDays.FirstOrDefault(x => x.Day == d)?.Count ?? 0,
        }).ToList();
        var perProduct = await db.Products.AsNoTracking().OrderBy(p => p.Name)
            .Select(p => new
            {
                p.Id, p.Slug, p.Name,
                open = db.Tickets.Count(t => t.ProductId == p.Id && TicketStatuses.Active.Contains(t.Status)),
                awaitingUs = db.Tickets.Count(t => t.ProductId == p.Id && TicketStatuses.Active.Contains(t.Status)
                    && (t.LastTeamMessageAt == null || t.LastCustomerMessageAt > t.LastTeamMessageAt)),
                errors24h = db.ServerErrors.Count(e => e.ProductId == p.Id && e.OccurredAt > DateTime.UtcNow.AddHours(-24)),
            })
            .ToListAsync(ct);

        return Results.Ok(new
        {
            byStatus = byStatus.ToDictionary(s => s.Status, s => s.Count),
            open = byStatus.Where(s => TicketStatuses.Active.Contains(s.Status)).Sum(s => s.Count),
            unanswered,
            openedThisWeek,
            medianFirstResponseMinutes = minutes.Count == 0 ? (double?)null
                : minutes.Count % 2 == 1 ? minutes[minutes.Count / 2] : (minutes[minutes.Count / 2 - 1] + minutes[minutes.Count / 2]) / 2,
            topSignatures,
            products = perProduct,
            series,
        });
    }

    private static async Task<IResult> ListTickets(
        PitwallDb db, CancellationToken ct,
        [FromQuery] Guid? productId = null, [FromQuery] string? status = null, [FromQuery] string? severity = null,
        [FromQuery] string? category = null, [FromQuery] string? customer = null, [FromQuery] Guid? assigneeId = null,
        [FromQuery] string? signature = null, [FromQuery] string? search = null, [FromQuery] bool? hasRecording = null,
        [FromQuery] bool? unanswered = null, [FromQuery] int? page = null, [FromQuery] int? pageSize = null)
    {
        var (pageNumber, size) = Clean.Paging(page, pageSize);
        var q = db.Tickets.AsNoTracking();
        if (productId is not null) q = q.Where(t => t.ProductId == productId);
        // "active" is the team's working set; a status name filters on exactly that status.
        q = status?.ToLowerInvariant() switch
        {
            null or "" or "active" => q.Where(t => TicketStatuses.Active.Contains(t.Status)),
            "all" => q,
            "done" => q.Where(t => t.Status == TicketStatuses.Resolved || t.Status == TicketStatuses.Closed),
            var s when TicketStatuses.IsValid(s) => q.Where(t => t.Status == s),
            _ => q,
        };
        if (!string.IsNullOrWhiteSpace(severity)) q = q.Where(t => t.Severity == severity.ToLowerInvariant());
        if (!string.IsNullOrWhiteSpace(category)) q = q.Where(t => t.Category == category.ToLowerInvariant());
        if (!string.IsNullOrWhiteSpace(customer)) q = q.Where(t => t.CustomerRef == customer);
        if (assigneeId is not null) q = q.Where(t => t.AssigneeId == assigneeId);
        if (!string.IsNullOrWhiteSpace(signature)) q = q.Where(t => t.ErrorSignature == signature);
        if (hasRecording == true) q = q.Where(t => t.Attachments.Any(a => a.Kind == AttachmentKinds.Recording));
        if (unanswered == true) q = q.Where(t => TicketStatuses.Active.Contains(t.Status)
            && (t.LastTeamMessageAt == null || t.LastCustomerMessageAt > t.LastTeamMessageAt));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            q = q.Where(t => EF.Functions.ILike(t.Title, pattern) || EF.Functions.ILike(t.Body, pattern)
                             || EF.Functions.ILike(t.Code, pattern) || EF.Functions.ILike(t.CustomerName ?? "", pattern));
        }

        var total = await q.CountAsync(ct);
        var items = await q
            // Work first, then what waits on us, then the most recently touched.
            .OrderBy(t => TicketStatuses.Active.Contains(t.Status) ? 0 : 1)
            .ThenByDescending(t => t.LastTeamMessageAt == null || t.LastCustomerMessageAt > t.LastTeamMessageAt)
            .ThenByDescending(t => t.UpdatedAt)
            .Skip((pageNumber - 1) * size).Take(size)
            .Select(t => new
            {
                t.Id, t.Code, t.Title, t.Category, t.Severity, t.Status,
                product = new { t.Product.Id, t.Product.Slug, t.Product.Name },
                customer = new { id = t.CustomerRef, name = t.CustomerName },
                openedBy = t.OpenedByName,
                assignee = t.Assignee != null ? t.Assignee.Name : null,
                t.AssigneeId, t.ErrorSignature, t.FixedIn,
                t.CreatedAt, t.UpdatedAt, t.LastTeamMessageAt, t.LastCustomerMessageAt,
                messageCount = t.Messages.Count(m => !m.Internal),
                hasRecording = t.Attachments.Any(a => a.Kind == AttachmentKinds.Recording),
                awaitingUs = TicketStatuses.Active.Contains(t.Status) && (t.LastTeamMessageAt == null || t.LastCustomerMessageAt > t.LastTeamMessageAt),
            })
            .ToListAsync(ct);
        return Results.Ok(new Paged<object>(items, total, pageNumber, size));
    }

    private static async Task<IResult> GetTicket(Guid id, PitwallDb db, CancellationToken ct)
    {
        var ticket = await db.Tickets.AsNoTracking()
            .Include(t => t.Product).Include(t => t.Assignee).Include(t => t.Messages).Include(t => t.Attachments)
            .AsSplitQuery()
            .FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null) return Results.NotFound();

        // The trace ids from the dossier, plus those of recordings attached later (a procedure
        // recorded after the ticket opened carries its own bundle), joined to what the product's
        // backend reported for them.
        var traceIds = ticket.TraceIds
            .Concat(ticket.Attachments.SelectMany(a => TraceIdsFromMeta(a.MetaJson)))
            .Distinct(StringComparer.Ordinal).Take(60).ToArray();
        var serverErrors = traceIds.Length == 0 ? [] : await db.ServerErrors.AsNoTracking()
            .Where(e => e.ProductId == ticket.ProductId && traceIds.Contains(e.TraceId))
            .OrderBy(e => e.OccurredAt)
            .Select(e => new
            {
                e.Id, e.TraceId, e.Method, e.Path, e.RouteTemplate, e.StatusCode, e.ExceptionType,
                e.Message, e.StackTrace, e.Signature, e.Release, e.Environment, e.OccurredAt,
            })
            .ToListAsync(ct);

        var related = ticket.ErrorSignature is null ? [] : await db.Tickets.AsNoTracking()
            .Where(t => t.ProductId == ticket.ProductId && t.ErrorSignature == ticket.ErrorSignature && t.Id != ticket.Id)
            .OrderByDescending(t => t.UpdatedAt).Take(10)
            .Select(t => new { t.Id, t.Code, t.Title, t.Status, customer = t.CustomerName ?? t.CustomerRef, t.UpdatedAt })
            .ToListAsync(ct);
        var sameCustomer = await db.Tickets.AsNoTracking()
            .Where(t => t.ProductId == ticket.ProductId && t.CustomerRef == ticket.CustomerRef && t.Id != ticket.Id)
            .OrderByDescending(t => t.UpdatedAt).Take(10)
            .Select(t => new { t.Id, t.Code, t.Title, t.Status, t.UpdatedAt })
            .ToListAsync(ct);
        var signatureOccurrences = ticket.ErrorSignature is null ? 0 : await db.ServerErrors
            .CountAsync(e => e.ProductId == ticket.ProductId && e.Signature == ticket.ErrorSignature, ct);

        return Results.Ok(new
        {
            ticket = TicketViews.ToDetail(ticket, ticket.Product, forTeam: true),
            product = new { ticket.Product.Id, ticket.Product.Slug, ticket.Product.Name, customerTicketUrl = ticket.Product.Settings.CustomerTicketUrl },
            customer = new { id = ticket.CustomerRef, name = ticket.CustomerName },
            opener = new { id = ticket.OpenedByRef, name = ticket.OpenedByName, email = ticket.OpenedByEmail },
            ticket.ErrorSignature,
            ticket.ResolutionNote,
            ticket.AssigneeId,
            assignee = ticket.Assignee is null ? null : new { ticket.Assignee.Id, ticket.Assignee.Name },
            serverErrors,
            signatureOccurrences,
            related,
            sameCustomer,
        });
    }

    public sealed record TeamMessageRequest(string? Body, bool? Internal, string? Status);

    private static async Task<IResult> PostMessage(Guid id, TeamMessageRequest req, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var body = req.Body?.Trim();
        if (string.IsNullOrWhiteSpace(body) || body.Length > 20_000)
            return Results.BadRequest(new { message = "Escreva uma mensagem de até 20.000 caracteres." });
        var ticket = await db.Tickets.Include(t => t.Product).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null) return Results.NotFound();

        var now = DateTime.UtcNow;
        var message = new TicketMessage
        {
            Id = Guid.NewGuid(), TicketId = ticket.Id, ProductId = ticket.ProductId,
            FromTeam = true, Internal = req.Internal == true,
            AuthorRef = http.StaffId().ToString(), AuthorName = http.StaffName(),
            Body = body, CreatedAt = now,
        };
        db.TicketMessages.Add(message);
        ticket.UpdatedAt = now;
        if (!message.Internal)
        {
            ticket.LastTeamMessageAt = now;
            var before = ticket.Status;
            // A reply moves the ticket unless the team said where it goes.
            var next = req.Status?.ToLowerInvariant();
            if (TicketStatuses.IsValid(next)) ticket.ApplyStatus(next!, now);
            else if (ticket.Status == TicketStatuses.Open) ticket.ApplyStatus(TicketStatuses.InProgress, now);

            WebhookOutbox.Enqueue(db, ticket.Product, WebhookEvents.TicketReplied, new
            {
                ticket = WebhookOutbox.TicketData(ticket),
                message = new { message.Id, message.Body, message.CreatedAt, teamName = ticket.Product.Settings.TeamName ?? ticket.Product.Name },
            });
            if (before != ticket.Status)
                WebhookOutbox.Enqueue(db, ticket.Product, WebhookEvents.TicketStatusChanged,
                    new { ticket = WebhookOutbox.TicketData(ticket), from = before, to = ticket.Status, reason = "team" });
        }
        await db.SaveChangesAsync(ct);
        return Results.Created($"/v1/staff/tickets/{id}/messages/{message.Id}", new { message.Id });
    }

    public sealed record UpdateTicketRequest(
        string? Status, string? Severity, string? Category, JsonElement? AssigneeId, string? FixedIn, string? ResolutionNote);

    private static async Task<IResult> UpdateTicket(Guid id, UpdateTicketRequest req, PitwallDb db, CancellationToken ct)
    {
        var ticket = await db.Tickets.Include(t => t.Product).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null) return Results.NotFound();
        var now = DateTime.UtcNow;
        var before = ticket.Status;

        if (req.Status is not null)
        {
            var s = req.Status.ToLowerInvariant();
            if (!TicketStatuses.IsValid(s)) return Results.BadRequest(new { message = "Status desconhecido." });
            ticket.ApplyStatus(s, now);
        }
        if (req.Severity is not null)
        {
            if (!TicketSeverities.IsValid(req.Severity.ToLowerInvariant())) return Results.BadRequest(new { message = "Severidade desconhecida." });
            ticket.Severity = req.Severity.ToLowerInvariant();
        }
        if (req.Category is not null)
        {
            if (!TicketCategories.IsValid(req.Category.ToLowerInvariant())) return Results.BadRequest(new { message = "Categoria desconhecida." });
            ticket.Category = req.Category.ToLowerInvariant();
        }
        // assigneeId: absent = leave it, null = unassign, a guid = assign.
        if (req.AssigneeId is { } assignee)
        {
            if (assignee.ValueKind == JsonValueKind.Null) ticket.AssigneeId = null;
            else if (assignee.ValueKind == JsonValueKind.String && Guid.TryParse(assignee.GetString(), out var staffId)
                     && await db.Staff.AnyAsync(s => s.Id == staffId && s.DisabledAt == null, ct))
                ticket.AssigneeId = staffId;
            else return Results.BadRequest(new { message = "Responsável desconhecido." });
        }
        if (req.FixedIn is not null) ticket.FixedIn = Clean.Cut(req.FixedIn, 120);
        if (req.ResolutionNote is not null) ticket.ResolutionNote = Clean.Cut(req.ResolutionNote, 4000);
        ticket.UpdatedAt = now;

        if (before != ticket.Status)
            WebhookOutbox.Enqueue(db, ticket.Product, WebhookEvents.TicketStatusChanged,
                new { ticket = WebhookOutbox.TicketData(ticket), from = before, to = ticket.Status, reason = "team" });
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> UploadAttachment(Guid id, HttpContext http, PitwallDb db, AttachmentStore store, CancellationToken ct)
    {
        var ticket = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null) return Results.NotFound();
        var stored = await TicketViews.StoreUploadAsync(http, db, store, ticket, fromTeam: true, http.StaffId().ToString(), ct);
        return stored.Error ?? Results.Created(
            $"/v1/staff/tickets/{id}/attachments/{stored.Attachment!.Id}", TicketViews.ToAttachmentDto(stored.Attachment));
    }

    private static async Task<IResult> GetAttachment(
        Guid id, Guid attachmentId, PitwallDb db, AttachmentStore store, CancellationToken ct, [FromQuery] bool? download = null)
    {
        var attachment = await db.TicketAttachments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == attachmentId && a.TicketId == id, ct);
        if (attachment is null) return Results.NotFound();
        return await TicketViews.ServeAsync(store, attachment, download == true, ct);
    }

    private static IEnumerable<string> TraceIdsFromMeta(string? metaJson)
    {
        if (Clean.ParseJson(metaJson) is not { ValueKind: JsonValueKind.Object } meta) yield break;
        if (!meta.TryGetProperty("traceIds", out var ids) || ids.ValueKind != JsonValueKind.Array) yield break;
        foreach (var t in ids.EnumerateArray())
            if (t.ValueKind == JsonValueKind.String && t.GetString() is { Length: > 0 and <= 64 } s) yield return s;
    }
}
