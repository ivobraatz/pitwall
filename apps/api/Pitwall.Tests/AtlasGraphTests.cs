using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Testcontainers.PostgreSql;

namespace Pitwall.Tests;

/// <summary>One Postgres and one app for every Atlas graph test class (see the collection below).</summary>
public sealed class AtlasGraphFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder("postgres:17-alpine").Build();
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Testing");
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Pitwall"] = _pg.GetConnectionString(),
                ["Storage:Path"] = Path.Combine(Path.GetTempPath(), "pitwall-tests", Guid.NewGuid().ToString("N")),
                // Uptime Kuma counts as connected here, so a source can be stale in the tests.
                ["Atlas:Kuma:Url"] = "https://status.acme.example",
                ["Atlas:Kuma:ApiKey"] = "chave-de-teste",
            }));
        });
        using var scope = Factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<PitwallDb>().Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await Factory.DisposeAsync();
        await _pg.DisposeAsync();
    }
}

[CollectionDefinition("atlas-graph")]
public sealed class AtlasGraphCollection : ICollectionFixture<AtlasGraphFixture>;

/// <summary>Helpers shared by the graph tests: an MCP-style token, requests and direct database writes.</summary>
internal static class GraphKit
{
    public static string Slug(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..(prefix.Length + 9)];

    /// <summary>A staff member with a token of the given scopes, called as the MCP does: a bearer and no cookie.</summary>
    public static async Task<HttpClient> TokenAsync(AtlasGraphFixture fx, params string[] scopes)
    {
        var token = Tokens.NewStaffToken();
        using (var scope = fx.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
            var staff = new StaffUser
            {
                Id = Guid.NewGuid(), Email = $"staff-{Guid.NewGuid():N}@pitwall.test", Name = "Bia", Role = StaffRoles.Agent,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("senha-de-teste", 4), CreatedAt = DateTime.UtcNow,
            };
            db.Staff.Add(staff);
            db.StaffTokens.Add(new StaffToken
            {
                Id = Guid.NewGuid(), StaffUserId = staff.Id, Name = "teste", Prefix = token[..12], Hash = Tokens.Hash(token),
                Scopes = scopes, CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }
        var client = fx.Factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    public static async Task<JsonElement> OkAsync(HttpResponseMessage res)
    {
        var body = await res.Content.ReadAsStringAsync();
        Assert.True(res.IsSuccessStatusCode, $"{(int)res.StatusCode}: {body}");
        return body.Length == 0 ? default : JsonSerializer.Deserialize<JsonElement>(body);
    }

    public static async Task<JsonElement> GetAsync(HttpClient c, string url) => await OkAsync(await c.GetAsync(url));

    public static async Task<string> SystemAsync(HttpClient c, string? slug = null, string? name = null)
    {
        slug ??= Slug("acme");
        await OkAsync(await c.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug, name = name ?? slug }));
        return slug;
    }

    /// <summary>Creates a service through the same writer the MCP uses. Returns its id and key.</summary>
    public static async Task<(Guid Id, string Key)> ServiceAsync(
        HttpClient c, string? system, string name, string? environment = "production", string kind = "api", object? extra = null)
    {
        var body = new Dictionary<string, object?> { ["system"] = system, ["environment"] = environment, ["name"] = name, ["kind"] = kind };
        if (extra is not null)
            foreach (var p in JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(extra))!)
                body[p.Key] = p.Value;
        var created = await OkAsync(await c.PostAsJsonAsync("/v1/staff/atlas/services", body));
        return (created.GetProperty("id").GetGuid(), created.GetProperty("key").GetString()!);
    }

    public static async Task LinkAsync(HttpClient c, Guid from, Guid to, string relation) =>
        await OkAsync(await c.PostAsJsonAsync("/v1/staff/atlas/links", new { from = from.ToString(), to = to.ToString(), relation }));

    public static async Task<T> DbAsync<T>(AtlasGraphFixture fx, Func<PitwallDb, Task<T>> act)
    {
        using var scope = fx.Factory.Services.CreateScope();
        return await act(scope.ServiceProvider.GetRequiredService<PitwallDb>());
    }

