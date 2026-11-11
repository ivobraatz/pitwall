using System.Collections.Concurrent;
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
 */

public interface IAtlasCollector
{
    string Name { get; }
    bool Configured { get; }
    Task CollectAsync(PitwallDb db, CancellationToken ct);
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
                try
                {
                    using var scope = scopes.CreateScope();
                    // What a collector writes is history under the collector's name, not "Sistema".
                    var actor = scope.ServiceProvider.GetRequiredService<AtlasActor>();
                    actor.Name = collector.Name;
                    actor.Source = "collector";
                    await collector.CollectAsync(scope.ServiceProvider.GetRequiredService<PitwallDb>(), ct);
                    status.Set(collector.Name, null);
                }
                catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
                {
                    // The message of an HTTP failure carries the status, never the token.
                    logger.LogWarning("Atlas collector {Name} failed: {Message}", collector.Name, ex.Message);
                    status.Set(collector.Name, Clean.Cut(ex.Message, 300) ?? "Falhou.");
                }
            }
        }
        finally { _one.Release(); }
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

    public static IEnumerable<JsonElement> Items(this JsonElement e, params string[] path)
    {
        foreach (var p in path)
        {
            if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(p, out e)) return [];
        }
        return e.ValueKind == JsonValueKind.Array ? e.EnumerateArray().ToList() : [];
    }

    public static DateTime? Instant(string? iso) =>
        DateTimeOffset.TryParse(iso, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal, out var d) ? d.UtcDateTime : null;
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

    public async Task CollectAsync(PitwallDb db, CancellationToken ct)
    {
        var services = await db.AtlasServices.Include(s => s.Environment).Where(s => s.Provider == "railway").ToListAsync(ct);
        var unmatched = new List<AtlasCollect.Found>();
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
                    var status = Status(deployment.Str("status"));
                    var mine = services.Where(s => AtlasCollect.Same(s.ExternalRef, reference)
                                                   && AtlasCollect.Same(s.Environment?.Slug, AtlasCollect.EnvSlug(envName))).ToList();
                    if (mine.Count == 0)
                    {
                        if (status != "removed") unmatched.Add(new($"{reference}@{envName}", reference, envName));
                        continue;
                    }
                    foreach (var s in mine)
                    {
                        s.DeployStatus = status;
                        s.LastDeployAt = AtlasCollect.Instant(deployment.Str("createdAt"));
                        s.CommitSha = Clean.Cut(deployment.Str("meta", "commitHash"), 64);
                        s.CheckedAt = now;
                    }
                }
            }
        }
        await AtlasCollect.SyncDiscoveriesAsync(db, Name, "service", unmatched, ct);
        await db.SaveChangesAsync(ct);
    }
}

/// <summary>GitHub: the last pipeline run, a week of commits and runs, and open dependency alerts of each repository.</summary>
public sealed class GitHubCollector(HttpClient http, IAtlasGitHubAuth auth) : IAtlasCollector
{
    public const string Api = "https://api.github.com";
    public string Name => "github";
    public bool Configured => auth.Configured;

