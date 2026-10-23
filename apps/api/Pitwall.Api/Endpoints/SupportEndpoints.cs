using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services;
using Pitwall.Services.Mail;
using Pitwall.Services.Storage;
using Pitwall.Services.Webhooks;

namespace Pitwall.Endpoints;

/// <summary>
/// Support, the customer's side — reached only through a product's backend (the bridge), never
/// from a browser directly. The product key says which product; the <c>Pitwall-Actor</c> header,
/// asserted by that product's backend, says which customer and which person. Every query below
/// is pinned to both product and customer: a person sees their customer's tickets and no others.
///
/// A ticket arrives with its evidence already attached: the screen, the browser's own log, the
/// requests that failed and their trace ids, and — when the person chose to — a DOM recording.
/// </summary>
public static class SupportEndpoints
{
    private const int MaxDiagnosticsBytes = 512 * 1024;

    public static IEndpointRouteBuilder MapSupportEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/support")
            .RequireAuthorization(Policies.Support)
            .AddEndpointFilter(async (ctx, next) =>
                Actor.From(ctx.HttpContext) is null
                    ? Results.BadRequest(new { message = $"The {Actor.Header} header is missing or invalid." })
                    : await next(ctx))
            .WithTags("Support");

        group.MapGet("/config", GetConfig);
        group.MapGet("/tickets", ListTickets);
        group.MapGet("/tickets/{id:guid}", GetTicket);
        group.MapPost("/tickets", CreateTicket).RequireRateLimiting("support-writes");
        group.MapPost("/tickets/{id:guid}/messages", PostMessage).RequireRateLimiting("support-writes");
        group.MapPost("/tickets/{id:guid}/attachments", UploadAttachment).RequireRateLimiting("support-writes").DisableAntiforgery();
        group.MapGet("/tickets/{id:guid}/attachments/{attachmentId:guid}", GetAttachment);
        group.MapPost("/tickets/{id:guid}/close", Close);
        group.MapPost("/tickets/{id:guid}/reopen", Reopen);
        group.MapGet("/known-issue", KnownIssue);
        return app;
    }

    /// <summary>What the browser widget needs to draw itself for this product.</summary>
    private static async Task<IResult> GetConfig(HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var product = await db.Products.AsNoTracking().FirstAsync(p => p.Id == http.ProductId(), ct);
        return Results.Ok(new
        {
            product = new { product.Slug, product.Name },
            teamName = product.Settings.TeamName ?? product.Name,
            categories = TicketCategories.All,
            severities = TicketSeverities.All,
            statuses = TicketStatuses.All,
            retroactiveRecording = product.Settings.RetroactiveRecording,
            maxAttachmentBytes = AttachmentStore.MaxBytes,
        });
    }

    private static IQueryable<Ticket> Mine(PitwallDb db, HttpContext http, Actor actor) =>
        db.Tickets.Where(t => t.ProductId == http.ProductId() && t.CustomerRef == actor.CustomerId);

    private static async Task<IResult> ListTickets(
        HttpContext http, PitwallDb db, CancellationToken ct,
        [FromQuery] string? status = null, [FromQuery] string? search = null,
        [FromQuery] int? page = null, [FromQuery] int? pageSize = null)
    {
        var actor = Actor.From(http)!;
        var (pageNumber, size) = Clean.Paging(page, pageSize);
        var q = Mine(db, http, actor).AsNoTracking();
        q = status?.ToLowerInvariant() switch
        {
            null or "" or "all" => q,
            "open" => q.Where(t => TicketStatuses.Active.Contains(t.Status)),
            "done" => q.Where(t => t.Status == TicketStatuses.Resolved || t.Status == TicketStatuses.Closed),
            var s when TicketStatuses.IsValid(s) => q.Where(t => t.Status == s),
            _ => q,
        };
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            q = q.Where(t => EF.Functions.ILike(t.Title, pattern) || EF.Functions.ILike(t.Code, pattern));
        }
        var total = await q.CountAsync(ct);
        var items = await q
            .OrderByDescending(t => t.UpdatedAt)
            .Skip((pageNumber - 1) * size).Take(size)
            .Select(t => new
            {
                t.Id, t.Code, t.Title, t.Category, t.Severity, t.Status,
                openedBy = t.OpenedByName,
                t.CreatedAt, t.UpdatedAt, t.LastTeamMessageAt, t.LastCustomerMessageAt,
                messageCount = t.Messages.Count(m => !m.Internal),
                hasRecording = t.Attachments.Any(a => a.Kind == AttachmentKinds.Recording),
                t.FixedIn,
            })
            .ToListAsync(ct);
        return Results.Ok(new Paged<object>(items, total, pageNumber, size));
    }

    private static async Task<IResult> GetTicket(Guid id, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var actor = Actor.From(http)!;
        var ticket = await Mine(db, http, actor).AsNoTracking()
            .Include(t => t.Messages).Include(t => t.Attachments).Include(t => t.Product)
            .AsSplitQuery()
            .FirstOrDefaultAsync(t => t.Id == id, ct);
        return ticket is null ? Results.NotFound() : Results.Ok(TicketViews.ToDetail(ticket, ticket.Product, forTeam: false));
    }

    public sealed record CreateTicketRequest(
        string? Title, string? Body, string? Category, string? Severity, string? Route,
        JsonElement? Diagnostics, string[]? TraceIds);

    private static async Task<IResult> CreateTicket(
        CreateTicketRequest req, HttpContext http, PitwallDb db, TeamInbox inbox, CancellationToken ct)
    {
        var actor = Actor.From(http)!;
        var title = req.Title?.Trim();
        var body = req.Body?.Trim();
        if (string.IsNullOrWhiteSpace(title) || title.Length > 200)
            return Results.BadRequest(new { message = "Give the ticket a title of up to 200 characters." });
        if (string.IsNullOrWhiteSpace(body) || body.Length > 20_000)
            return Results.BadRequest(new { message = "Describe the problem in up to 20,000 characters." });

        var productId = http.ProductId();
        var product = await db.Products.FirstAsync(p => p.Id == productId, ct);
        var traceIds = Clean.TraceIds(req.TraceIds);
        var now = DateTime.UtcNow;
        var ticket = new Ticket
        {
            Id = Guid.NewGuid(), ProductId = productId, Code = TicketCodes.New(now),
            CustomerRef = actor.CustomerId, CustomerName = actor.CustomerName,
            OpenedByRef = actor.UserId, OpenedByName = actor.UserName, OpenedByEmail = actor.UserEmail,
            Title = title, Body = body,
            Category = TicketCategories.IsValid(req.Category?.ToLowerInvariant()) ? req.Category!.ToLowerInvariant() : TicketCategories.Bug,
            Severity = TicketSeverities.IsValid(req.Severity?.ToLowerInvariant()) ? req.Severity!.ToLowerInvariant() : TicketSeverities.Normal,
            Status = TicketStatuses.Open,
            Route = Clean.Route(req.Route),
            DiagnosticsJson = Clean.JsonObject(req.Diagnostics, MaxDiagnosticsBytes),
            TraceIds = traceIds,
            // The first server error the trace ids point at names the bug. Only errors this customer
            // itself ran into count — a trace id is not a capability.
            ErrorSignature = traceIds.Length == 0 ? null : await db.ServerErrors.AsNoTracking()
                .Where(e => e.ProductId == productId && traceIds.Contains(e.TraceId) && e.CustomerRef == actor.CustomerId)
                .OrderBy(e => e.OccurredAt).Select(e => e.Signature).FirstOrDefaultAsync(ct),
            CreatedAt = now, UpdatedAt = now, LastCustomerMessageAt = now,
        };
        db.Tickets.Add(ticket);
        WebhookOutbox.Enqueue(db, product, WebhookEvents.TicketCreated, new { ticket = WebhookOutbox.TicketData(ticket) });
        // Four random characters a day collide about once in a million; when they do, draw again.
        for (var attempt = 0; ; attempt++)
        {
            try { await db.SaveChangesAsync(ct); break; }
            catch (DbUpdateException) when (attempt < 3) { ticket.Code = TicketCodes.New(now); }
        }
        await inbox.TicketActivityAsync(product, ticket, isNew: true, body, ct);
        return Results.Created($"/v1/support/tickets/{ticket.Id}", new { ticket.Id, ticket.Code });
    }

    public sealed record PostMessageRequest(string? Body);

    private static async Task<IResult> PostMessage(
        Guid id, PostMessageRequest req, HttpContext http, PitwallDb db, TeamInbox inbox, CancellationToken ct)
    {
        var actor = Actor.From(http)!;
        var body = req.Body?.Trim();
        if (string.IsNullOrWhiteSpace(body) || body.Length > 20_000)
            return Results.BadRequest(new { message = "Write a message of up to 20,000 characters." });
        var ticket = await Mine(db, http, actor).Include(t => t.Product).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null) return Results.NotFound();

        var now = DateTime.UtcNow;
        var message = new TicketMessage
        {
            Id = Guid.NewGuid(), TicketId = ticket.Id, ProductId = ticket.ProductId,
            FromTeam = false, Internal = false, AuthorRef = actor.UserId, AuthorName = actor.UserName,
            Body = body, CreatedAt = now,
        };
        db.TicketMessages.Add(message);
        ticket.LastCustomerMessageAt = ticket.UpdatedAt = now;
        // The customer wrote back: whatever we were waiting on, we are not any more. A resolved
        // ticket they answer is not resolved; a closed one is open again.
        if (ticket.Status is TicketStatuses.WaitingCustomer or TicketStatuses.Resolved) ticket.ApplyStatus(TicketStatuses.InProgress, now);
        if (ticket.Status is TicketStatuses.Closed) ticket.ApplyStatus(TicketStatuses.Open, now);
        await db.SaveChangesAsync(ct);

        await inbox.TicketActivityAsync(ticket.Product, ticket, isNew: false, body, ct);
        return Results.Created($"/v1/support/tickets/{id}/messages/{message.Id}", new { message.Id });
    }

    private static async Task<IResult> UploadAttachment(
        Guid id, HttpContext http, PitwallDb db, AttachmentStore store, CancellationToken ct)
    {
        var actor = Actor.From(http)!;
        var ticket = await Mine(db, http, actor).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null) return Results.NotFound();
        var stored = await TicketViews.StoreUploadAsync(http, db, store, ticket, fromTeam: false, actor.UserId, ct);
        return stored.Error ?? Results.Created(
            $"/v1/support/tickets/{id}/attachments/{stored.Attachment!.Id}", TicketViews.ToAttachmentDto(stored.Attachment));
    }

    private static async Task<IResult> GetAttachment(
        Guid id, Guid attachmentId, HttpContext http, PitwallDb db, AttachmentStore store, CancellationToken ct,
        [FromQuery] bool? download = null)
    {
        var actor = Actor.From(http)!;
        var attachment = await db.TicketAttachments.AsNoTracking()
            .Where(a => a.Id == attachmentId && a.TicketId == id
                        && a.Ticket.ProductId == http.ProductId() && a.Ticket.CustomerRef == actor.CustomerId)
            // Attachments on internal notes are the team's.
            .Where(a => a.MessageId == null || db.TicketMessages.Any(m => m.Id == a.MessageId && !m.Internal))
            .FirstOrDefaultAsync(ct);
        if (attachment is null) return Results.NotFound();
        return await TicketViews.ServeAsync(store, attachment, download == true, ct);
    }

    private static async Task<IResult> Close(Guid id, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var ticket = await Mine(db, http, Actor.From(http)!).Include(t => t.Product).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null) return Results.NotFound();
        var before = ticket.Status;
        ticket.ApplyStatus(TicketStatuses.Closed, DateTime.UtcNow);
        if (before != ticket.Status)
            WebhookOutbox.Enqueue(db, ticket.Product, WebhookEvents.TicketStatusChanged,
                new { ticket = WebhookOutbox.TicketData(ticket), from = before, to = ticket.Status, reason = "customer" });
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Reopen(Guid id, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var ticket = await Mine(db, http, Actor.From(http)!).Include(t => t.Product).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null) return Results.NotFound();
        if (ticket.Status is not (TicketStatuses.Resolved or TicketStatuses.Closed))
            return Results.BadRequest(new { message = "This ticket is already open." });
        var before = ticket.Status;
        ticket.ApplyStatus(TicketStatuses.Open, DateTime.UtcNow);
        WebhookOutbox.Enqueue(db, ticket.Product, WebhookEvents.TicketStatusChanged,
            new { ticket = WebhookOutbox.TicketData(ticket), from = before, to = ticket.Status, reason = "customer" });
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    /// <summary>
    /// "Is this already known?" — asked by the browser the moment a request fails, before it
    /// offers a ticket. The answer is a status and nothing else: no other customer's ticket,
    /// title or words leave through here.
    /// </summary>
    private static async Task<IResult> KnownIssue(HttpContext http, PitwallDb db, CancellationToken ct, [FromQuery] string? traceId = null)
    {
        var actor = Actor.From(http)!;
        var trace = traceId?.Trim();
        if (string.IsNullOrWhiteSpace(trace) || trace.Length > 64) return Results.Ok(new { known = false });
        var productId = http.ProductId();
        var signature = await db.ServerErrors.AsNoTracking()
            .Where(e => e.ProductId == productId && e.TraceId == trace && e.CustomerRef == actor.CustomerId)
            .Select(e => e.Signature).FirstOrDefaultAsync(ct);
        if (signature is null) return Results.Ok(new { known = false });

        var since = DateTime.UtcNow.AddDays(-30);
        var match = await db.Tickets.AsNoTracking()
            .Where(t => t.ProductId == productId && t.ErrorSignature == signature && t.UpdatedAt > since
                        && (t.Status == TicketStatuses.InProgress || t.Status == TicketStatuses.FixedPendingDeploy || t.Status == TicketStatuses.Resolved))
            .OrderByDescending(t => t.Status == TicketStatuses.FixedPendingDeploy).ThenByDescending(t => t.UpdatedAt)
            .Select(t => new { t.Status, t.FixedIn, t.CustomerRef, t.Id, t.Code })
            .FirstOrDefaultAsync(ct);
        if (match is null) return Results.Ok(new { known = false });
        var own = match.CustomerRef == actor.CustomerId;
        return Results.Ok(new
        {
            known = true,
            match.Status,
            match.FixedIn,
            // Your own ticket is linkable; someone else's is only a status.
            ticketId = own ? match.Id : (Guid?)null,
            ticketCode = own ? match.Code : null,
        });
    }
}
