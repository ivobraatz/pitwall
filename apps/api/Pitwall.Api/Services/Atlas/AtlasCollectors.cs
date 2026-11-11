using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas;

/*
 * Collectors: once an hour (and when someone asks), each one reads a provider with a read-only
 * token from the environment and writes what it saw onto the services and repositories the team
 * registered. What it sees and nobody registered becomes a discovery. A collector without its
 * token is "not connected" and does nothing.
 *
 * A run either lands whole or not at all: the collector saves once, at the end, so a provider that
 * fails halfway leaves the last good state (and the last verification) in place. Only a complete
 * listing may say that something is missing.
 */

public interface IAtlasCollector
{
    string Name { get; }
    bool Configured { get; }

    /// <summary>Reads the provider and writes what it saw. Returns how many items it saw. A throw means nothing of this run is saved.</summary>
    Task<int> CollectAsync(PitwallDb db, CancellationToken ct);
}

/// <summary>What each collector did last, kept in memory: the next run is at most an hour away.</summary>
public sealed class AtlasCollectorStatus
{
    public sealed record Entry(DateTime At, string? Error);
    private readonly ConcurrentDictionary<string, Entry> _last = new();
    public Entry? Last(string name) => _last.GetValueOrDefault(name);
    public void Set(string name, string? error) => _last[name] = new Entry(DateTime.UtcNow, error);
}

