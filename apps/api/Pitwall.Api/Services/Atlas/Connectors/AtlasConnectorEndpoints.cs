using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas;

/// <summary>
/// The GitHub webhook: anonymous, so it is held to its signature instead. It keeps the repositories' last run and
/// their events, and a repository renamed on GitHub keeps its id. A delivery is recorded once (its id is the
/// event's key), so GitHub's retries change nothing.
/// </summary>
public static class GitHubWebhook
{
    public const string SignatureHeader = "X-Hub-Signature-256";
    public const int MaxBytes = 2 * 1024 * 1024;

    public static IEndpointRouteBuilder MapGitHubWebhook(this IEndpointRouteBuilder app)
    {
        app.MapPost("/v1/hooks/github", HandleAsync).AllowAnonymous().RequireRateLimiting("ingest").WithTags("Hooks");
        return app;
    }

    /// <summary>The signature of the body with the webhook secret, compared in constant time.</summary>
    public static bool ValidSignature(string secret, byte[] body, string? header)
    {
        const string prefix = "sha256=";
        if (header is null || !header.StartsWith(prefix, StringComparison.Ordinal)) return false;
        byte[] provided;
        try { provided = Convert.FromHexString(header[prefix.Length..]); }
        catch (FormatException) { return false; }
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), body);
        return CryptographicOperations.FixedTimeEquals(expected, provided);
    }

    private static async Task<IResult> HandleAsync(HttpContext http, PitwallDb db, AtlasActor actor, IConfiguration config, CancellationToken ct)
    {
        // Without a secret the hook does not exist: the same answer as for any unknown address.
        var secret = config["Atlas:GitHub:WebhookSecret"];
        if (string.IsNullOrWhiteSpace(secret)) return Results.NotFound();
        if (http.Request.ContentLength is > MaxBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        var body = await ReadBodyAsync(http.Request, ct);
        if (body is null) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        if (!ValidSignature(secret, body, http.Request.Headers[SignatureHeader].ToString()))
            return Results.Json(new { message = "Assinatura do GitHub inválida." }, statusCode: StatusCodes.Status401Unauthorized);

        var eventName = http.Request.Headers["X-GitHub-Event"].ToString();
        if (eventName == "ping") return Results.StatusCode(StatusCodes.Status204NoContent);
        var delivery = Clean.Cut(http.Request.Headers["X-GitHub-Delivery"].ToString(), 100) ?? Guid.NewGuid().ToString();

        JsonDocument doc;
        try { doc = JsonDocument.Parse(body); }
        catch (JsonException) { return Results.BadRequest(new { message = "O corpo não é JSON." }); }
        using (doc)
        {
            actor.Name = "GitHub";
            actor.Source = "collector";
            var recorded = await ApplyAsync(db, eventName, delivery, doc.RootElement, DateTime.UtcNow, ct);
            // A repository the Atlas does not know is accepted and not written.
            if (recorded is null) return Results.Json(new { accepted = false, recorded = 0 }, statusCode: StatusCodes.Status202Accepted);
            await AtlasCollect.MarkRunAsync(db, "github-webhook", DateTime.UtcNow, 1, null, ct);
            return Results.Json(new { accepted = true, recorded }, statusCode: StatusCodes.Status202Accepted);
        }
    }

    private static async Task<byte[]?> ReadBodyAsync(HttpRequest request, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await request.Body.ReadAsync(chunk.AsMemory(), ct)) > 0)
        {
            if (buffer.Length + read > MaxBytes) return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    /// <summary>The repository the payload names, by its id first, then by its name for one never linked by id. Null when unknown.</summary>
    private static async Task<AtlasRepo?> FindRepoAsync(PitwallDb db, JsonElement repository, CancellationToken ct)
    {
        if (repository.ValueKind != JsonValueKind.Object) return null;
        var id = repository.Scalar("id");
        var fullName = repository.Str("full_name")?.ToLowerInvariant();
        AtlasRepo? repo = null;
        if (id is not null) repo = await db.AtlasRepos.FirstOrDefaultAsync(r => r.ExternalId == id && r.RetiredAt == null, ct);
        if (repo is null && fullName is not null)
            repo = await db.AtlasRepos.FirstOrDefaultAsync(r => r.FullName == fullName && r.ExternalId == null && r.RetiredAt == null, ct);
        if (repo is not null && id is not null) repo.ExternalId = id;
        return repo;
    }

    /// <summary>Applies one delivery. Returns how many events it recorded, or null when the repository is unknown.</summary>
    private static async Task<int?> ApplyAsync(PitwallDb db, string eventName, string delivery, JsonElement payload, DateTime now, CancellationToken ct)
    {
        if (!payload.TryGetProperty("repository", out var repository)) return 0;
        var repo = await FindRepoAsync(db, repository, ct);
        if (repo is null) return null;
        // A rename on GitHub: the name follows, the id stays.
        var fullName = repository.Str("full_name")?.ToLowerInvariant();
        if (fullName is not null && repo.FullName != fullName) repo.FullName = fullName;

        return eventName switch
        {
            "workflow_run" => await WorkflowRunAsync(db, repo, payload, now),
            "push" => await PushAsync(db, repo, payload, delivery, now),
            "pull_request" => await PullRequestAsync(db, repo, payload, delivery, now),
            "deployment_status" => await DeploymentAsync(db, repo, payload, delivery, now),
            "release" => await ReleaseAsync(db, repo, payload, delivery, now),
            _ => 0,
        };
    }

    private static async Task<int> WorkflowRunAsync(PitwallDb db, AtlasRepo repo, JsonElement payload, DateTime now)
    {
        if (!payload.TryGetProperty("workflow_run", out var run) || run.ValueKind != JsonValueKind.Object) return 0;
        // As the poll does: a pull request's run is not the pipeline's last run.
        if (run.Str("event") == "pull_request") return 0;
        var runStatus = GitHubCollector.RunStatus(run.Str("status"), run.Str("conclusion"));
        var createdAt = AtlasCollect.Instant(run.Str("created_at")) ?? now;
        if (repo.LastRunAt is null || createdAt >= repo.LastRunAt)
        {
            repo.LastRunName = Clean.Cut(run.Str("name"), 200);
            repo.LastRunStatus = runStatus;
            repo.LastRunAt = createdAt;
            repo.LastRunUrl = Clean.Cut(run.Str("html_url"), 500);
            repo.LastRunSha = Clean.Cut(run.Str("head_sha"), 64);
        }
        var ci = GitHubCollector.CiEvent(repo, run.Scalar("id"), runStatus, repo.LastRunName, repo.LastRunUrl, repo.LastRunSha, createdAt);
        return ci is not null && await AtlasEvents.RecordAsync(db, ci) ? 1 : 0;
    }

    private static async Task<int> PushAsync(PitwallDb db, AtlasRepo repo, JsonElement payload, string delivery, DateTime now)
    {
        var rawRef = payload.Str("ref") ?? "";
        var branch = rawRef.StartsWith("refs/heads/", StringComparison.Ordinal) ? rawRef["refs/heads/".Length..] : rawRef;
        var commits = payload.Items("commits").Count();
        var count = commits == 1 ? "1 commit" : $"{commits} commits";
        return await RecordAsync(db, repo, "push", "info", $"{count} em {Clean.Cut(branch, 120)}", now, delivery,
            sha: payload.Str("after"));
    }

    private static async Task<int> PullRequestAsync(PitwallDb db, AtlasRepo repo, JsonElement payload, string delivery, DateTime now)
    {
        var pr = payload.TryGetProperty("pull_request", out var p) ? p : default;
        var action = payload.Str("action");
        var type = action switch
        {
            "opened" => "pr.opened",
            "closed" => Flag(pr, "merged") ? "pr.merged" : "pr.closed",
            _ => null,
        };
        if (type is null) return 0;
        var title = $"PR #{payload.Scalar("number")}: {pr.Str("title")}";
        return await RecordAsync(db, repo, type, "info", title, now, delivery, url: pr.Str("html_url"), sha: pr.Str("head", "sha"));
    }

    private static async Task<int> DeploymentAsync(PitwallDb db, AtlasRepo repo, JsonElement payload, string delivery, DateTime now)
    {
        var state = payload.Str("deployment_status", "state");
        var (type, status) = state switch
        {
            "success" => ("deploy.succeeded", "succeeded"),
            "failure" or "error" => ("deploy.failed", "failed"),
            "in_progress" or "queued" or "pending" => ("deploy.started", "started"),
            _ => (null, null),
        };
        if (type is null || status is null) return 0;
        var environment = Clean.Cut(payload.Str("deployment", "environment"), 80) ?? "sem ambiente";
        return await RecordAsync(db, repo, type, status, $"Deploy em {environment}: {state}", now, delivery,
            url: payload.Str("deployment_status", "target_url"), sha: payload.Str("deployment", "sha"));
    }

    private static async Task<int> ReleaseAsync(PitwallDb db, AtlasRepo repo, JsonElement payload, string delivery, DateTime now)
    {
        if (payload.Str("action") != "published" || !payload.TryGetProperty("release", out var release)) return 0;
        var title = release.Str("name") ?? release.Str("tag_name") ?? "release";
        return await RecordAsync(db, repo, "release.published", "info", $"Release {title}", now, delivery, url: release.Str("html_url"));
    }

    private static bool Flag(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static async Task<int> RecordAsync(PitwallDb db, AtlasRepo repo, string type, string status, string title, DateTime at, string externalId,
        string? url = null, string? sha = null)
    {
        var e = AtlasCollect.NewEvent("github", type, null, status, title, at, externalId);
        e.ProductId = repo.ProductId;
        e.RepoId = repo.Id;
        e.Url = Clean.Cut(url, 500);
        e.CommitSha = Clean.Cut(sha, 64);
        return await AtlasEvents.RecordAsync(db, e) ? 1 : 0;
    }
}

/// <summary>The repositories the console can register: what GitHub lists to the credential, with what the Atlas already has of each.</summary>
public static class StaffGitHubRepos
{
    public const string CacheKey = "atlas:github:repos";
    public static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(5);

    public sealed record SystemRef(Guid Id, string Slug, string Name, string? Color);
    public sealed record Row(string FullName, bool Private, bool Archived, string? DefaultBranch, string Url, bool Registered, Guid? RepoId, SystemRef? System, string? Role);

    public static IEndpointRouteBuilder MapStaffGitHubRepos(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/staff/atlas/github/repos", ListAsync).RequireAuthorization(Policies.Atlas).WithTags("Staff");
        return app;
    }

    private static async Task<IResult> ListAsync(PitwallDb db, IAtlasGitHubAuth auth, IMemoryCache cache, IHttpClientFactory httpFactory, CancellationToken ct)
    {
        if (!auth.Configured)
            return Results.Json(new { message = "Conecte o GitHub para listar os repositórios (veja Integração)." }, statusCode: StatusCodes.Status409Conflict);

        List<GitHubRepoItem> items;
        try
        {
            // Only GitHub's answer is cached; what the Atlas holds is read on every request.
            items = await cache.GetOrCreateAsync(CacheKey, async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = CacheFor;
                return await GitHubRepoList.FetchAsync(httpFactory.CreateClient("atlas"), auth, ct);
            }) ?? new List<GitHubRepoItem>();
        }
        catch (HttpRequestException ex)
        {
            return Results.Json(new { message = "Não foi possível listar os repositórios do GitHub: " + ex.Message }, statusCode: StatusCodes.Status502BadGateway);
        }

        var repos = await db.AtlasRepos.Include(r => r.Product).Where(r => r.RetiredAt == null).ToListAsync(ct);
        var rows = items.OrderBy(i => i.FullName, StringComparer.Ordinal).Select(i =>
        {
            var mine = repos.FirstOrDefault(r => r.ExternalId == i.Id)
                       ?? repos.FirstOrDefault(r => r.ExternalId == null && r.FullName == i.FullName);
            var system = mine?.Product is { } p ? new SystemRef(p.Id, p.Slug, p.Name, p.Color) : null;
            return new Row(i.FullName, i.Private, i.Archived, i.DefaultBranch, i.Url, mine is not null, mine?.Id, system, mine?.Role);
        }).ToList();
        return Results.Ok(rows);
    }
}