    public static Task DbAsync(AtlasGraphFixture fx, Func<PitwallDb, Task> act) => DbAsync(fx, async db => { await act(db); return 0; });

    /// <summary>Finds a node in a graph answer by name.</summary>
    public static JsonElement NodeNamed(JsonElement graph, string name) =>
        graph.GetProperty("nodes").EnumerateArray().Single(n => n.GetProperty("name").GetString() == name);

    public static JsonElement? FindNode(JsonElement graph, Guid id) =>
        graph.GetProperty("nodes").EnumerateArray().Where(n => n.GetProperty("id").GetGuid() == id).Select(n => (JsonElement?)n).FirstOrDefault();

    public static void HasProperties(JsonElement el, params string[] names)
    {
        foreach (var name in names)
            Assert.True(el.TryGetProperty(name, out _), $"falta o campo '{name}' em {el.GetRawText()}");
    }

    public static void AssertAttention(JsonElement node, int failure = 0, int security = 0, int task = 0, int improvement = 0, int config = 0, int unverified = 0)
    {
        var a = node.GetProperty("attention");
        Assert.Equal(failure, a.GetProperty("failure").GetInt32());
        Assert.Equal(security, a.GetProperty("security").GetInt32());
        Assert.Equal(task, a.GetProperty("task").GetInt32());
        Assert.Equal(improvement, a.GetProperty("improvement").GetInt32());
        Assert.Equal(config, a.GetProperty("config").GetInt32());
        Assert.Equal(unverified, a.GetProperty("unverified").GetInt32());
    }
}

[Collection("atlas-graph")]
public class AtlasGraphTests(AtlasGraphFixture fx)
{
    [Fact]
    public async Task Every_field_of_the_graph_answers_is_there_with_its_type()
    {
        var c = await GraphKit.TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await GraphKit.SystemAsync(c);
        var (api, _) = await GraphKit.ServiceAsync(c, sys, "API", extra: new { provider = "railway", url = "https://api.acme.example", monitor = "api-up" });
        var (db, _) = await GraphKit.ServiceAsync(c, sys, "Banco", kind: "database");
        await GraphKit.LinkAsync(c, api, db, "depends_on");

        var graph = await GraphKit.GetAsync(c, $"/v1/staff/atlas/graph?system={sys}");
        GraphKit.HasProperties(graph, "serverTime", "scope", "engines", "nodes", "edges", "sources", "coverage");
        Assert.Equal(sys, graph.GetProperty("scope").GetProperty("system").GetProperty("slug").GetString());
        Assert.Equal(9, graph.GetProperty("engines").GetArrayLength());
        Assert.Equal(JsonValueKind.Object, graph.GetProperty("coverage").ValueKind);
        Assert.Equal(7, graph.GetProperty("coverage").GetProperty("checks").GetArrayLength());

        var node = GraphKit.FindNode(graph, api)!.Value;
        GraphKit.HasProperties(node,
            "id", "key", "type", "name", "kind", "engine", "group", "productId", "environmentId", "environment", "shared", "provider",
            "url", "signature", "state", "condition", "origin", "verification", "codeScope", "verifiedAt", "verifiedBy", "checkedAt",
            "attention", "activity", "lastEvent", "retiredAt", "removalReportedAt", "missingSince", "createdAt", "updatedAt");
        Assert.Equal("service", node.GetProperty("type").GetString());
        Assert.Equal("app", node.GetProperty("engine").GetString());
        Assert.Equal("unknown", node.GetProperty("state").GetString());
        Assert.Equal("declared", node.GetProperty("verification").GetString());
        Assert.Equal(JsonValueKind.Null, node.GetProperty("codeScope").ValueKind);
        Assert.Equal(JsonValueKind.Null, node.GetProperty("lastEvent").ValueKind);
        GraphKit.HasProperties(node.GetProperty("activity"), "running", "kind", "since");
        Assert.False(node.GetProperty("activity").GetProperty("running").GetBoolean());
        GraphKit.AssertAttention(node, failure: 0, unverified: 0);

        var edge = graph.GetProperty("edges").EnumerateArray().Single(e => e.GetProperty("from").GetGuid() == api);
        GraphKit.HasProperties(edge, "id", "from", "to", "relation", "category", "label", "planned", "origin", "verifiedAt", "retiredAt");
        Assert.Equal("depends_on", edge.GetProperty("relation").GetString());
        Assert.Equal("infra", edge.GetProperty("category").GetString());
    }