public sealed class AtlasCollectorRunner(
    IEnumerable<IAtlasCollector> collectors, IServiceScopeFactory scopes, AtlasCollectorStatus status,
    ILogger<AtlasCollectorRunner> logger) : BackgroundService
{
    public static readonly TimeSpan Every = TimeSpan.FromHours(1);
    private readonly SemaphoreSlim _one = new(1, 1);

    public IReadOnlyList<IAtlasCollector> Collectors { get; } = collectors.ToList();

    /// <summary>Runs every connected collector, one at a time. A second call while one is running waits for it.</summary>
    public async Task RunAllAsync(CancellationToken ct)
    {
        await _one.WaitAsync(ct);
        try
        {
            foreach (var collector in Collectors.Where(c => c.Configured))
            {
                var at = DateTime.UtcNow;
                try
                {
                    int seen;
                    using (var scope = scopes.CreateScope())
                    {
                        // What a collector writes is history under the collector's name, not "Sistema".
                        var actor = scope.ServiceProvider.GetRequiredService<AtlasActor>();
                        actor.Name = collector.Name;
                        actor.Source = "collector";
                        seen = await collector.CollectAsync(scope.ServiceProvider.GetRequiredService<PitwallDb>(), ct);
                    }
                    status.Set(collector.Name, null);
                    await MarkRunAsync(collector.Name, at, seen, null, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
                {
                    // The message of an HTTP failure carries the status, never the token.
                    logger.LogWarning("Atlas collector {Name} failed: {Message}", collector.Name, ex.Message);
                    var error = Clean.Cut(ex.Message, 300) ?? "Falhou.";
                    status.Set(collector.Name, error);
                    await MarkRunAsync(collector.Name, at, null, error, ct);
                }
            }
        }
        finally { _one.Release(); }
    }

    /// <summary>The source's row after this run, in a context of its own: a failed run never takes its own record down with it.</summary>
    private async Task MarkRunAsync(string name, DateTime at, int? seen, string? error, CancellationToken ct)
    {
        try
        {
            using var scope = scopes.CreateScope();
            await AtlasCollect.MarkRunAsync(scope.ServiceProvider.GetRequiredService<PitwallDb>(), name, at, seen, error, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            logger.LogWarning("Could not record the run of Atlas source {Name}: {Message}", name, ex.Message);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
            using var timer = new PeriodicTimer(Every);
            do { await RunAllAsync(stoppingToken); }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) { }
    }
}

public static class AtlasCollect
{
    public sealed record Found(string ExternalRef, string Name, string? Environment = null, string? Url = null);

    public static bool Same(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);

    public static string EnvSlug(string? name) => (name ?? "").Trim().ToLowerInvariant().Replace(' ', '-');

    /// <summary>
    /// Makes the discoveries of one collector match what it found unregistered just now: new ones
    /// are added, known ones stay (dismissed stays dismissed), the ones no longer found go away.
    /// </summary>
    public static async Task SyncDiscoveriesAsync(PitwallDb db, string source, string kind, IReadOnlyCollection<Found> found, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var known = await db.AtlasDiscoveries.Where(d => d.Source == source && d.Kind == kind).ToListAsync(ct);
        foreach (var f in found.DistinctBy(f => f.ExternalRef))
        {
            var row = known.FirstOrDefault(d => d.ExternalRef == f.ExternalRef);
            if (row is null)
            {
                row = new AtlasDiscovery { Id = Guid.NewGuid(), Source = source, Kind = kind, ExternalRef = Clean.Cut(f.ExternalRef, 300)!, FirstSeenAt = now };
                db.AtlasDiscoveries.Add(row);
            }
            row.Name = Clean.Cut(f.Name, 200) ?? row.ExternalRef;
            row.Environment = Clean.Cut(f.Environment, 80);
            row.Url = Clean.Cut(f.Url, 500);
            row.LastSeenAt = now;
        }
        db.AtlasDiscoveries.RemoveRange(known.Where(d => found.All(f => f.ExternalRef != d.ExternalRef)));
    }

    public static async Task<JsonElement> GetJsonAsync(HttpClient http, HttpRequestMessage request, CancellationToken ct)
    {
        using var res = await http.SendAsync(request, ct);
        if (!res.IsSuccessStatusCode) throw new HttpRequestException($"{request.RequestUri?.Host} respondeu {(int)res.StatusCode}.", null, res.StatusCode);
        return await res.Content.ReadFromJsonAsync<JsonElement>(ct);
    }

    public static string? Str(this JsonElement e, params string[] path)
    {
        foreach (var p in path)
        {
            if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(p, out e)) return null;
        }
        return e.ValueKind == JsonValueKind.String ? e.GetString() : null;
    }

    /// <summary>A string or a number as text (GitHub's ids are numbers, Vercel's next page can be one).</summary>
    public static string? Scalar(this JsonElement e, string key)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(key, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.GetRawText(),
            _ => null,
        };
    }

    public static IEnumerable<JsonElement> Items(this JsonElement e, params string[] path)
    {
        foreach (var p in path)
        {
            if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(p, out e)) return [];
        }
        return e.ValueKind == JsonValueKind.Array ? e.EnumerateArray().ToList() : [];
    }

    public static DateTime? Instant(string? iso) =>
        DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d.UtcDateTime : null;

    /// <summary>Writes what a run of a source saw. A failure keeps the last success and what it saw; nothing is deleted.</summary>
    public static async Task MarkRunAsync(PitwallDb db, string name, DateTime at, int? itemsSeen, string? error, CancellationToken ct)
    {
        var row = db.AtlasSources.Local.FirstOrDefault(s => s.Name == name)
            ?? await db.AtlasSources.FirstOrDefaultAsync(s => s.Name == name, ct);
        if (row is null)
        {
            row = new AtlasSource { Name = name };
            db.AtlasSources.Add(row);
        }
        row.LastRunAt = at;
        row.UpdatedAt = at;
        if (error is null)
        {
            row.LastOkAt = at;
            row.ItemsSeen = itemsSeen;
            row.LastError = null;
        }
        else row.LastError = Clean.Cut(error, 300);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// The collector saw this service now: it is verified (VerifiedAt/VerifiedBy), and its evidence says where
    /// the proof is. Returns the evidence, so the caller can tell which evidence it still sees.
    /// </summary>
    public static Task<AtlasEvidence> VerifyAsync(PitwallDb db, AtlasService s, string collector, string provider, string externalRef, DateTime now, CancellationToken ct)
    {
        s.VerifiedAt = now;
        s.VerifiedBy = collector;
        s.CheckedAt = now;
        return AtlasEvidenceWriter.UpsertAsync(db, "service", s.Id, $"collector:{collector}", "api",
            Clean.Cut($"{provider}:{externalRef}", 300)!, AtlasScopes.Runtime, now, ct: ct);
    }

    public static AtlasEvent NewEvent(string source, string type, AtlasService? service, string status, string title, DateTime at, string externalId) => new()
    {
        Id = Guid.NewGuid(), At = at, Source = source, Type = type, ProductId = service?.ProductId, ServiceId = service?.Id,
        Status = status, Title = Clean.Cut(title, 300)!, ExternalId = Clean.Cut(externalId, 200),
    };

    /// <summary>A deploy the collector sees in a state worth a line: started, succeeded or failed. One per deploy and state.</summary>
    public static async Task DeployEventAsync(PitwallDb db, string source, AtlasService s, string label, string? deployId, string? deployStatus, string? commitSha, DateTime at)
    {
        if (string.IsNullOrEmpty(deployId)) return;
        string? type = deployStatus switch { "building" => "deploy.started", "success" => "deploy.succeeded", "failed" => "deploy.failed", _ => null };
        if (type is null) return;
        var status = type switch { "deploy.started" => "started", "deploy.succeeded" => "succeeded", _ => "failed" };
        var words = type switch { "deploy.started" => "em andamento", "deploy.succeeded" => "concluído", _ => "falhou" };
        var e = NewEvent(source, type, s, status, $"Deploy de {s.Name} ({label}): {words}", at, $"{deployId}:{status}");
        e.CommitSha = Clean.Cut(commitSha, 64);
        await AtlasEvents.RecordAsync(db, e);
    }

    /// <summary>
    /// Sets MissingSince on each candidate the complete listing did not show, and clears it on those it shows
    /// again, with one event for each change. Callers pass it only after a listing that finished.
    /// </summary>
    public static async Task ApplyPresenceAsync(PitwallDb db, string source, string label, IEnumerable<AtlasService> candidates, Func<AtlasService, bool> seen, DateTime now)
    {
        var minute = now.ToString("yyyyMMddHHmm", CultureInfo.InvariantCulture);
        foreach (var s in candidates)
        {
            if (seen(s))
            {
                if (s.MissingSince is null) continue;
                s.MissingSince = null;
                await AtlasEvents.RecordAsync(db, NewEvent(source, "resource.found", s, "info", $"{s.Name} voltou a aparecer no {label}", now, $"{s.Id:N}:found:{minute}"));
            }
            else if (s.MissingSince is null)
            {
                s.MissingSince = now;
                await AtlasEvents.RecordAsync(db, NewEvent(source, "resource.missing", s, "info", $"{s.Name} não aparece mais no {label}", now, $"{s.Id:N}:missing:{minute}"));
            }
        }
    }
}

/// <summary>Railway: every service of every project, per environment, with its latest deployment.</summary>
public sealed class RailwayCollector(HttpClient http, string? token, string? workspaceId = null) : IAtlasCollector
{
    public const string Endpoint = "https://backboard.railway.com/graphql/v2";
    public string Name => "railway";
    public bool Configured => !string.IsNullOrWhiteSpace(token);

    private async Task<JsonElement> QueryAsync(string query, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, Endpoint)
        {
            Content = new StringContent(JsonSerializer.Serialize(new { query }), Encoding.UTF8, "application/json"),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var body = await AtlasCollect.GetJsonAsync(http, req, ct);
        if (!body.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
            throw new HttpRequestException("A Railway recusou a consulta: " + (body.Items("errors").FirstOrDefault().Str("message") ?? "sem dados"));
        return data;
    }

    private static string Id(string? s) => JsonSerializer.Serialize(s ?? "");

    public static string? Status(string? railway) => railway?.ToUpperInvariant() switch
    {
        "SUCCESS" => "success",
        "BUILDING" or "DEPLOYING" or "QUEUED" or "WAITING" or "INITIALIZING" => "building",
        "FAILED" or "CRASHED" => "failed",
        "SKIPPED" => "skipped",
        "SLEEPING" => "sleeping",
        "REMOVED" => "removed",
        _ => null,
    };

    /// <summary>The key of a service in one environment, as the listing names it.</summary>
    private static string PairKey(string? reference, string? envSlug) => $"{reference}|{envSlug}".ToLowerInvariant();

    public async Task<int> CollectAsync(PitwallDb db, CancellationToken ct)
    {
        var services = await db.AtlasServices.Include(s => s.Environment).Where(s => s.RetiredAt == null && s.Provider == "railway").ToListAsync(ct);
        var unmatched = new List<AtlasCollect.Found>();
        var evidence = new List<Guid>();
        var seenPairs = new HashSet<string>(StringComparer.Ordinal);
        var now = DateTime.UtcNow;

        var args = string.IsNullOrWhiteSpace(workspaceId) ? "" : $"(workspaceId: {Id(workspaceId)})";
        var projects = await QueryAsync($"query {{ projects{args} {{ edges {{ node {{ id name }} }} }} }}", ct);
        foreach (var project in projects.Items("projects", "edges").Select(e => e.GetProperty("node")))
        {
            var projectId = project.Str("id");
            var projectName = project.Str("name") ?? "";
            var shape = await QueryAsync(
                $"query {{ project(id: {Id(projectId)}) {{ services {{ edges {{ node {{ id name }} }} }} environments {{ edges {{ node {{ id name }} }} }} }} }}", ct);
            var pairs = (from s in shape.Items("project", "services", "edges").Select(e => e.GetProperty("node"))
                         from e in shape.Items("project", "environments", "edges").Select(e => e.GetProperty("node"))
                         select (Service: s, Env: e)).ToList();
            // Every pair the listing shows is seen, deployed or not: a service that exists is not missing.
            foreach (var p in pairs) seenPairs.Add(PairKey($"{projectName}/{p.Service.Str("name")}", AtlasCollect.EnvSlug(p.Env.Str("name"))));

            // The latest deployment of each service in each environment, a batch of aliases per request.
            foreach (var chunk in pairs.Chunk(20))
            {
                var fields = chunk.Select((p, i) =>
                    $"d{i}: deployments(first: 1, input: {{ projectId: {Id(projectId)}, environmentId: {Id(p.Env.Str("id"))}, serviceId: {Id(p.Service.Str("id"))} }}) " +
                    "{ edges { node { id status createdAt meta } } }");
                var data = await QueryAsync($"query {{ {string.Join(" ", fields)} }}", ct);
                for (var i = 0; i < chunk.Length; i++)
                {
                    var deployment = data.Items($"d{i}", "edges").Select(e => e.GetProperty("node")).FirstOrDefault();
                    if (deployment.ValueKind != JsonValueKind.Object) continue; // the service does not run in that environment
                    var reference = $"{projectName}/{chunk[i].Service.Str("name")}";
                    var envName = chunk[i].Env.Str("name");
                    var envSlug = AtlasCollect.EnvSlug(envName);
                    var status = Status(deployment.Str("status"));
                    var mine = services.Where(s => AtlasCollect.Same(s.ExternalRef, reference)
                                                   && AtlasCollect.Same(s.Environment?.Slug, envSlug)).ToList();
                    if (mine.Count == 0)
                    {
                        if (status != "removed") unmatched.Add(new($"{reference}@{envName}", reference, envName));
                        continue;
                    }
                    var deployedAt = AtlasCollect.Instant(deployment.Str("createdAt"));
                    foreach (var s in mine)
                    {
                        evidence.Add((await AtlasCollect.VerifyAsync(db, s, Name, "railway", $"{reference}@{envSlug}", now, ct)).Id);
                        s.DeployStatus = status;
                        s.LastDeployAt = deployedAt;
                        s.CommitSha = Clean.Cut(deployment.Str("meta", "commitHash"), 64);
                        await AtlasCollect.DeployEventAsync(db, Name, s, "Railway", deployment.Str("id"), status, s.CommitSha, deployedAt ?? now);
                    }
                }
            }
        }

        await AtlasCollect.SyncDiscoveriesAsync(db, Name, "service", unmatched, ct);
        // The listing finished, so a service whose pair did not show is missing.
        await AtlasCollect.ApplyPresenceAsync(db, Name, "Railway",
            services.Where(s => s.ExternalRef is not null && s.Environment is not null),
            s => seenPairs.Contains(PairKey(s.ExternalRef, s.Environment!.Slug)), now);
        await AtlasEvidenceWriter.MarkGoneAsync(db, $"collector:{Name}", evidence, now, ct);
        await db.SaveChangesAsync(ct);
        return seenPairs.Count;
    }
}

/// <summary>GitHub: repositories (listed by the App or the token), each one's metadata, last pipeline run, a week of activity and open alerts.</summary>
public sealed class GitHubCollector(HttpClient http, IAtlasGitHubAuth auth) : IAtlasCollector
{
    public const string Api = "https://api.github.com";
    public const string ArchivedFact = "github:archived";
    public string Name => "github";
    public bool Configured => auth.Configured;

    // The token is asked for on every request: whatever the auth holds decides how long it lives.
    private Task<HttpRequestMessage> GetAsync(CancellationToken ct, string path) => GitHubApi.GetAsync(auth, path, ct);

    public static string RunStatus(string? status, string? conclusion) => (status, conclusion) switch
    {
        ("completed", "success") => "success",
        ("completed", "failure" or "timed_out" or "startup_failure") => "failure",
        ("completed", "cancelled") => "cancelled",
        ("completed", _) => "other",
        _ => "running",
    };

    /// <summary>The event of a pipeline run in one of its states. The id of the run makes it the same event from the poll and from the webhook.</summary>
    public static AtlasEvent? CiEvent(AtlasRepo repo, string? runId, string runStatus, string? runName, string? url, string? sha, DateTime at)
    {
        if (runId is null) return null;
        string? type = runStatus switch { "running" => "ci.started", "success" => "ci.succeeded", "failure" => "ci.failed", _ => null };
        if (type is null) return null;
        var status = type switch { "ci.started" => "started", "ci.succeeded" => "succeeded", _ => "failed" };
        var words = type switch { "ci.started" => "em andamento", "ci.succeeded" => "passou", _ => "falhou" };
        var e = AtlasCollect.NewEvent("github", type, null, status, $"CI {runName ?? "pipeline"} em {repo.FullName}: {words}", at, $"run:{runId}:{runStatus}");
        e.ProductId = repo.ProductId;
        e.RepoId = repo.Id;
        e.Url = Clean.Cut(url, 500);
        e.CommitSha = Clean.Cut(sha, 64);
        return e;
    }

    /// <summary>
    /// The repository's stack after a read: languages (their share of the code) and the archived flag replace
    /// the old ones; every other fact (the ones the scan wrote) stays as it is.
    /// </summary>
    public static List<AtlasFact> MergeStack(IEnumerable<AtlasFact> current, JsonElement languages, bool archived)
    {
        var kept = current.Where(f => !f.Key.StartsWith("language:", StringComparison.Ordinal) && f.Key != ArchivedFact).ToList();
        if (languages.ValueKind == JsonValueKind.Object)
        {
            var sizes = languages.EnumerateObject()
                .Select(p => (Name: p.Name, Bytes: p.Value.ValueKind == JsonValueKind.Number && p.Value.TryGetInt64(out var b) ? b : 0L))
                .Where(x => x.Bytes > 0).OrderByDescending(x => x.Bytes).Take(8).ToList();
            var total = sizes.Sum(x => x.Bytes);
            foreach (var l in sizes)
            {
                var share = Math.Round(l.Bytes * 100.0 / total).ToString(CultureInfo.InvariantCulture);
                kept.Add(new AtlasFact { Key = Clean.Cut("language:" + l.Name, 80)!, Value = share + "%" });
            }
        }
        if (archived) kept.Add(new AtlasFact { Key = ArchivedFact, Value = "sim" });
        return kept;
    }

    public async Task<int> CollectAsync(PitwallDb db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var since = now.AddDays(-7).ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);

        // The listing comes first: a repository renamed on GitHub is found by its id, and its name is brought up
        // to date before anything is read by name.
        var listing = await GitHubRepoList.FetchAsync(http, auth, ct);
        var repos = await db.AtlasRepos.Where(r => r.RetiredAt == null).ToListAsync(ct);
        var evidence = new List<Guid>();
        foreach (var item in listing)
        {
            var repo = repos.FirstOrDefault(r => r.ExternalId == item.Id)
                ?? repos.FirstOrDefault(r => r.ExternalId == null && r.FullName == item.FullName);
            if (repo is null) continue;
            repo.ExternalId = item.Id;
            repo.FullName = item.FullName;
            evidence.Add((await AtlasEvidenceWriter.UpsertAsync(db, "repo", repo.Id, "collector:github", "api",
                $"github:{repo.FullName}", AtlasScopes.Runtime, now, ct: ct)).Id);
        }
        await AtlasEvidenceWriter.MarkGoneAsync(db, "collector:github", evidence, now, ct);

        foreach (var repo in repos)
        {
            try
            {
                var meta = await AtlasCollect.GetJsonAsync(http, await GetAsync(ct, $"/repos/{repo.FullName}"), ct);
                repo.DefaultBranch = Clean.Cut(meta.Str("default_branch"), 100) ?? repo.DefaultBranch;
                repo.ExternalId = meta.Scalar("id") ?? repo.ExternalId;
                var archived = meta.TryGetProperty("archived", out var a) && a.ValueKind == JsonValueKind.True;
                var languages = await AtlasCollect.GetJsonAsync(http, await GetAsync(ct, $"/repos/{repo.FullName}/languages"), ct);
                repo.Stack = MergeStack(repo.Stack, languages, archived);
                var pulls = await AtlasCollect.GetJsonAsync(http, await GetAsync(ct, $"/repos/{repo.FullName}/pulls?state=open&per_page=100"), ct);
                repo.OpenPullRequests = pulls.ValueKind == JsonValueKind.Array ? pulls.GetArrayLength() : null;
            }
            catch (HttpRequestException ex) when (ex.StatusCode is System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.Conflict)
            {
                // Gone, renamed, empty, or out of the token's reach: the row keeps what it had.
            }
            try
            {
                var runs = await AtlasCollect.GetJsonAsync(http, await GetAsync(ct, $"/repos/{repo.FullName}/actions/runs?per_page=20"), ct);
                var last = runs.Items("workflow_runs").FirstOrDefault(r => r.Str("event") != "pull_request");
                if (last.ValueKind == JsonValueKind.Object)
                {
                    var runStatus = RunStatus(last.Str("status"), last.Str("conclusion"));
                    var at = AtlasCollect.Instant(last.Str("created_at")) ?? now;
                    repo.LastRunName = Clean.Cut(last.Str("name"), 200);
                    repo.LastRunStatus = runStatus;
                    repo.LastRunAt = at;
                    repo.LastRunUrl = Clean.Cut(last.Str("html_url"), 500);
                    repo.LastRunSha = Clean.Cut(last.Str("head_sha"), 64);
                    var ci = CiEvent(repo, last.Scalar("id"), runStatus, repo.LastRunName, repo.LastRunUrl, repo.LastRunSha, at);
                    if (ci is not null) await AtlasEvents.RecordAsync(db, ci);
                }
                var week = Uri.EscapeDataString(">=" + since);
                repo.Runs7d = Total(await AtlasCollect.GetJsonAsync(http, await GetAsync(ct, $"/repos/{repo.FullName}/actions/runs?per_page=1&created={week}"), ct));
                repo.FailedRuns7d = Total(await AtlasCollect.GetJsonAsync(http, await GetAsync(ct, $"/repos/{repo.FullName}/actions/runs?per_page=1&status=failure&created={week}"), ct));
                var commits = await AtlasCollect.GetJsonAsync(http, await GetAsync(ct, $"/repos/{repo.FullName}/commits?per_page=100&since={Uri.EscapeDataString(since)}"), ct);
                repo.Commits7d = commits.ValueKind == JsonValueKind.Array ? commits.GetArrayLength() : null;
            }
            catch (HttpRequestException ex) when (ex.StatusCode is System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.Conflict)
            {
                // Gone, renamed, empty, or out of the token's reach: the row keeps what it had.
            }
            try
            {
                var alerts = await AtlasCollect.GetJsonAsync(http, await GetAsync(ct, $"/repos/{repo.FullName}/dependabot/alerts?state=open&per_page=100"), ct);
                repo.OpenAlerts = alerts.ValueKind == JsonValueKind.Array ? alerts.GetArrayLength() : null;
            }
            catch (HttpRequestException ex) when (ex.StatusCode is System.Net.HttpStatusCode.Forbidden or System.Net.HttpStatusCode.NotFound)
            {
                repo.OpenAlerts = null; // alerts are off, or the token cannot read them
            }
            repo.CheckedAt = now;
        }

        var unmatched = listing
            .Where(r => !r.Archived && !r.Fork && repos.All(x => x.ExternalId != r.Id) && repos.All(x => x.FullName != r.FullName))
            .Select(r => new AtlasCollect.Found(r.FullName, r.FullName, null, r.Url)).ToList();
        await AtlasCollect.SyncDiscoveriesAsync(db, Name, "repo", unmatched, ct);
        await db.SaveChangesAsync(ct);
        return listing.Count;
    }

    private static int? Total(JsonElement e) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty("total_count", out var n) && n.TryGetInt32(out var v) ? v : null;
}

/// <summary>Uptime Kuma: the state of every monitor, read from its Prometheus metrics with an API key.</summary>
public sealed partial class KumaCollector(HttpClient http, string? url, string? apiKey) : IAtlasCollector
{
    public string Name => "kuma";
    public bool Configured => !string.IsNullOrWhiteSpace(url) && !string.IsNullOrWhiteSpace(apiKey);

    [GeneratedRegex(@"^monitor_status\{(?<labels>.*)\}\s+(?<value>\d+)", RegexOptions.Multiline)]
    private static partial Regex StatusLine();
    [GeneratedRegex(@"(?<key>\w+)=""(?<value>(?:[^""\\]|\\.)*)""")]
    private static partial Regex Label();

    public sealed record Monitor(string Name, string Status, string? Url);

    public static List<Monitor> Parse(string metrics) => StatusLine().Matches(metrics).Select(m =>
    {
        var labels = Label().Matches(m.Groups["labels"].Value)
            .ToDictionary(l => l.Groups["key"].Value, l => l.Groups["value"].Value.Replace("\\\"", "\"").Replace("\\\\", "\\"));
        var status = m.Groups["value"].Value switch { "1" => "up", "0" => "down", "2" => "pending", "3" => "maintenance", _ => "pending" };
        var monitorUrl = labels.GetValueOrDefault("monitor_url");
        return new Monitor(labels.GetValueOrDefault("monitor_name") ?? "", status, monitorUrl is null or "null" or "https://" ? null : monitorUrl);
    }).Where(m => m.Name.Length > 0).ToList();

    public async Task<int> CollectAsync(PitwallDb db, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url!.TrimEnd('/') + "/metrics");
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(":" + apiKey)));
        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) throw new HttpRequestException($"O Uptime Kuma respondeu {(int)res.StatusCode}.", null, res.StatusCode);
        var monitors = Parse(await res.Content.ReadAsStringAsync(ct));

        var services = await db.AtlasServices.Where(s => s.RetiredAt == null && s.MonitorRef != null).ToListAsync(ct);
        var now = DateTime.UtcNow;
        var unmatched = new List<AtlasCollect.Found>();
        var evidence = new List<Guid>();
        foreach (var m in monitors)
        {
            var mine = services.Where(s => AtlasCollect.Same(s.MonitorRef, m.Name)).ToList();
            if (mine.Count == 0) { unmatched.Add(new(m.Name, m.Name, null, m.Url)); continue; }
            foreach (var s in mine)
            {
                var previous = s.MonitorStatus;
                s.MonitorStatus = m.Status;
                evidence.Add((await AtlasCollect.VerifyAsync(db, s, Name, "kuma", m.Name, now, ct)).Id);
                await MonitorEventAsync(db, s, m, previous, now);
            }
        }
        // A monitor that was removed stops vouching for its service.
        foreach (var s in services.Where(s => monitors.All(m => !AtlasCollect.Same(s.MonitorRef, m.Name)))) s.MonitorStatus = null;
        await AtlasCollect.SyncDiscoveriesAsync(db, Name, "monitor", unmatched, ct);
        await AtlasEvidenceWriter.MarkGoneAsync(db, $"collector:{Name}", evidence, now, ct);
        await db.SaveChangesAsync(ct);
        return monitors.Count;
    }

    /// <summary>Only a change between up and down is news; the first sight of a healthy monitor is not.</summary>
    private static async Task MonitorEventAsync(PitwallDb db, AtlasService s, Monitor m, string? previous, DateTime now)
    {
        if (m.Status is not ("up" or "down") || previous == m.Status) return;
        if (previous is null && m.Status == "up") return;
        var (type, status, words) = m.Status == "down" ? ("monitor.down", "failed", "fora do ar") : ("monitor.up", "succeeded", "no ar");
        await AtlasEvents.RecordAsync(db, AtlasCollect.NewEvent("kuma", type, s, status, $"{s.Name}: monitor {words}", now, $"{m.Name}:{m.Status}:{now:yyyyMMddHHmm}"));
    }
}

