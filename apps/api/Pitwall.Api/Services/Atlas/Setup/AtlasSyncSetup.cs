using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Atlas.Sync;

namespace Pitwall.Services.Atlas;

/// <summary>
/// The Atlas sync, registered from Program.cs: what agents, pipelines and the CLI report about a repository
/// (<c>POST /v1/staff/atlas/sync</c>), its state (<c>GET …/sync/state</c>) and a scan the server runs itself
/// (<c>POST /v1/staff/atlas/repos/{id}/scan</c>).
/// </summary>
public static class AtlasSyncSetup
{
    /// <summary>The rate limit of the sync: 60 requests a minute per person (console and tokens count together).</summary>
    public const string SyncRateLimit = "atlas-sync";

    public static IServiceCollection AddAtlasSync(this IServiceCollection services, IConfiguration config)
    {
        services.AddRateLimiter(o => o.AddPolicy(SyncRateLimit, http => RateLimitPartition.GetFixedWindowLimiter(
            http.User.FindFirst(StaffSessionAuthHandler.StaffClaim)?.Value ?? "anon",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1) })));
        services.AddScoped<AtlasSyncService>();
        services.AddScoped<AtlasGitHubScanner>();
        return services;
    }

    public static IEndpointRouteBuilder MapAtlasSync(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff/atlas").RequireAuthorization(Policies.Atlas).WithTags("Staff");
        var writes = group.MapGroup("").RequireRateLimiting(SyncRateLimit);
        writes.MapPost("/sync", Sync);
        writes.MapPost("/repos/{id:guid}/scan", Scan);
        group.MapGet("/sync/state", SyncState);
        return app;
    }

    private static async Task<IResult> Sync(SyncRequest req, HttpContext http, AtlasActor actor, AtlasSyncService sync, CancellationToken ct)
    {
        // The scan is the server's own call: a request cannot claim it.
        if (string.Equals(req.Source?.Trim(), AtlasSyncService.GitHubScanSource, StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new { message = "Origem inválida. Use agent, ci, git-hook ou cli." });
        actor.FromRequest(http);
        actor.Source = "sync";
        return await Run(() => sync.ApplyAsync(req, ct));
    }

    private static async Task<IResult> Scan(
        Guid id, HttpContext http, PitwallDb db, AtlasActor actor, AtlasGitHubScanner scanner, AtlasSyncService sync, CancellationToken ct)
    {
        var repo = await db.AtlasRepos.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (repo is null) return Results.NotFound(new { message = "Repositório não encontrado." });
        if (repo.ProductId is null) return Results.UnprocessableEntity(new { message = AtlasSyncService.NotAssociated });

        actor.FromRequest(http);
        actor.Source = "sync";
        return await Run(async () =>
        {
            var package = await scanner.FetchAsync(repo.FullName, repo.DefaultBranch, ct);
            return await sync.ApplyAsync(new SyncRequest(
                IdempotencyKey: null, Source: AtlasSyncService.GitHubScanSource, Tool: "github", Repo: repo.FullName, System: null,
                Branch: package.Branch, CommitSha: package.TreeSha, Scope: AtlasScopes.Pushed, Environment: null, ActivityId: null,
                Files: package.Files.Cast<SyncFile?>().ToList(), BundleHash: null, Partial: package.Partial, Report: null), ct);
        });
    }

    private static async Task<IResult> SyncState(string? repo, PitwallDb db, CancellationToken ct)
    {
        var name = repo?.Trim().ToLowerInvariant() ?? "";
        if (name.Length == 0) return Results.BadRequest(new { message = "Informe o repositório (dono/nome)." });
        var row = await db.AtlasRepos.AsNoTracking().FirstOrDefaultAsync(r => r.FullName == name, ct);
        var system = row?.ProductId is { } productId
            ? await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == productId, ct)
            : null;
        return Results.Ok(new
        {
            repo = name,
            registered = row is not null,
            system = system is null ? null : new { id = system.Id, slug = system.Slug, name = system.Name, color = system.Color },
            lastSyncAt = row?.LastSyncAt,
            lastSyncSha = row?.LastSyncSha,
            lastSyncScope = row?.LastSyncScope,
            lastScanHash = row?.LastScanHash,
        });
    }

    /// <summary>Maps the refusals of the sync to their status and message. A conflict that survives one retry is a 409.</summary>
    private static async Task<IResult> Run(Func<Task<SyncResponse>> act)
    {
        try
        {
            return Results.Ok(await act());
        }
        catch (AtlasSyncRejected e)
        {
            return Results.Json(new { message = e.Message }, statusCode: e.Status);
        }
        catch (Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException)
        {
            return Results.Json(new { message = "Outra sincronização mexeu nos mesmos itens. Tente de novo." }, statusCode: StatusCodes.Status409Conflict);
        }
    }
}
