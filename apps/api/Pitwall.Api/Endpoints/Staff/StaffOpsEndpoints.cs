using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Releases;
using Pitwall.Services.Webhooks;

namespace Pitwall.Endpoints.Staff;

/// <summary>
/// Server errors as the team reads them: grouped by signature across customers — "this broke for
/// eleven companies since Tuesday" — with the raw occurrences one click away.
/// </summary>
public static class StaffErrorEndpoints
{
    public static IEndpointRouteBuilder MapStaffErrorEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff/errors").RequireAuthorization(Policies.Staff).WithTags("Staff");

        group.MapGet("/groups", async (PitwallDb db, CancellationToken ct, [FromQuery] Guid? productId = null, [FromQuery] int days = 7) =>
        {
            var since = DateTime.UtcNow.AddDays(-Math.Clamp(days, 1, 30));
            var q = db.ServerErrors.AsNoTracking().Where(e => e.OccurredAt > since);
            if (productId is not null) q = q.Where(e => e.ProductId == productId);
            var groups = await q.GroupBy(e => new { e.ProductId, e.Signature })
                .Select(g => new
                {
                    g.Key.ProductId, g.Key.Signature,
                    count = g.Count(),
                    customers = g.Select(e => e.CustomerRef).Distinct().Count(),
                    firstSeen = g.Min(e => e.OccurredAt),
                    lastSeen = g.Max(e => e.OccurredAt),
                })
                .OrderByDescending(g => g.lastSeen).Take(200).ToListAsync(ct);

            // The newest occurrence of each group names it; tickets with the signature say whether
            // someone already reported it.
            var signatures = groups.Select(g => g.Signature).ToList();
            var samples = await db.ServerErrors.AsNoTracking()
                .Where(e => signatures.Contains(e.Signature) && e.OccurredAt > since)
                .GroupBy(e => e.Signature)
                .Select(g => g.OrderByDescending(e => e.OccurredAt)
                    .Select(e => new { e.Signature, e.ExceptionType, e.Message, e.Method, Route = e.RouteTemplate ?? e.Path, e.Release, e.StatusCode })
                    .First())
                .ToDictionaryAsync(s => s.Signature, ct);
            var tickets = await db.Tickets.AsNoTracking()
                .Where(t => t.ErrorSignature != null && signatures.Contains(t.ErrorSignature))
                .GroupBy(t => t.ErrorSignature!)
                .Select(g => new { Signature = g.Key, Total = g.Count(), Open = g.Count(t => TicketStatuses.Active.Contains(t.Status)) })
                .ToDictionaryAsync(s => s.Signature, ct);
            var products = await db.Products.AsNoTracking().ToDictionaryAsync(p => p.Id, p => new { p.Id, p.Slug, p.Name }, ct);

            return Results.Ok(groups.Select(g => new
            {
                product = products.GetValueOrDefault(g.ProductId),
                g.Signature, g.count, g.customers, g.firstSeen, g.lastSeen,
                sample = samples.GetValueOrDefault(g.Signature),
                tickets = tickets.TryGetValue(g.Signature, out var t) ? new { total = t.Total, open = t.Open } : new { total = 0, open = 0 },
            }));
        });

        group.MapGet("", async (PitwallDb db, CancellationToken ct,
            [FromQuery] Guid? productId = null, [FromQuery] string? signature = null, [FromQuery] string? traceId = null,
            [FromQuery] string? customer = null, [FromQuery] int days = 7, [FromQuery] int limit = 50) =>
        {
            var since = DateTime.UtcNow.AddDays(-Math.Clamp(days, 1, 30));
            var q = db.ServerErrors.AsNoTracking().Where(e => e.OccurredAt > since);
            if (productId is not null) q = q.Where(e => e.ProductId == productId);
            if (!string.IsNullOrWhiteSpace(signature)) q = q.Where(e => e.Signature == signature);
            if (!string.IsNullOrWhiteSpace(traceId)) q = q.Where(e => e.TraceId == traceId);
            if (!string.IsNullOrWhiteSpace(customer)) q = q.Where(e => e.CustomerRef == customer);
            var items = await q.OrderByDescending(e => e.OccurredAt).Take(Math.Clamp(limit, 1, 200))
                .Select(e => new
                {
                    e.Id, e.ProductId, e.TraceId, e.CustomerRef, e.UserRef, e.Method, e.Path, e.RouteTemplate, e.StatusCode,
                    e.ExceptionType, e.Message, e.StackTrace, e.Signature, e.Release, e.Environment, e.OccurredAt,
                })
                .ToListAsync(ct);
            return Results.Ok(new { items });
        });