/// <summary>Vercel: every project with its latest production deployment.</summary>
public sealed class VercelCollector(HttpClient http, string? token, string? teamId = null) : IAtlasCollector
{
    public const string Api = "https://api.vercel.com";
    public string Name => "vercel";
    public bool Configured => !string.IsNullOrWhiteSpace(token);

    private HttpRequestMessage Get(string path)
    {
        var team = string.IsNullOrWhiteSpace(teamId) ? "" : $"&teamId={Uri.EscapeDataString(teamId)}";
        var req = new HttpRequestMessage(HttpMethod.Get, Api + path + team);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return req;
    }

    public static string? Status(string? state) => state?.ToUpperInvariant() switch
    {
        "READY" => "success",
        "BUILDING" or "INITIALIZING" or "QUEUED" => "building",
        "ERROR" => "failed",
        _ => null,
    };

    /// <summary>Every project, page by page. A listing that stops early is not complete, and missing is not decided from it.</summary>
    private async Task<List<JsonElement>> ProjectsAsync(CancellationToken ct)
    {
        var all = new List<JsonElement>();
        string? until = null;
        for (var page = 0; page < 50; page++)
        {
            var body = await AtlasCollect.GetJsonAsync(http, Get("/v10/projects?limit=100" + (until is null ? "" : "&until=" + Uri.EscapeDataString(until))), ct);
            all.AddRange(body.ValueKind == JsonValueKind.Array ? body.EnumerateArray() : body.Items("projects"));
            var pagination = body.ValueKind == JsonValueKind.Object && body.TryGetProperty("pagination", out var pg) ? pg : default;
            until = pagination.Scalar("next");
            if (until is null) break;
        }
        return all;
    }