    [Fact]
    public async Task Company_cards_and_node_detail_have_every_field()
    {
        var c = await GraphKit.TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await GraphKit.SystemAsync(c);
        var (api, _) = await GraphKit.ServiceAsync(c, sys, "API", extra: new { facts = new Dictionary<string, string> { ["Saude"] = "/health" }, items = new[] { "rede-interna" } });
        var (stripe, _) = await GraphKit.ServiceAsync(c, null, "Stripe " + sys, environment: null, kind: "payment");
        await GraphKit.LinkAsync(c, api, stripe, "billed_through");

        var company = await GraphKit.GetAsync(c, "/v1/staff/atlas/graph/company");
        GraphKit.HasProperties(company, "serverTime", "systems", "shared", "edges", "sources");
        var card = company.GetProperty("systems").EnumerateArray().Single(s => s.GetProperty("slug").GetString() == sys);
        GraphKit.HasProperties(card, "id", "slug", "name", "color", "description", "state", "shared", "nodeCount", "health", "attention",
            "running", "pending", "coverage");
        GraphKit.HasProperties(card.GetProperty("health"), "total", "up", "down", "degraded", "deploying", "unknown");
        GraphKit.HasProperties(card.GetProperty("running"), "deploys", "ci", "agents", "routines");
        GraphKit.HasProperties(card.GetProperty("pending"), "tasks", "tickets", "errors", "alerts");
        GraphKit.HasProperties(card.GetProperty("coverage"), "percent", "checks");
        Assert.Equal(JsonValueKind.Null, card.GetProperty("pending").GetProperty("alerts").ValueKind);
        var edge = company.GetProperty("edges").EnumerateArray().Single(e => e.GetProperty("to").GetGuid() == stripe);
        Assert.Equal(1, edge.GetProperty("count").GetInt32());
        Assert.Equal("billed_through", edge.GetProperty("relations")[0].GetString());
        Assert.Contains(company.GetProperty("shared").EnumerateArray(), n => n.GetProperty("id").GetGuid() == stripe);

        var detail = await GraphKit.GetAsync(c, $"/v1/staff/atlas/nodes/{api}");
        GraphKit.HasProperties(detail, "node", "system", "incoming", "outgoing", "impact", "evidence", "refs", "events", "changes",
            "repos", "processes", "changeSets", "providerUrl");
        var n = detail.GetProperty("node");
        GraphKit.HasProperties(n, "id", "key", "type", "name", "kind", "engine", "state", "attention", "activity",
            "notes", "facts", "items", "externalRef", "monitor", "aliases", "owner", "impact", "deployStatus", "monitorStatus",
            "lastDeployAt", "commitSha", "stack");
        Assert.Equal("Saude", n.GetProperty("facts")[0].GetProperty("key").GetString());
        Assert.Equal("rede-interna", n.GetProperty("items")[0].GetString());
        GraphKit.HasProperties(detail.GetProperty("impact"), "direct", "indirect", "systems");
        GraphKit.HasProperties(detail.GetProperty("outgoing")[0], "edge", "node");
        GraphKit.HasProperties(detail.GetProperty("outgoing")[0].GetProperty("node"), "id", "key", "name", "kind", "engine", "productId", "state");
        Assert.Equal(sys, detail.GetProperty("system").GetProperty("slug").GetString());
    }