        return app;
    }
}

/// <summary>Products: their keys, their webhook, their settings. Changing any of it is an admin's job.</summary>
public static class StaffProductEndpoints
{
    public sealed record ProductRequest(
        string? Slug, string? Name, string? Description, string? WebhookUrl, ProductSettings? Settings, bool? Disabled);
    public sealed record KeyRequest(string? Name, string[]? Scopes);

    public static IEndpointRouteBuilder MapStaffProductEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff/products").RequireAuthorization(Policies.Staff).WithTags("Staff");
        var admin = group.MapGroup("").RequireAuthorization(Policies.StaffAdmin);

        group.MapGet("", async (PitwallDb db, CancellationToken ct) => Results.Ok(await db.Products.AsNoTracking()
            .OrderBy(p => p.Name).Select(p => View(p)).ToListAsync(ct)));

        group.MapGet("/{id:guid}", async (Guid id, PitwallDb db, CancellationToken ct) =>
        {
            var p = await db.Products.AsNoTracking().Include(x => x.Keys).FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p is null) return Results.NotFound();
            return Results.Ok(new
            {
                product = View(p),
                keys = p.Keys.OrderByDescending(k => k.CreatedAt)
                    .Select(k => new { k.Id, k.Name, k.Prefix, k.Scopes, k.CreatedAt, k.LastUsedAt, k.RevokedAt }),
            });
        });

        admin.MapPost("", async (ProductRequest req, PitwallDb db, CancellationToken ct) =>
        {
            var slug = req.Slug?.Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(slug) || slug.Length > 40 || !slug.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '-'))
                return Results.BadRequest(new { message = "O identificador usa só letras minúsculas, números e hífen (até 40)." });
            var name = Clean.Cut(req.Name, 80);
            if (name is null) return Results.BadRequest(new { message = "Dê um nome ao sistema." });
            if (await db.Products.AnyAsync(p => p.Slug == slug, ct)) return Results.Conflict(new { message = "Já existe um sistema com esse identificador." });
            if (req.WebhookUrl is not null && ValidateUrl(req.WebhookUrl) is { } bad) return bad;
            var now = DateTime.UtcNow;
            var product = new Product
            {
                Id = Guid.NewGuid(), Slug = slug, Name = name, Description = Clean.Cut(req.Description, 1000),
                WebhookUrl = Clean.Cut(req.WebhookUrl, 500), Settings = Normalize(req.Settings ?? new ProductSettings()),
                CreatedAt = now, UpdatedAt = now,
            };
            db.Products.Add(product);
            await db.SaveChangesAsync(ct);
            return Results.Ok(View(product));
        });

        admin.MapPatch("/{id:guid}", async (Guid id, ProductRequest req, PitwallDb db, CancellationToken ct) =>
        {
            var p = await db.Products.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p is null) return Results.NotFound();
            if (Clean.Cut(req.Name, 80) is { } name) p.Name = name;
            if (req.Description is not null) p.Description = Clean.Cut(req.Description, 1000);
            if (req.WebhookUrl is not null)
            {
                if (req.WebhookUrl.Trim().Length == 0) p.WebhookUrl = null;
                else if (ValidateUrl(req.WebhookUrl) is { } bad) return bad;
                else p.WebhookUrl = req.WebhookUrl.Trim();
            }
            if (req.Settings is not null) p.Settings = Normalize(req.Settings);
            if (req.Disabled is { } disabled) p.DisabledAt = disabled ? p.DisabledAt ?? DateTime.UtcNow : null;
            p.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.Ok(View(p));
        });

        // The plaintext is in this response and nowhere else, ever.
        admin.MapPost("/{id:guid}/keys", async (Guid id, KeyRequest req, PitwallDb db, CancellationToken ct) =>
        {
            var p = await db.Products.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p is null) return Results.NotFound();
            var scopes = (req.Scopes ?? []).Select(s => s.Trim().ToLowerInvariant()).Where(KeyScopes.All.Contains).Distinct().ToArray();
            if (scopes.Length == 0) return Results.BadRequest(new { message = "Escolha ao menos um escopo." });
            var token = Tokens.NewProductKey(p.Slug);
            var key = new ProductKey
            {
                Id = Guid.NewGuid(), ProductId = p.Id, Name = Clean.Cut(req.Name, 80) ?? "Chave",
                Prefix = token[..Math.Min(token.Length, p.Slug.Length + 8)], Hash = Tokens.Hash(token),
                Scopes = scopes, CreatedAt = DateTime.UtcNow,
            };
            db.ProductKeys.Add(key);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { key.Id, key.Name, key.Prefix, key.Scopes, token });
        });

        admin.MapDelete("/{id:guid}/keys/{keyId:guid}", async (Guid id, Guid keyId, PitwallDb db, CancellationToken ct) =>
        {
            var n = await db.ProductKeys.Where(k => k.Id == keyId && k.ProductId == id && k.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(k => k.RevokedAt, DateTime.UtcNow), ct);
            return n == 0 ? Results.NotFound() : Results.NoContent();
        });

        admin.MapPost("/{id:guid}/webhook/secret", async (Guid id, PitwallDb db, Secrets secrets, CancellationToken ct) =>
        {
            var p = await db.Products.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p is null) return Results.NotFound();
            var secret = Tokens.NewWebhookSecret();
            p.WebhookSecretSealed = secrets.Seal(secret);
            p.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { secret });
        });

        admin.MapPost("/{id:guid}/webhook/ping", async (Guid id, HttpContext http, PitwallDb db, CancellationToken ct) =>
        {
            var p = await db.Products.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p is null) return Results.NotFound();
            if (p.WebhookUrl is null || p.WebhookSecretSealed is null)
                return Results.BadRequest(new { message = "Configure a URL e gere o segredo antes de testar." });
            WebhookOutbox.Enqueue(db, p, WebhookEvents.Ping, new { by = http.StaffName() });
            await db.SaveChangesAsync(ct);
            return Results.Accepted();
        });

        group.MapGet("/{id:guid}/webhook/deliveries", async (Guid id, PitwallDb db, CancellationToken ct, [FromQuery] string? status = null) =>
        {
            var q = db.WebhookDeliveries.AsNoTracking().Where(w => w.ProductId == id);
            if (!string.IsNullOrWhiteSpace(status)) q = q.Where(w => w.Status == status);
            return Results.Ok(await q.OrderByDescending(w => w.CreatedAt).Take(100)
                .Select(w => new { w.Id, w.Event, w.Status, w.Attempts, w.LastStatusCode, w.LastError, w.CreatedAt, w.DeliveredAt, w.NextAttemptAt })
                .ToListAsync(ct));
        });

        admin.MapPost("/{id:guid}/webhook/deliveries/{deliveryId:guid}/retry", async (Guid id, Guid deliveryId, PitwallDb db, CancellationToken ct) =>
        {
            var n = await db.WebhookDeliveries.Where(w => w.Id == deliveryId && w.ProductId == id && w.Status == WebhookStatuses.Failed)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(w => w.Status, WebhookStatuses.Pending)
                    .SetProperty(w => w.Attempts, 0)
                    .SetProperty(w => w.NextAttemptAt, DateTime.UtcNow), ct);
            return n == 0 ? Results.NotFound() : Results.NoContent();
        });

        return app;
    }

    private static object View(Product p) => new
    {
        p.Id, p.Slug, p.Name, p.Description, p.WebhookUrl,
        hasWebhookSecret = p.WebhookSecretSealed != null,
        p.Settings, p.CreatedAt, p.UpdatedAt, p.DisabledAt,
    };

    private static ProductSettings Normalize(ProductSettings s) => new()
    {
        TeamName = Clean.Cut(s.TeamName, 80),
        OwnFramePrefixes = (s.OwnFramePrefixes ?? []).Select(x => x.Trim()).Where(x => x.Length is > 0 and <= 120).Distinct().Take(20).ToList(),
        AutoPublishReleases = s.AutoPublishReleases,
        Locales = (s.Locales ?? []).Select(x => x.Trim().ToLowerInvariant()).Where(x => x is "pt" or "en" or "es").Distinct().DefaultIfEmpty("pt").ToList(),
        RetroactiveRecording = s.RetroactiveRecording,
        CustomerTicketUrl = Clean.Cut(s.CustomerTicketUrl, 300),
    };

    private static IResult? ValidateUrl(string url)
    {
        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            return Results.BadRequest(new { message = "A URL do webhook precisa ser http(s) absoluta." });
        return null;
    }
}