    public async Task<int> CollectAsync(PitwallDb db, CancellationToken ct)
    {
        var services = await db.AtlasServices.Where(s => s.RetiredAt == null && s.Provider == "vercel").ToListAsync(ct);
        var now = DateTime.UtcNow;
        var unmatched = new List<AtlasCollect.Found>();
        var evidence = new List<Guid>();
        var seenProjects = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var projects = await ProjectsAsync(ct);
        foreach (var project in projects)
        {
            var name = project.Str("name") ?? "";
            seenProjects.Add(name);
            var mine = services.Where(s => AtlasCollect.Same(s.ExternalRef, name)).ToList();
            if (mine.Count == 0) { unmatched.Add(new(name, name, "production")); continue; }
            var deployments = await AtlasCollect.GetJsonAsync(http,
                Get($"/v7/deployments?projectId={Uri.EscapeDataString(project.Str("id") ?? name)}&target=production&limit=1"), ct);
            var last = deployments.Items("deployments").FirstOrDefault();
            foreach (var s in mine)
            {
                evidence.Add((await AtlasCollect.VerifyAsync(db, s, Name, "vercel", name, now, ct)).Id);
                if (last.ValueKind != JsonValueKind.Object) continue;
                s.DeployStatus = Status(last.Str("state") ?? last.Str("readyState"));
                var deployedAt = last.TryGetProperty("created", out var created) && created.TryGetInt64(out var ms)
                    ? DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime : (DateTime?)null;
                if (deployedAt is not null) s.LastDeployAt = deployedAt;
                s.CommitSha = Clean.Cut(last.Str("meta", "githubCommitSha"), 64);
                await AtlasCollect.DeployEventAsync(db, Name, s, "Vercel", last.Str("uid") ?? last.Str("id"), s.DeployStatus, s.CommitSha, deployedAt ?? now);
            }
        }
        await AtlasCollect.SyncDiscoveriesAsync(db, Name, "service", unmatched, ct);
        await AtlasCollect.ApplyPresenceAsync(db, Name, "Vercel",
            services.Where(s => s.ExternalRef is not null), s => seenProjects.Contains(s.ExternalRef!), now);
        await AtlasEvidenceWriter.MarkGoneAsync(db, $"collector:{Name}", evidence, now, ct);
        await db.SaveChangesAsync(ct);
        return projects.Count;
    }
}
