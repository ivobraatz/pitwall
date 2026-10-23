using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Storage;

namespace Pitwall.Endpoints;

/// <summary>
/// The shapes a ticket takes on the way out, and the attachment plumbing both sides share.
/// The customer and the team read the same ticket through different lenses: the customer never
/// sees internal notes, and sees the team — not the teammate — behind every reply.
/// </summary>
public static class TicketViews
{
    public const string TeamId = "team";

    public static object Person(string? id, string? name) => new { id, name = name ?? "—" };

    public static object ToDetail(Ticket t, Product product, bool forTeam) => new
    {
        t.Id, t.Code, t.Title, t.Body, t.Category, t.Severity, t.Status, t.Route, t.FixedIn,
        t.CreatedAt, t.UpdatedAt, t.ResolvedAt, t.ClosedAt, t.LastTeamMessageAt, t.LastCustomerMessageAt,
        openedBy = Person(t.OpenedByRef, t.OpenedByName),
        traceIds = t.TraceIds,
        diagnostics = Clean.ParseJson(t.DiagnosticsJson),
        messages = t.Messages
            .Where(m => forTeam || !m.Internal)
            .OrderBy(m => m.CreatedAt)
            .Select(m => new
            {
                m.Id, m.Body, m.FromTeam, m.Internal, m.CreatedAt,
                author = m.FromTeam && !forTeam
                    ? Person(TeamId, product.Settings.TeamName ?? product.Name)
                    : Person(m.AuthorRef, m.AuthorName),
            }),
        attachments = t.Attachments
            // An attachment hanging off an internal note is as internal as the note.
            .Where(a => forTeam || a.MessageId is null || t.Messages.Any(m => m.Id == a.MessageId && !m.Internal))
            .OrderBy(a => a.CreatedAt)
            .Select(ToAttachmentDto),
    };

    public static object ToAttachmentDto(TicketAttachment a) => new
    {
        a.Id, a.MessageId, a.Kind, a.Name, a.ContentType, a.SizeBytes, a.CreatedAt, a.FromTeam,
        meta = Clean.ParseJson(a.MetaJson),
    };

    public readonly record struct StoreResult(TicketAttachment? Attachment, IResult? Error);

    private const long FormOverhead = 1024 * 1024;
    private const int MaxMetaBytes = 512 * 1024;

    /// <summary>Reads one multipart upload and stores it against the ticket. Both sides use it.</summary>
    public static async Task<StoreResult> StoreUploadAsync(
        HttpContext http, PitwallDb db, AttachmentStore store, Ticket ticket, bool fromTeam, string? uploadedBy, CancellationToken ct)
    {
        if (!http.Request.HasFormContentType)
            return new(null, Results.BadRequest(new { message = "Expected a multipart form upload." }));
        var bodyLimit = http.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (bodyLimit is { IsReadOnly: false }) bodyLimit.MaxRequestBodySize = AttachmentStore.MaxBytes + FormOverhead;
        if (http.Request.ContentLength > AttachmentStore.MaxBytes + FormOverhead) return new(null, TooLarge());

        var form = await http.Request.ReadFormAsync(ct);
        var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
        if (file is null || file.Length == 0) return new(null, Results.BadRequest(new { message = "No file received." }));
        if (file.Length > AttachmentStore.MaxBytes) return new(null, TooLarge());
        var contentType = file.ContentType?.Split(';')[0].Trim().ToLowerInvariant();
        if (!AttachmentStore.IsAllowedType(contentType))
            return new(null, Results.BadRequest(new { message = "Unsupported file type. Attach an image, a text or PDF file, or a recording." }));

        var kindRaw = form["kind"].FirstOrDefault()?.ToLowerInvariant();
        var kind = AttachmentKinds.All.Contains(kindRaw) ? kindRaw!
            : contentType!.StartsWith("image/", StringComparison.Ordinal) ? AttachmentKinds.Image : AttachmentKinds.File;
        if (kind == AttachmentKinds.Recording && contentType is not ("application/gzip" or "application/json"))
            return new(null, Results.BadRequest(new { message = "A recording is a JSON or gzip event stream." }));

        Guid? messageId = Guid.TryParse(form["messageId"].FirstOrDefault(), out var mid) ? mid : null;
        // A message id must be one of this ticket's own messages; anything else is dropped, not trusted.
        if (messageId is not null && !await db.TicketMessages.AnyAsync(m => m.Id == messageId && m.TicketId == ticket.Id, ct))
            messageId = null;

        var attachment = new TicketAttachment
        {
            Id = Guid.NewGuid(), TicketId = ticket.Id, ProductId = ticket.ProductId, MessageId = messageId,
            FromTeam = fromTeam, UploadedByRef = uploadedBy, Kind = kind,
            Name = FileName(file.FileName, kind), ContentType = contentType!, SizeBytes = file.Length,
            MetaJson = Clean.JsonObject(form["meta"].FirstOrDefault(), MaxMetaBytes), CreatedAt = DateTime.UtcNow,
        };
        attachment.StorageKey = AttachmentStore.Key(ticket.ProductId, ticket.Id, attachment.Id, contentType);

        await using (var stream = file.OpenReadStream())
        {
            try { await store.PutAsync(attachment.StorageKey, stream, contentType!, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return new(null, Results.Problem(title: "Could not store the attachment.", detail: ex.Message, statusCode: StatusCodes.Status502BadGateway));
            }
        }
        db.TicketAttachments.Add(attachment);
        ticket.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return new(attachment, null);
    }

    public static async Task<IResult> ServeAsync(AttachmentStore store, TicketAttachment a, bool download, CancellationToken ct)
    {
        var stream = await store.GetAsync(a.StorageKey, ct);
        if (stream is null) return Results.NotFound();
        // Never rendered as a page: images and PDFs may show inline, anything else downloads.
        var inline = !download && (a.ContentType.StartsWith("image/", StringComparison.Ordinal) || a.ContentType == "application/pdf");
        return Results.Stream(stream, a.ContentType, fileDownloadName: inline ? null : a.Name, enableRangeProcessing: false);
    }

    private static string FileName(string? fileName, string kind)
    {
        var name = Path.GetFileName(fileName ?? "").Trim();
        if (name.Length == 0) name = kind == AttachmentKinds.Recording ? "recording.json.gz" : "attachment";
        return name.Length <= 200 ? name : name[..200];
    }

    private static IResult TooLarge() => Results.Json(
        new { message = $"Attachment is too large. Maximum is {AttachmentStore.MaxBytes / (1024 * 1024)} MB." },
        statusCode: StatusCodes.Status413PayloadTooLarge);
}