/// <summary>Release notes as the team manages them: read the drafts, fix a word, publish.</summary>
public static class StaffReleaseEndpoints
{
    public sealed record NoteEdit(string? Title, string? Summary, string[]? New, string[]? Improvements);
    public sealed record ReleaseEdit(Dictionary<string, NoteEdit>? Notes);

    public static IEndpointRouteBuilder MapStaffReleaseEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff/releases").RequireAuthorization(Policies.Staff).WithTags("Staff");

        group.MapGet("", async (PitwallDb db, CancellationToken ct, [FromQuery] Guid? productId = null, [FromQuery] string? status = null, [FromQuery] int? page = null) =>
        {
            var (pageNumber, size) = Clean.Paging(page, 30, 30);
            var q = db.Releases.AsNoTracking();
            if (productId is not null) q = q.Where(r => r.ProductId == productId);
            if (!string.IsNullOrWhiteSpace(status)) q = q.Where(r => r.Status == status);
            var total = await q.CountAsync(ct);
            var items = await q.OrderByDescending(r => r.CreatedAt).Skip((pageNumber - 1) * size).Take(size)
                .Select(r => new
                {
                    r.Id, r.Version, r.Status, r.ChangeKind, r.CreatedAt, r.PublishedAt,
                    product = new { r.Product.Id, r.Product.Slug, r.Product.Name },
                    commits = r.CommitShas.Length, tickets = r.TicketCodes,
                    notes = r.Notes.Select(n => new { n.Locale, n.Title, n.Summary }),
                })
                .ToListAsync(ct);
            return Results.Ok(new Paged<object>(items, total, pageNumber, size));
        });