    [Fact]
    public async Task A_repository_is_a_code_node_that_deploys_to_its_services()
    {
        var c = await GraphKit.TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await GraphKit.SystemAsync(c);
        var (api, _) = await GraphKit.ServiceAsync(c, sys, "API");
        var repoName = $"{sys}/rockets";
        await GraphKit.OkAsync(await c.PostAsJsonAsync("/v1/staff/atlas/repos", new { fullName = repoName, system = sys, role = "backend", services = new[] { api.ToString() } }));
        var repoId = (await GraphKit.DbAsync(fx, db => db.AtlasRepos.Where(r => r.FullName == repoName).Select(r => r.Id).SingleAsync()));

        var graph = await GraphKit.GetAsync(c, $"/v1/staff/atlas/graph?system={sys}");
        var repo = GraphKit.FindNode(graph, repoId)!.Value;
        Assert.Equal("repo", repo.GetProperty("type").GetString());
        Assert.Equal("code", repo.GetProperty("engine").GetString());
        Assert.Equal($"repo:{repoName}", repo.GetProperty("key").GetString());
        var deploys = graph.GetProperty("edges").EnumerateArray()
            .Single(e => e.GetProperty("from").GetGuid() == repoId && e.GetProperty("to").GetGuid() == api);
        Assert.Equal("deploys_to", deploys.GetProperty("relation").GetString());
    }

    [Fact]
    public async Task A_live_code_evidence_with_a_relation_becomes_an_edge_and_a_gone_one_does_not()
    {
        var c = await GraphKit.TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await GraphKit.SystemAsync(c);
        var (api, _) = await GraphKit.ServiceAsync(c, sys, "API");
        var (stripe, _) = await GraphKit.ServiceAsync(c, null, "Stripe " + sys, environment: null, kind: "payment");
        var (worker, _) = await GraphKit.ServiceAsync(c, sys, "Worker", kind: "worker");
        var repoName = $"{sys}/rockets";
        await GraphKit.OkAsync(await c.PostAsJsonAsync("/v1/staff/atlas/repos", new { fullName = repoName, system = sys, services = new[] { api.ToString() } }));
        var repoId = await GraphKit.DbAsync(fx, db => db.AtlasRepos.Where(r => r.FullName == repoName).Select(r => r.Id).SingleAsync());

        var now = DateTime.UtcNow;
        await GraphKit.DbAsync(fx, async db =>
        {
            db.AtlasEvidence.Add(Evidence(stripe, $"repo:{repoName}", "manifest", "package.json#dependencies.stripe", "billed_through", now));
            db.AtlasEvidence.Add(Evidence(worker, $"repo:{repoName}", "manifest", "package.json#dependencies.bullmq", "calls", now, gone: now));
            await db.SaveChangesAsync();
        });

        var graph = await GraphKit.GetAsync(c, $"/v1/staff/atlas/graph?system={sys}");
        var live = graph.GetProperty("edges").EnumerateArray()
            .Single(e => e.GetProperty("from").GetGuid() == api && e.GetProperty("to").GetGuid() == stripe);
        Assert.Equal("billed_through", live.GetProperty("relation").GetString());
        Assert.Equal("business", live.GetProperty("category").GetString());
        Assert.StartsWith("ev:", live.GetProperty("id").GetString());
        Assert.Equal("discovered", live.GetProperty("origin").GetString());
        Assert.DoesNotContain(graph.GetProperty("edges").EnumerateArray(), e => e.GetProperty("to").GetGuid() == worker && e.GetProperty("relation").GetString() == "calls");
    }

    [Fact]
    public async Task With_several_services_the_code_evidence_edge_starts_at_the_repository()
    {
        var c = await GraphKit.TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await GraphKit.SystemAsync(c);
        var (api, _) = await GraphKit.ServiceAsync(c, sys, "API");
        var (worker, _) = await GraphKit.ServiceAsync(c, sys, "Worker", kind: "worker");
        var (stripe, _) = await GraphKit.ServiceAsync(c, null, "Stripe " + sys, environment: null, kind: "payment");
        var repoName = $"{sys}/monorepo";
        await GraphKit.OkAsync(await c.PostAsJsonAsync("/v1/staff/atlas/repos", new { fullName = repoName, system = sys, services = new[] { api.ToString(), worker.ToString() } }));
        var repoId = await GraphKit.DbAsync(fx, db => db.AtlasRepos.Where(r => r.FullName == repoName).Select(r => r.Id).SingleAsync());
        await GraphKit.DbAsync(fx, async db =>
        {
            db.AtlasEvidence.Add(Evidence(stripe, $"repo:{repoName}", "manifest", "package.json#dependencies.stripe", "billed_through", DateTime.UtcNow));
            await db.SaveChangesAsync();
        });

        var graph = await GraphKit.GetAsync(c, $"/v1/staff/atlas/graph?system={sys}");
        var edge = graph.GetProperty("edges").EnumerateArray()
            .Single(e => e.GetProperty("to").GetGuid() == stripe && e.GetProperty("relation").GetString() == "billed_through");
        Assert.Equal(repoId, edge.GetProperty("from").GetGuid());
        Assert.StartsWith("ev:", edge.GetProperty("id").GetString());
    }

