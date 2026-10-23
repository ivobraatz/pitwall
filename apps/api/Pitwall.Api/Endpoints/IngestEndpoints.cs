using Microsoft.EntityFrameworkCore;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Errors;
using Pitwall.Services.Releases;

namespace Pitwall.Endpoints;

/// <summary>
/// Where products hand evidence over without a person behind it: the server errors their
/// backends caught, and the commits their CI shipped. Each needs its own key scope, so a CI
/// secret that leaks can write a release note and do nothing else.
/// </summary>
public static class IngestEndpoints
{
    public sealed record ServerErrorReport(
        string? TraceId, DateTime? OccurredAt, string? CustomerId, string? UserId,
        string? Method, string? Path, string? RouteTemplate, int? StatusCode,
        string? ExceptionType, string? Message, string? StackTrace, string? Release, string? Environment);

    public sealed record ServerErrorBatch(List<ServerErrorReport>? Errors);

    private const int MaxStack = 16_000;

    public static IEndpointRouteBuilder MapIngestEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/ingest").WithTags("Ingest");

        // One report or a batch of up to 100: a backend that buffers its errors sends them together.
        group.MapPost("/errors", async (ServerErrorBatch batch, HttpContext http, PitwallDb db, CancellationToken ct) =>
        {
            var reports = batch.Errors ?? [];
            if (reports.Count is 0 or > 100) return Results.BadRequest(new { message = "Send between 1 and 100 errors." });
            var productId = http.ProductId();
            var product = await db.Products.AsNoTracking().FirstAsync(p => p.Id == productId, ct);
            var now = DateTime.UtcNow;
            var accepted = 0;
            foreach (var r in reports)
            {
                var record = ToRecord(r, product, now);
                if (record is null) continue;
                db.ServerErrors.Add(record);
                accepted++;
            }
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { accepted, rejected = reports.Count - accepted });
        }).RequireAuthorization(Policies.IngestErrors).RequireRateLimiting("ingest");

        group.MapPost("/releases", async (IngestReleaseRequest req, HttpContext http, PitwallDb db, ReleasePublisher publisher, CancellationToken ct) =>
        {
            var product = await db.Products.FirstAsync(p => p.Id == http.ProductId(), ct);
            var outcome = await publisher.IngestAsync(product, req, ct);
            return Results.Ok(new
            {
                outcome.Status, outcome.ReleaseId, outcome.Reason, outcome.ResolvedTickets,
                draft = outcome.Draft is null ? null : new
                {
                    outcome.Draft.Publish,
                    notes = outcome.Draft.Notes.ToDictionary(n => n.Key, n => new
                    {
                        n.Value.Title, n.Value.Summary, @new = n.Value.New, n.Value.Improvements,
                    }),
                },
            });
        }).RequireAuthorization(Policies.IngestReleases);

        return app;
    }

    /// <summary>A report held to the shape, with its signature computed here — never trusted from the caller.</summary>
    public static ServerError? ToRecord(ServerErrorReport r, Product product, DateTime now)
    {
        var trace = r.TraceId?.Trim();
        if (string.IsNullOrWhiteSpace(trace) || trace.Length > 64) return null;
        if (string.IsNullOrWhiteSpace(r.ExceptionType) || string.IsNullOrWhiteSpace(r.Path)) return null;
        var path = Clean.Cut(r.Path, 512)!;
        var route = Clean.Cut(r.RouteTemplate, 300);
        var stack = r.StackTrace is { Length: > MaxStack } s ? s[..MaxStack] + "\n… (truncated)" : r.StackTrace;
        var type = Clean.Cut(r.ExceptionType, 300)!;
        // A clock far off in either direction is not believed; the receipt time stands in.
        var occurred = r.OccurredAt is { } at && Math.Abs((at.ToUniversalTime() - now).TotalDays) < 2
            ? DateTime.SpecifyKind(at.ToUniversalTime(), DateTimeKind.Utc) : now;
        return new ServerError
        {
            Id = Guid.NewGuid(), ProductId = product.Id, TraceId = trace,
            CustomerRef = Clean.Cut(r.CustomerId, 100), UserRef = Clean.Cut(r.UserId, 100),
            Method = Clean.Cut(r.Method, 10)?.ToUpperInvariant() ?? "GET",
            Path = path, RouteTemplate = route,
            StatusCode = r.StatusCode is >= 100 and <= 599 ? r.StatusCode.Value : 500,
            ExceptionType = type,
            Message = Clean.Cut(r.Message, 2000) ?? "",
            StackTrace = stack,
            Signature = ErrorSignature.Compute(type, route ?? path, stack, product.Settings.OwnFramePrefixes),
            Release = Clean.Cut(r.Release, 80), Environment = Clean.Cut(r.Environment, 40),
            OccurredAt = occurred, ReceivedAt = now,
        };
    }
}

/// <summary>
/// The only unauthenticated surface: each product's published changelog, for its marketing site
/// and its in-app "what's new". Drafts, silent releases and everything else stay behind keys.
/// </summary>
public static class PublicEndpoints
{
    public static IEndpointRouteBuilder MapPublicEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/public/{slug}").RequireCors("public").WithTags("Public");

        group.MapGet("/releases", async (string slug, string? locale, int? limit, DateTime? before, PitwallDb db, HttpContext http, CancellationToken ct) =>
        {
            var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Slug == slug && p.DisabledAt == null, ct);
            if (product is null) return Results.NotFound();
            var lang = Pick(locale, product);
            var take = Math.Clamp(limit ?? 20, 1, 100);
            var q = db.ReleaseNotes.AsNoTracking()
                .Where(n => n.Release.ProductId == product.Id && n.Release.Status == ReleaseStatuses.Published && n.Locale == lang);
            if (before is not null) q = q.Where(n => n.Release.PublishedAt < before);
            var items = await q.OrderByDescending(n => n.Release.PublishedAt).Take(take)
                .Select(n => new
                {
                    n.Release.Version, n.Release.ChangeKind, n.Release.PublishedAt, releaseId = n.ReleaseId,
                    n.Locale, n.Slug, n.Title, n.Summary, @new = n.NewItems, n.Improvements, n.BodyMarkdown,
                })
                .ToListAsync(ct);
            http.Response.Headers.CacheControl = "public, max-age=300";
            return Results.Ok(new { product = new { product.Slug, product.Name }, locale = lang, items });
        });

        group.MapGet("/releases/{version}", async (string slug, string version, string? locale, PitwallDb db, CancellationToken ct) =>
        {
            var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Slug == slug && p.DisabledAt == null, ct);
            if (product is null) return Results.NotFound();
            var lang = Pick(locale, product);
            var note = await db.ReleaseNotes.AsNoTracking()
                .Where(n => n.Release.ProductId == product.Id && n.Release.Status == ReleaseStatuses.Published
                            && n.Release.Version == version && n.Locale == lang)
                .Select(n => new
                {
                    n.Release.Version, n.Release.ChangeKind, n.Release.PublishedAt, releaseId = n.ReleaseId,
                    n.Locale, n.Slug, n.Title, n.Summary, @new = n.NewItems, n.Improvements, n.BodyMarkdown,
                })
                .FirstOrDefaultAsync(ct);
            return note is null ? Results.NotFound() : Results.Ok(note);
        });

        return app;
    }

    private static string Pick(string? locale, Product product)
    {
        var locales = product.Settings.Locales.Count > 0 ? product.Settings.Locales : ["pt", "en"];
        var wanted = locale?.Trim().ToLowerInvariant();
        if (wanted is not null && wanted.Length >= 2 && locales.Contains(wanted[..2])) return wanted[..2];
        return locales[0];
    }
}