        group.MapGet("/{id:guid}", async (Guid id, PitwallDb db, CancellationToken ct) =>
        {
            var r = await db.Releases.AsNoTracking().Include(x => x.Notes).Include(x => x.Product).FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r is null) return Results.NotFound();
            return Results.Ok(new
            {
                r.Id, r.Version, r.Status, r.ChangeKind, r.CreatedAt, r.PublishedAt, r.Announce, r.CommitShas, r.TicketCodes,
                product = new { r.Product.Id, r.Product.Slug, r.Product.Name },
                notes = r.Notes.OrderBy(n => n.Locale).Select(n => new
                {
                    n.Id, n.Locale, n.Slug, n.Title, n.Summary, @new = n.NewItems, n.Improvements, n.BodyMarkdown,
                }),
            });
        });

        group.MapPatch("/{id:guid}", async (Guid id, ReleaseEdit req, PitwallDb db, CancellationToken ct) =>
        {
            var r = await db.Releases.Include(x => x.Notes).FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r is null) return Results.NotFound();
            foreach (var (locale, edit) in req.Notes ?? [])
            {
                var note = r.Notes.FirstOrDefault(n => n.Locale == locale);
                if (note is null) continue;
                if (Clean.Cut(edit.Title, 80) is { } title) note.Title = title.TrimEnd('.');
                if (edit.Summary is not null) note.Summary = Clean.Cut(edit.Summary, 240) ?? "";
                if (edit.New is not null) note.NewItems = Items(edit.New);
                if (edit.Improvements is not null) note.Improvements = Items(edit.Improvements);
                note.BodyMarkdown = ReleaseWriter.Markdown(new NoteText(note.Title, note.Summary, note.NewItems, note.Improvements), locale);
            }
            r.ChangeKind = r.Notes.Any(n => n.NewItems.Length > 0) ? "feature" : "improvement";
            r.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        group.MapPost("/{id:guid}/publish", async (Guid id, PitwallDb db, ReleasePublisher publisher, CancellationToken ct) =>
        {
            var r = await db.Releases.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r is null) return Results.NotFound();
            var product = await db.Products.FirstAsync(p => p.Id == r.ProductId, ct);
            return await publisher.PublishAsync(product, id, null, ct)
                ? Results.NoContent()
                : Results.BadRequest(new { message = "Esta release não tem nota para publicar." });
        });

        group.MapPost("/{id:guid}/unpublish", async (Guid id, PitwallDb db, CancellationToken ct) =>
        {
            var n = await db.Releases.Where(r => r.Id == id && r.Status == ReleaseStatuses.Published)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, ReleaseStatuses.Draft).SetProperty(r => r.UpdatedAt, DateTime.UtcNow), ct);
            return n == 0 ? Results.NotFound() : Results.NoContent();
        });

        return app;
    }

    private static string[] Items(IEnumerable<string> items) => items
        .Select(i => i.Replace("`", "").Replace("\n", " ").Trim())
        .Where(i => i.Length > 0)
        .Select(i => i.Length > ReleaseWriter.MaxItemChars ? i[..ReleaseWriter.MaxItemChars] : i)
        .Take(ReleaseWriter.MaxItems).ToArray();
}
