using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Atlas;
using static Pitwall.Tests.TeamTaskKit;

namespace Pitwall.Tests;

/// <summary>
/// Each collector against a canned provider: what it writes onto registered services and
/// repositories, what becomes a discovery, and that the token only ever travels in the header.
/// </summary>
public class AtlasCollectorTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private const string Token = "token-de-teste-somente-leitura";

    /// <summary>Answers by the first rule whose text is in the URL or the body; records every request.</summary>
    private sealed class Provider : HttpMessageHandler
    {
        private readonly List<(string Match, HttpStatusCode Status, string Body)> _rules = [];
        public List<(string Url, string Body, string? Authorization)> Requests { get; } = [];

        public Provider On(string match, string body, HttpStatusCode status = HttpStatusCode.OK)
        {
            _rules.Add((match, status, body));
            return this;
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var url = request.RequestUri!.ToString();
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            Requests.Add((url, body, request.Headers.Authorization?.ToString()));
            foreach (var (match, status, answer) in _rules)
                if (url.Contains(match) || body.Contains(match))
                    return new HttpResponseMessage(status) { Content = new StringContent(answer, Encoding.UTF8, "application/json") };
            return new HttpResponseMessage(HttpStatusCode.NotFound) { Content = new StringContent("{}") };
        }
    }

    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..(prefix.Length + 9)];

    private async Task<(Guid ProductId, AtlasEnvironment Production)> SeedSystemAsync()
    {
        var product = new Product { Id = Guid.NewGuid(), Slug = Unique("acme"), Name = "Acme", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
        AtlasEnvironment production = null!;
        await WithDbAsync(fx, async db =>
        {
            db.Products.Add(product);
            production = await db.AtlasEnvironments.FirstOrDefaultAsync(e => e.Slug == "production")
                ?? db.AtlasEnvironments.Add(new AtlasEnvironment { Id = Guid.NewGuid(), Slug = "production", Name = "Produção", CreatedAt = DateTime.UtcNow }).Entity;
            await db.SaveChangesAsync();
        });
        return (product.Id, production);
    }

    private async Task<AtlasService> SeedServiceAsync(Guid productId, Guid? environmentId, string name, string? provider = null, string? externalRef = null, string? monitor = null)
    {
        var service = new AtlasService
        {
            Id = Guid.NewGuid(), ProductId = productId, EnvironmentId = environmentId, Name = name, Provider = provider,
            ExternalRef = externalRef, MonitorRef = monitor, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            Key = $"teste:{Guid.NewGuid():N}",
        };
        await WithDbAsync(fx, async db => { db.AtlasServices.Add(service); await db.SaveChangesAsync(); });
        return service;
    }

    private async Task CollectAsync(IAtlasCollector collector)
    {
        Assert.True(collector.Configured);
        using var scope = fx.Factory.Services.CreateScope();
        await collector.CollectAsync(scope.ServiceProvider.GetRequiredService<PitwallDb>(), CancellationToken.None);
    }

    private async Task<T> ReadAsync<T>(Func<PitwallDb, Task<T>> read)
    {
        using var scope = fx.Factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<PitwallDb>());
    }

    [Fact]
    public void A_collector_without_its_token_is_not_connected()
    {
        var http = new HttpClient(new Provider());
        Assert.False(new RailwayCollector(http, null).Configured);
        Assert.False(new GitHubCollector(http, new PatGitHubAuth(" ")).Configured);
        Assert.False(new KumaCollector(http, "https://status.example.com", null).Configured);
        Assert.False(new KumaCollector(http, null, "chave").Configured);
        Assert.False(new VercelCollector(http, "").Configured);
    }

    [Fact]
    public async Task Railway_writes_the_latest_deploy_and_finds_what_is_not_registered()
    {
        var (productId, production) = await SeedSystemAsync();
        var project = Unique("acme");
        var api = await SeedServiceAsync(productId, production.Id, "API", "railway", $"{project}/api");
        var provider = new Provider()
            .On("query { me {", """{"data":{"me":{"workspaces":[]}}}""")
            .On("projects", "{\"data\":{\"projects\":{\"edges\":[{\"node\":{\"id\":\"p1\",\"name\":\"" + project + "\"}}]}}}")
            .On("project(id", """{"data":{"project":{"services":{"edges":[{"node":{"id":"s1","name":"api"}},{"node":{"id":"s2","name":"worker"}}]},"environments":{"edges":[{"node":{"id":"e1","name":"production"}},{"node":{"id":"e2","name":"staging"}}]}}}}""")
            .On("deployments(first", """
                {"data":{
                  "d0":{"edges":[{"node":{"id":"d-1","status":"SUCCESS","createdAt":"2026-11-08T12:00:00.000Z","meta":{"commitHash":"abc1234def"}}}]},
                  "d1":{"edges":[]},
                  "d2":{"edges":[{"node":{"id":"d-2","status":"CRASHED","createdAt":"2026-11-07T09:00:00.000Z","meta":{}}}]},
                  "d3":{"edges":[]}
                }}
                """);
        await CollectAsync(new RailwayCollector(new HttpClient(provider), Token));

        var seen = await ReadAsync(db => db.AtlasServices.SingleAsync(s => s.Id == api.Id));
        Assert.Equal("success", seen.DeployStatus);
        Assert.Equal("abc1234def", seen.CommitSha);
        Assert.Equal(new DateTime(2026, 11, 8, 12, 0, 0, DateTimeKind.Utc), seen.LastDeployAt);
        Assert.Equal(AtlasStates.Up, seen.State);

        // The worker runs in production and nobody registered it; api/staging and worker/staging have no deploy, so they do not exist.
        var found = await ReadAsync(db => db.AtlasDiscoveries.Where(d => d.Source == "railway" && d.Name.StartsWith(project)).ToListAsync());
        var worker = Assert.Single(found);
        Assert.Equal($"{project}/worker", worker.Name);
        Assert.Equal("production", worker.Environment);

        Assert.All(provider.Requests, r => Assert.Equal($"Bearer {Token}", r.Authorization));
        Assert.All(provider.Requests, r => Assert.DoesNotContain(Token, r.Url + r.Body));
        Assert.Equal(RailwayCollector.Endpoint, provider.Requests[0].Url);
    }

    [Theory]
    [InlineData("SUCCESS", "success")]
    [InlineData("BUILDING", "building")]
    [InlineData("DEPLOYING", "building")]
    [InlineData("CRASHED", "failed")]
    [InlineData("SKIPPED", "skipped")]
    [InlineData("SLEEPING", "sleeping")]
    [InlineData("SOMETHING_NEW", null)]
    public void Railway_statuses_map_to_the_atlas_words(string railway, string? expected) =>
        Assert.Equal(expected, RailwayCollector.Status(railway));

    [Fact]
    public async Task Railway_reports_a_refused_query_without_the_token()
    {
        var provider = new Provider()
            .On("query { me {", """{"data":{"me":{"workspaces":[]}}}""")
            .On("projects", """{"errors":[{"message":"Not Authorized"}]}""");
        var error = await Assert.ThrowsAsync<HttpRequestException>(() => CollectAsync(new RailwayCollector(new HttpClient(provider), Token)));
        Assert.Contains("Not Authorized", error.Message);
        Assert.DoesNotContain(Token, error.Message);
    }

    /// <summary>
    /// A Railway account whose one service runs in production. The workspace is listed by its id, the personal
    /// projects by the query without arguments; "me" names the workspace when asked.
    /// </summary>
    private static Provider RailwayRoundWithWorkspace(string workspace, string project, string personalEdges, string workspaceEdges, bool withMe = true)
    {
        var provider = new Provider()
            .On(workspace, "{\"data\":{\"projects\":{\"edges\":" + workspaceEdges + "}}}")
            .On("query { projects {", "{\"data\":{\"projects\":{\"edges\":" + personalEdges + "}}}")
            .On("project(id", """{"data":{"project":{"services":{"edges":[{"node":{"id":"s1","name":"api"}}]},"environments":{"edges":[{"node":{"id":"e1","name":"production"}}]}}}}""")
            .On("deployments(first", """{"data":{"d0":{"edges":[{"node":{"id":"d-1","status":"SUCCESS","createdAt":"2026-11-08T12:00:00.000Z","meta":{}}}]}}}""");
        if (withMe)
            provider.On("query { me {", "{\"data\":{\"me\":{\"workspaces\":[{\"id\":\"" + workspace + "\",\"name\":\"Time\"}]}}}");
        return provider;
    }

    [Fact]
    public async Task Railway_without_a_workspace_id_reads_the_projects_of_every_workspace()
    {
        var (productId, production) = await SeedSystemAsync();
        var project = Unique("acme");
        var api = await SeedServiceAsync(productId, production.Id, "API", "railway", $"{project}/api");
        var workspace = Unique("ws");
        var provider = RailwayRoundWithWorkspace(workspace, project, "[]", $"[{{\"node\":{{\"id\":\"pw1\",\"name\":\"{project}\"}}}}]");
        await CollectAsync(new RailwayCollector(new HttpClient(provider), Token));

        Assert.Single(provider.Requests, r => r.Body.Contains("query { me {"));
        Assert.Contains(provider.Requests, r => r.Body.Contains(workspace));
        var seen = await ReadAsync(db => db.AtlasServices.SingleAsync(s => s.Id == api.Id));
        Assert.Equal("success", seen.DeployStatus);
    }

    [Fact]
    public async Task Railway_counts_a_project_listed_as_personal_and_in_a_workspace_once()
    {
        var (productId, production) = await SeedSystemAsync();
        var project = Unique("acme");
        var api = await SeedServiceAsync(productId, production.Id, "API", "railway", $"{project}/api");
        var workspace = Unique("ws");
        var edges = $"[{{\"node\":{{\"id\":\"pw1\",\"name\":\"{project}\"}}}}]";
        var provider = RailwayRoundWithWorkspace(workspace, project, edges, edges);
        await CollectAsync(new RailwayCollector(new HttpClient(provider), Token));

        Assert.Single(provider.Requests, r => r.Body.Contains("project(id"));
        var seen = await ReadAsync(db => db.AtlasServices.SingleAsync(s => s.Id == api.Id));
        Assert.Equal("success", seen.DeployStatus);
    }

    [Fact]
    public async Task Railway_with_a_workspace_id_reads_only_that_workspace()
    {
        var (productId, production) = await SeedSystemAsync();
        var project = Unique("acme");
        var api = await SeedServiceAsync(productId, production.Id, "API", "railway", $"{project}/api");
        var workspace = Unique("ws");
        var provider = RailwayRoundWithWorkspace(workspace, project, "[]", $"[{{\"node\":{{\"id\":\"pw1\",\"name\":\"{project}\"}}}}]", withMe: false);
        await CollectAsync(new RailwayCollector(new HttpClient(provider), Token, workspace));

        Assert.DoesNotContain(provider.Requests, r => r.Body.Contains("query { me {"));
        // The query travels JSON-encoded (quotes become "), so match the argument and the id apart.
        Assert.Contains(provider.Requests, r => r.Body.Contains("projects(workspaceId:") && r.Body.Contains(workspace));
        var seen = await ReadAsync(db => db.AtlasServices.SingleAsync(s => s.Id == api.Id));
        Assert.Equal("success", seen.DeployStatus);
    }

    [Fact]
    public async Task GitHub_reads_the_pipeline_and_the_alerts_of_each_repository()
    {
        var (productId, _) = await SeedSystemAsync();
        var name = $"acme-inc/{Unique("rockets")}";
        var locked = $"acme-inc/{Unique("vault")}";
        await WithDbAsync(fx, async db =>
        {
            db.AtlasRepos.Add(new AtlasRepo { Id = Guid.NewGuid(), ProductId = productId, FullName = name, CreatedAt = DateTime.UtcNow });
            db.AtlasRepos.Add(new AtlasRepo { Id = Guid.NewGuid(), ProductId = productId, FullName = locked, OpenAlerts = 9, CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        });
        var unknown = $"acme-inc/{Unique("skunkworks")}";
        var provider = new Provider()
            .On($"/repos/{name}/actions/runs?per_page=20", """
                {"total_count":40,"workflow_runs":[
                  {"name":"PR check","event":"pull_request","status":"completed","conclusion":"success","created_at":"2026-11-09T10:00:00Z","html_url":"https://git.example.com/pr","head_sha":"ffff"},
                  {"name":"CI","event":"push","status":"completed","conclusion":"failure","created_at":"2026-11-09T09:00:00Z","html_url":"https://git.example.com/run/1","head_sha":"0123abc"}]}
                """)
            .On($"/repos/{name}/actions/runs?per_page=1&status=failure", """{"total_count":2,"workflow_runs":[]}""")
            .On($"/repos/{name}/actions/runs?per_page=1&created", """{"total_count":11,"workflow_runs":[]}""")
            .On($"/repos/{name}/commits", """[{"sha":"a"},{"sha":"b"},{"sha":"c"}]""")
            .On($"/repos/{name}/dependabot/alerts", """[{"number":1},{"number":2}]""")
            .On($"/repos/{locked}/dependabot/alerts", """{"message":"Resource not accessible"}""", HttpStatusCode.Forbidden)
            .On("/user/repos", $$"""
                [{"id":1001,"full_name":"{{name.ToUpperInvariant()}}","html_url":"https://git.example.com/a","archived":false,"fork":false},
                 {"id":1002,"full_name":"{{unknown}}","html_url":"https://git.example.com/b","archived":false,"fork":false},
                 {"id":1003,"full_name":"acme-inc/old","html_url":"https://git.example.com/c","archived":true,"fork":false},
                 {"id":1004,"full_name":"acme-inc/forked","html_url":"https://git.example.com/d","archived":false,"fork":true}]
                """);
        await CollectAsync(new GitHubCollector(new HttpClient(provider), new PatGitHubAuth(Token)));

        var repo = await ReadAsync(db => db.AtlasRepos.SingleAsync(r => r.FullName == name));
        Assert.Equal("CI", repo.LastRunName);
        Assert.Equal("failure", repo.LastRunStatus);
        Assert.Equal("0123abc", repo.LastRunSha);
        Assert.Equal(11, repo.Runs7d);
        Assert.Equal(2, repo.FailedRuns7d);
        Assert.Equal(3, repo.Commits7d);
        Assert.Equal(2, repo.OpenAlerts);
        // Alerts the token cannot read are "unknown", not zero and not the last number seen.
        Assert.Null((await ReadAsync(db => db.AtlasRepos.SingleAsync(r => r.FullName == locked))).OpenAlerts);

        var found = await ReadAsync(db => db.AtlasDiscoveries.Where(d => d.Source == "github").Select(d => d.ExternalRef).ToListAsync());
        Assert.Contains(unknown, found);
        Assert.DoesNotContain(name, found);
        Assert.DoesNotContain("acme-inc/old", found);
        Assert.DoesNotContain("acme-inc/forked", found);
        Assert.All(provider.Requests, r => Assert.Equal($"Bearer {Token}", r.Authorization));
    }

    [Fact]
    public async Task Kuma_marks_services_up_or_down_by_their_monitor()
    {
        var (productId, production) = await SeedSystemAsync();
        var upName = Unique("Acme API");
        var downName = Unique("Acme Site");
        var newName = Unique("Globex API");
        var up = await SeedServiceAsync(productId, production.Id, "API", monitor: upName);
        var down = await SeedServiceAsync(productId, production.Id, "Site", monitor: downName.ToUpperInvariant());
        var gone = await SeedServiceAsync(productId, production.Id, "Antigo", monitor: Unique("Removido"));
        await WithDbAsync(fx, db => db.AtlasServices.Where(s => s.Id == gone.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.MonitorStatus, "up")));

        var metrics = $$"""
            # HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)
            # TYPE monitor_status gauge
            monitor_status{monitor_name="{{upName}}",monitor_type="http",monitor_url="https://api.acme.example/health",monitor_hostname="null",monitor_port="null"} 1
            monitor_status{monitor_name="{{downName}}",monitor_type="http",monitor_url="https://acme.example",monitor_hostname="null",monitor_port="null"} 0
            monitor_status{monitor_name="{{newName}}",monitor_type="keyword",monitor_url="https://api.globex.example",monitor_hostname="null",monitor_port="null"} 2
            monitor_response_time{monitor_name="{{upName}}",monitor_type="http"} 120
            """;
        var provider = new Provider().On("/metrics", metrics);
        await CollectAsync(new KumaCollector(new HttpClient(provider), "https://status.example.com/", Token));

        Assert.Equal("up", (await ReadAsync(db => db.AtlasServices.SingleAsync(s => s.Id == up.Id))).MonitorStatus);
        var isDown = await ReadAsync(db => db.AtlasServices.SingleAsync(s => s.Id == down.Id));
        Assert.Equal("down", isDown.MonitorStatus);
        Assert.Equal(AtlasStates.Down, isDown.State);
        Assert.Null((await ReadAsync(db => db.AtlasServices.SingleAsync(s => s.Id == gone.Id))).MonitorStatus);

        var found = await ReadAsync(db => db.AtlasDiscoveries.SingleAsync(d => d.Source == "kuma" && d.ExternalRef == newName));
        Assert.Equal("monitor", found.Kind);
        Assert.Equal("https://api.globex.example", found.Url);

        var request = Assert.Single(provider.Requests);
        Assert.Equal("https://status.example.com/metrics", request.Url);
        // The API key is the password of a basic login with an empty user.
        Assert.Equal("Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes(":" + Token)), request.Authorization);
    }

    [Fact]
    public async Task A_down_monitor_wins_over_a_good_deploy()
    {
        var service = new AtlasService { Name = "API", DeployStatus = "success", MonitorStatus = "down" };
        Assert.Equal(AtlasStates.Down, service.State);
        service.MonitorStatus = "up";
        service.DeployStatus = "building";
        Assert.Equal(AtlasStates.Deploying, service.State);
        service.DeployStatus = "failed";
        Assert.Equal(AtlasStates.Degraded, service.State);
        service.MonitorStatus = null;
        service.DeployStatus = null;
        Assert.Equal(AtlasStates.Unknown, service.State);
        await Task.CompletedTask;
    }

    [Fact]
    public async Task Vercel_writes_the_production_deploy_of_each_project()
    {
        var (productId, production) = await SeedSystemAsync();
        var project = Unique("acme-site");
        var unknown = Unique("globex-site");
        var site = await SeedServiceAsync(productId, production.Id, "Site", "vercel", project);
        var provider = new Provider()
            .On("/v10/projects", "{\"projects\":[{\"id\":\"prj_1\",\"name\":\"" + project + "\"},{\"id\":\"prj_2\",\"name\":\"" + unknown + "\"}],\"pagination\":{\"count\":2,\"next\":null}}")
            .On("/v7/deployments?projectId=prj_1", """{"deployments":[{"uid":"dpl_1","state":"READY","created":1794225600000,"meta":{"githubCommitSha":"9f8e7d6c"}}]}""");
        await CollectAsync(new VercelCollector(new HttpClient(provider), Token, "team_1"));

        var seen = await ReadAsync(db => db.AtlasServices.SingleAsync(s => s.Id == site.Id));
        Assert.Equal("success", seen.DeployStatus);
        Assert.Equal("9f8e7d6c", seen.CommitSha);
        Assert.Equal(DateTimeOffset.FromUnixTimeMilliseconds(1794225600000).UtcDateTime, seen.LastDeployAt);
        Assert.Contains(await ReadAsync(db => db.AtlasDiscoveries.Where(d => d.Source == "vercel").Select(d => d.ExternalRef).ToListAsync()), r => r == unknown);

        Assert.Equal(2, provider.Requests.Count); // unregistered projects are listed, not queried
        Assert.All(provider.Requests, r => Assert.Contains("teamId=team_1", r.Url));
        Assert.Contains("target=production", provider.Requests[1].Url);
    }

    [Fact]
    public async Task A_discovery_is_registered_or_dismissed_and_leaves_when_it_is_gone()
    {
        var (productId, _) = await SeedSystemAsync();
        var slug = await ReadAsync(db => db.Products.Where(p => p.Id == productId).Select(p => p.Slug).SingleAsync());
        var source = Unique("src");
        var a = Unique("proj") + "/api";
        var b = Unique("proj") + "/worker";
        async Task SyncAsync(params string[] refs)
        {
            using var scope = fx.Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
            await AtlasCollect.SyncDiscoveriesAsync(db, source, "service", refs.Select(r => new AtlasCollect.Found(r + "@production", r, "production")).ToList(), CancellationToken.None);
            await db.SaveChangesAsync();
        }
        await SyncAsync(a, b);
        var rows = await ReadAsync(db => db.AtlasDiscoveries.Where(d => d.Source == source).ToListAsync());
        Assert.Equal(2, rows.Count);

        var (session, _) = await SignInAsync(fx);
        var idA = rows.Single(r => r.Name == a).Id;
        var idB = rows.Single(r => r.Name == b).Id;
        Assert.Equal(HttpStatusCode.BadRequest, (await session.PostAsJsonAsync($"/v1/staff/atlas/discoveries/{idA}/register", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await session.PostAsJsonAsync($"/v1/staff/atlas/discoveries/{idA}/register", new { system = slug, kind = "api" })).StatusCode);
        var registered = await ReadAsync(db => db.AtlasServices.Include(s => s.Environment).SingleAsync(s => s.ProductId == productId && s.ExternalRef == a));
        Assert.Equal("api", registered.Name);
        Assert.Equal(source, registered.Provider);
        Assert.Equal("production", registered.Environment!.Slug);

        Assert.Equal(HttpStatusCode.NoContent, (await session.PostAsync($"/v1/staff/atlas/discoveries/{idB}/dismiss", null)).StatusCode);
        var overview = await (await session.GetAsync("/v1/staff/atlas")).Json();
        Assert.DoesNotContain(overview.GetProperty("discoveries").EnumerateArray(), d => d.GetProperty("source").GetString() == source);

        // Still found: the dismissal holds. No longer found: the row goes away.
        await SyncAsync(b);
        Assert.NotNull((await ReadAsync(db => db.AtlasDiscoveries.SingleAsync(d => d.Id == idB))).DismissedAt);
        await SyncAsync();
        Assert.False(await ReadAsync(db => db.AtlasDiscoveries.AnyAsync(d => d.Source == source)));
    }
}