    [Fact]
    public async Task The_environment_filter_keeps_its_own_and_the_nodes_without_one()
    {
        var c = await GraphKit.TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await GraphKit.SystemAsync(c);
        await GraphKit.ServiceAsync(c, sys, "API prod", environment: "production");
        await GraphKit.ServiceAsync(c, sys, "API staging", environment: "staging");
        await GraphKit.ServiceAsync(c, sys, "Legado", environment: null, kind: "other");

        var graph = await GraphKit.GetAsync(c, $"/v1/staff/atlas/graph?system={sys}&environment=staging");
        var names = graph.GetProperty("nodes").EnumerateArray().Select(n => n.GetProperty("name").GetString()).ToList();
        Assert.Contains("API staging", names);
        Assert.Contains("Legado", names);
        Assert.DoesNotContain("API prod", names);
        Assert.Equal("staging", graph.GetProperty("scope").GetProperty("environment").GetString());
    }

    [Fact]
    public async Task A_service_without_a_system_used_by_two_systems_is_shared_and_the_edges_add_up()
    {
        var c = await GraphKit.TokenAsync(fx, StaffTokenScopes.Atlas);
        var acme = await GraphKit.SystemAsync(c);
        var globex = await GraphKit.SystemAsync(c);
        var initech = await GraphKit.SystemAsync(c);
        var acmeId = await GraphKit.DbAsync(fx, db => db.Products.Where(p => p.Slug == acme).Select(p => p.Id).SingleAsync());
        var globexId = await GraphKit.DbAsync(fx, db => db.Products.Where(p => p.Slug == globex).Select(p => p.Id).SingleAsync());
        var initechId = await GraphKit.DbAsync(fx, db => db.Products.Where(p => p.Slug == initech).Select(p => p.Id).SingleAsync());
        var (acmeApi, _) = await GraphKit.ServiceAsync(c, acme, "API");
        var (acmeWorker, _) = await GraphKit.ServiceAsync(c, acme, "Worker", kind: "worker");
        var (globexWorker, _) = await GraphKit.ServiceAsync(c, globex, "Worker", kind: "worker");
        var (db, _) = await GraphKit.ServiceAsync(c, initech, "Banco", kind: "database");
        var (globexApi, _) = await GraphKit.ServiceAsync(c, globex, "API");
        var (stripe, _) = await GraphKit.ServiceAsync(c, null, "Stripe " + acme, environment: null, kind: "payment");

        await GraphKit.LinkAsync(c, acmeApi, stripe, "billed_through");
        await GraphKit.LinkAsync(c, acmeWorker, stripe, "calls");
        await GraphKit.LinkAsync(c, globexWorker, stripe, "billed_through");
        // Two other systems depend on Initech's database: it is shared.
        await GraphKit.LinkAsync(c, acmeApi, db, "depends_on");
        await GraphKit.LinkAsync(c, globexApi, db, "depends_on");

        var company = await GraphKit.GetAsync(c, "/v1/staff/atlas/graph/company");
        Assert.Contains(company.GetProperty("shared").EnumerateArray(), n => n.GetProperty("id").GetGuid() == stripe);

        var edges = company.GetProperty("edges").EnumerateArray().ToList();
        var acmeToStripe = edges.Single(e => e.GetProperty("from").GetGuid() == acmeId && e.GetProperty("to").GetGuid() == stripe);
        Assert.Equal(2, acmeToStripe.GetProperty("count").GetInt32());
        var relations = acmeToStripe.GetProperty("relations").EnumerateArray().Select(r => r.GetString()).ToList();
        Assert.Contains("billed_through", relations);
        Assert.Contains("calls", relations);
        var globexToStripe = edges.Single(e => e.GetProperty("from").GetGuid() == globexId && e.GetProperty("to").GetGuid() == stripe);
        Assert.Equal(1, globexToStripe.GetProperty("count").GetInt32());

        var cards = company.GetProperty("systems").EnumerateArray().ToList();
        Assert.True(cards.Single(s => s.GetProperty("id").GetGuid() == initechId).GetProperty("shared").GetBoolean());
        Assert.False(cards.Single(s => s.GetProperty("id").GetGuid() == acmeId).GetProperty("shared").GetBoolean());
    }