    // The token is asked for on every request: whatever the auth holds decides how long it lives.
    private async Task<HttpRequestMessage> GetAsync(CancellationToken ct, string path)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, Api + path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await auth.TokenAsync(ct));
        req.Headers.UserAgent.ParseAdd("Pitwall-Atlas/1.0");
        req.Headers.Accept.ParseAdd("application/vnd.github+json");
        req.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        return req;
    }

    public static string RunStatus(string? status, string? conclusion) => (status, conclusion) switch
    {
        ("completed", "success") => "success",
        ("completed", "failure" or "timed_out" or "startup_failure") => "failure",
        ("completed", "cancelled") => "cancelled",
        ("completed", _) => "other",
        _ => "running",
    };

    public async Task CollectAsync(PitwallDb db, CancellationToken ct)
    {
        var repos = await db.AtlasRepos.ToListAsync(ct);
        var now = DateTime.UtcNow;
        var since = now.AddDays(-7).ToString("yyyy-MM-ddTHH:mm:ssZ");
        foreach (var repo in repos)
        {
            try
            {
                var runs = await AtlasCollect.GetJsonAsync(http, await GetAsync(ct, $"/repos/{repo.FullName}/actions/runs?per_page=20"), ct);
                var last = runs.Items("workflow_runs").FirstOrDefault(r => r.Str("event") != "pull_request");
                if (last.ValueKind == JsonValueKind.Object)
                {
                    repo.LastRunName = Clean.Cut(last.Str("name"), 200);
                    repo.LastRunStatus = RunStatus(last.Str("status"), last.Str("conclusion"));
                    repo.LastRunAt = AtlasCollect.Instant(last.Str("created_at"));
                    repo.LastRunUrl = Clean.Cut(last.Str("html_url"), 500);
                    repo.LastRunSha = Clean.Cut(last.Str("head_sha"), 64);
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

        var mine = await AtlasCollect.GetJsonAsync(http, await GetAsync(ct, "/user/repos?affiliation=owner&sort=pushed&per_page=100"), ct);
        var unmatched = (mine.ValueKind == JsonValueKind.Array ? mine.EnumerateArray().ToList() : [])
            .Where(r => r.TryGetProperty("archived", out var a) && a.ValueKind == JsonValueKind.False
                        && r.TryGetProperty("fork", out var f) && f.ValueKind == JsonValueKind.False)
            .Select(r => (FullName: r.Str("full_name")?.ToLowerInvariant(), Url: r.Str("html_url")))
            .Where(r => r.FullName is not null && repos.All(x => x.FullName != r.FullName))
            .Select(r => new AtlasCollect.Found(r.FullName!, r.FullName!, null, r.Url)).ToList();
        await AtlasCollect.SyncDiscoveriesAsync(db, Name, "repo", unmatched, ct);
        await db.SaveChangesAsync(ct);
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

    public async Task CollectAsync(PitwallDb db, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url!.TrimEnd('/') + "/metrics");
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(":" + apiKey)));
        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) throw new HttpRequestException($"O Uptime Kuma respondeu {(int)res.StatusCode}.", null, res.StatusCode);
        var monitors = Parse(await res.Content.ReadAsStringAsync(ct));

        var services = await db.AtlasServices.Where(s => s.MonitorRef != null).ToListAsync(ct);
        var now = DateTime.UtcNow;
        var unmatched = new List<AtlasCollect.Found>();
        foreach (var m in monitors)
        {
            var mine = services.Where(s => AtlasCollect.Same(s.MonitorRef, m.Name)).ToList();
            if (mine.Count == 0) { unmatched.Add(new(m.Name, m.Name, null, m.Url)); continue; }
            foreach (var s in mine) { s.MonitorStatus = m.Status; s.CheckedAt = now; }
        }
        // A monitor that was removed stops vouching for its service.
        foreach (var s in services.Where(s => monitors.All(m => !AtlasCollect.Same(s.MonitorRef, m.Name)))) s.MonitorStatus = null;
        await AtlasCollect.SyncDiscoveriesAsync(db, Name, "monitor", unmatched, ct);
        await db.SaveChangesAsync(ct);
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

    public async Task CollectAsync(PitwallDb db, CancellationToken ct)
    {
        var services = await db.AtlasServices.Where(s => s.Provider == "vercel").ToListAsync(ct);
        var now = DateTime.UtcNow;
        var unmatched = new List<AtlasCollect.Found>();
        var list = await AtlasCollect.GetJsonAsync(http, Get("/v10/projects?limit=100"), ct);
        var projects = list.ValueKind == JsonValueKind.Array ? list.EnumerateArray().ToList() : list.Items("projects").ToList();
        foreach (var project in projects)
        {
            var name = project.Str("name") ?? "";
            var mine = services.Where(s => AtlasCollect.Same(s.ExternalRef, name)).ToList();
            if (mine.Count == 0) { unmatched.Add(new(name, name, "production")); continue; }
            var deployments = await AtlasCollect.GetJsonAsync(http,
                Get($"/v7/deployments?projectId={Uri.EscapeDataString(project.Str("id") ?? name)}&target=production&limit=1"), ct);
            var last = deployments.Items("deployments").FirstOrDefault();
            foreach (var s in mine)
            {
                s.CheckedAt = now;
                if (last.ValueKind != JsonValueKind.Object) continue;
                s.DeployStatus = Status(last.Str("state") ?? last.Str("readyState"));
                if (last.TryGetProperty("created", out var created) && created.TryGetInt64(out var ms))
                    s.LastDeployAt = DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime;
                s.CommitSha = Clean.Cut(last.Str("meta", "githubCommitSha"), 64);
            }
        }
        await AtlasCollect.SyncDiscoveriesAsync(db, Name, "service", unmatched, ct);
        await db.SaveChangesAsync(ct);
    }
}