    [Fact]
    public async Task Retired_nodes_leave_the_map_and_show_with_include_retired()
    {
        var c = await GraphKit.TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await GraphKit.SystemAsync(c);
        var (old, _) = await GraphKit.ServiceAsync(c, sys, "Antigo");
        await GraphKit.OkAsync(await c.DeleteAsync($"/v1/staff/atlas/services/{old}"));

        var plain = await GraphKit.GetAsync(c, $"/v1/staff/atlas/graph?system={sys}");
        Assert.Null(GraphKit.FindNode(plain, old));

        var withRetired = await GraphKit.GetAsync(c, $"/v1/staff/atlas/graph?system={sys}&includeRetired=true");
        var node = GraphKit.FindNode(withRetired, old)!.Value;
        Assert.Equal(JsonValueKind.String, node.GetProperty("retiredAt").ValueKind);
    }

    [Fact]
    public async Task Requests_without_a_login_are_refused_and_a_tasks_only_token_is_forbidden()
    {
        using var anonymous = fx.Factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/v1/staff/atlas/graph")).StatusCode);

        var tasksOnly = await GraphKit.TokenAsync(fx, StaffTokenScopes.Tasks);
        Assert.Equal(HttpStatusCode.Forbidden, (await tasksOnly.GetAsync("/v1/staff/atlas/graph")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tasksOnly.GetAsync("/v1/staff/atlas/graph/company")).StatusCode);
    }

    [Fact]
    public async Task A_stale_source_is_marked_and_its_services_stay_on_the_map()
    {
        var c = await GraphKit.TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await GraphKit.SystemAsync(c);
        var (api, _) = await GraphKit.ServiceAsync(c, sys, "API", extra: new { provider = "railway" });
        await GraphKit.DbAsync(fx, async db =>
        {
            var row = await db.AtlasSources.FirstOrDefaultAsync(s => s.Name == "kuma");
            if (row is null) db.AtlasSources.Add(row = new AtlasSource { Name = "kuma", UpdatedAt = DateTime.UtcNow });
            row.LastRunAt = DateTime.UtcNow.AddHours(-1);
            row.LastOkAt = DateTime.UtcNow.AddHours(-5);
            row.LastError = "tempo esgotado";
            row.ItemsSeen = 3;
            await db.SaveChangesAsync();
        });

        var sources = await GraphKit.GetAsync(c, "/v1/staff/atlas/sources");
        var kuma = sources.EnumerateArray().Single(s => s.GetProperty("name").GetString() == "kuma");
        GraphKit.HasProperties(kuma, "name", "connected", "lastRunAt", "lastOkAt", "lastError", "itemsSeen", "stale");
        Assert.True(kuma.GetProperty("connected").GetBoolean());
        Assert.True(kuma.GetProperty("stale").GetBoolean());
        Assert.Equal("tempo esgotado", kuma.GetProperty("lastError").GetString());

        var graph = await GraphKit.GetAsync(c, $"/v1/staff/atlas/graph?system={sys}");
        Assert.NotNull(GraphKit.FindNode(graph, api));
        Assert.Contains(graph.GetProperty("sources").EnumerateArray(), s => s.GetProperty("name").GetString() == "kuma" && s.GetProperty("stale").GetBoolean());
    }

    internal static AtlasEvidence Evidence(Guid serviceId, string source, string method, string reference, string? relation, DateTime now, DateTime? gone = null) => new()
    {
        Id = Guid.NewGuid(), SubjectType = "service", SubjectId = serviceId, Source = source, Method = method, Ref = reference,
        Relation = relation, Scope = AtlasScopes.Pushed, FirstSeenAt = now, LastSeenAt = now, GoneAt = gone,
    };
}
