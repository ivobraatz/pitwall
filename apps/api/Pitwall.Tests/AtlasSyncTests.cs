using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Atlas;
using Pitwall.Services.Atlas.Sync;
using Testcontainers.PostgreSql;

namespace Pitwall.Tests;

/// <summary>A fresh Postgres per test class, the real app on top, and the GitHub API and its token faked.</summary>
public sealed class AtlasSyncFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder("postgres:17-alpine").Build();
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public FakeGitHub GitHub { get; } = new();
    public ToggleGitHubAuth Auth { get; } = new();

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
            }));
            b.ConfigureServices(s =>
            {
                s.AddSingleton<IAtlasGitHubAuth>(Auth);
                s.AddHttpClient("atlas").ConfigurePrimaryHttpMessageHandler(() => GitHub);
            });
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

/// <summary>Answers the GitHub API by the first route whose text is in the URL; records every call and its authorization header.</summary>
public sealed class FakeGitHub : HttpMessageHandler
{
    private readonly List<(string Match, HttpStatusCode Status, string Body)> _routes = [];
    public List<(string Url, string? Authorization)> Calls { get; } = [];

    public void On(string match, string body, HttpStatusCode status = HttpStatusCode.OK) => _routes.Add((match, status, body));

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var url = request.RequestUri!.ToString();
        Calls.Add((url, request.Headers.Authorization?.ToString()));
        foreach (var (match, status, body) in _routes)
        {
            if (url.Contains(match, StringComparison.Ordinal))
                return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound) { Content = new StringContent("{}", Encoding.UTF8, "application/json") });
    }
}

/// <summary>The server's GitHub token: present or absent, as a test needs. The value is never echoed by the API.</summary>
public sealed class ToggleGitHubAuth : IAtlasGitHubAuth
{
    public const string TokenValue = "token-de-teste-somente-leitura";
    public bool Configured { get; set; }
    public Task<string?> TokenAsync(CancellationToken ct) => Task.FromResult(Configured ? TokenValue : null);
}

/// <summary>The sync endpoints over HTTP: what it creates, how it replays, how it races, what it refuses, and what it never stores.</summary>
public class AtlasSyncTests(AtlasSyncFixture fx) : IClassFixture<AtlasSyncFixture>
{
    private const string Pipeline = "gh-workflow:deploy.yml";

    private const string DeployWorkflow = """
        name: Deploy
        on:
          push:
            branches: [main]
          schedule:
            - cron: '0 3 * * *'
        jobs:
          deploy:
            steps:
              - run: railway up --service api
        """;

    // ---- Helpers -----------------------------------------------------------------------------

    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..(prefix.Length + 9)];

    private static string RepoName() => $"acme-inc/{Unique("rockets")}";

    private async Task<string> TokenAsync(params string[] scopes)
    {
        var token = Tokens.NewStaffToken();
        using var scope = fx.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        var staff = new StaffUser
        {
            Id = Guid.NewGuid(), Email = $"staff-{Guid.NewGuid():N}@pitwall.test", Name = "Ana", Role = StaffRoles.Agent,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("senha-de-teste", 4), CreatedAt = DateTime.UtcNow,
        };
        db.Staff.Add(staff);
        db.StaffTokens.Add(new StaffToken
        {
            Id = Guid.NewGuid(), StaffUserId = staff.Id, Name = "teste", Prefix = token[..12], Hash = Tokens.Hash(token),
            Scopes = scopes, CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        return token;
    }

    private async Task<HttpClient> AtlasClientAsync()
    {
        var client = fx.Factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", await TokenAsync(StaffTokenScopes.Atlas));
        return client;
    }

    private async Task<Product> SeedSystemAsync(string slug)
    {
        using var scope = fx.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        var product = new Product { Id = Guid.NewGuid(), Slug = slug, Name = slug, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
        db.Products.Add(product);
        await db.SaveChangesAsync();
        return product;
    }

    private async Task<AtlasRepo> SeedRepoAsync(string fullName, Guid? productId, string? branch = "main")
    {
        using var scope = fx.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        var repo = new AtlasRepo { Id = Guid.NewGuid(), FullName = fullName, ProductId = productId, DefaultBranch = branch, CreatedAt = DateTime.UtcNow };
        db.AtlasRepos.Add(repo);
        await db.SaveChangesAsync();
        return repo;
    }

    private async Task<T> ReadAsync<T>(Func<PitwallDb, Task<T>> read)
    {
        using var scope = fx.Factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<PitwallDb>());
    }

    private static object Files(params (string Path, string? Content)[] files) =>
        files.Select(f => new { path = f.Path, content = f.Content }).ToArray();

    private static object Body(
        string repo, string scope, object? files, object? report = null, string? key = null, string? system = null,
        string? environment = null, Guid? activity = null, string? branch = null, string? commit = "c0ffee", string? tool = null, bool? partial = null) =>
        new { idempotencyKey = key, source = "agent", tool, repo, system, branch, commitSha = commit, scope, environment, activityId = activity?.ToString(), files, report, partial };

    private static async Task<(HttpStatusCode Status, string Raw, JsonElement Json)> PostSyncAsync(HttpClient client, object body)
    {
        var res = await client.PostAsJsonAsync("/v1/staff/atlas/sync", body);
        var raw = await res.Content.ReadAsStringAsync();
        var json = raw.StartsWith('{') ? JsonSerializer.Deserialize<JsonElement>(raw) : default;
        return (res.StatusCode, raw, json);
    }

    private static async Task<JsonElement> SyncOkAsync(HttpClient client, object body)
    {
        var (status, raw, json) = await PostSyncAsync(client, body);
        Assert.True(status == HttpStatusCode.OK, $"{(int)status}: {raw}");
        return json;
    }

    private static List<string> Strings(JsonElement json, string property) =>
        json.GetProperty(property).EnumerateArray().Select(x => x.GetString()!).ToList();

    private static string PackageJson(params string[] deps)
    {
        var dependencies = deps.ToDictionary(d => d, _ => (object)"^1.0.0");
        dependencies["next"] = "16.4.5";
        return JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["name"] = "rockets",
            ["packageManager"] = "pnpm@9.15.0",
            ["dependencies"] = dependencies,
            ["devDependencies"] = new Dictionary<string, string> { ["typescript"] = "^5.6.0" },
        });
    }

    private static string Base64(string text) => Convert.ToBase64String(Encoding.UTF8.GetBytes(text));

    /// <summary>The package of a repository that uses Stripe and Resend, the usual first sync.</summary>
    private static object UsualPackage(bool withStripe = true)
    {
        var deps = withStripe ? new[] { "stripe", "resend" } : new[] { "resend" };
        return Files(("package.json", PackageJson(deps)), ("pnpm-lock.yaml", null));
    }

    private static object Pipelines() => Files((".github/workflows/deploy.yml", DeployWorkflow));

    private static string NodeKey(string system, string name) => $"{system}:any:{AtlasWriter.NameSlug(name)}";

    // ---- What a sync creates ---------------------------------------------------------------------

    [Fact]
    public async Task First_sync_creates_nodes_evidence_and_the_links_between_them()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();

        var json = await SyncOkAsync(client, Body(repo, "pushed", Files(
            ("package.json", PackageJson("stripe", "resend")), ("pnpm-lock.yaml", null), (".github/workflows/deploy.yml", DeployWorkflow))));

        Assert.Equal("applied", json.GetProperty("status").GetString());
        Assert.False(json.GetProperty("replayed").GetBoolean());
        Assert.Contains(NodeKey(system.Slug, "CI: Deploy"), Strings(json, "created"));

        await ReadAsync(async db =>
        {
            var stripe = await db.AtlasServices.SingleAsync(s => s.Signature == "stripe" && s.ProductId == null);
            Assert.Equal("shared:any:stripe", stripe.Key);
            Assert.Equal(AtlasEngines.Business, stripe.Engine);

            var evidence = await db.AtlasEvidence.SingleAsync(e => e.SubjectId == stripe.Id && e.Source == $"repo:{repo}");
            Assert.Equal("package.json#dependencies.stripe", evidence.Ref);
            Assert.Equal("billed_through", evidence.Relation);
            Assert.Equal(AtlasScopes.Pushed, evidence.Scope);
            Assert.Null(evidence.GoneAt);

            var pipeline = await db.AtlasServices.SingleAsync(s => s.ProductId == system.Id && s.Name == "CI: Deploy");
            Assert.Equal(Pipeline, pipeline.Signature);
            Assert.Equal("push, schedule", pipeline.Facts.Single(f => f.Key == "Gatilhos").Value);

            var railway = await db.AtlasServices.SingleAsync(s => s.Signature == "railway" && s.ProductId == null);
            var deploy = await db.AtlasLinks.SingleAsync(l => l.FromServiceId == pipeline.Id && l.ToServiceId == railway.Id);
            Assert.Equal("deploys_to", deploy.Relation);
            Assert.Equal(AtlasOrigins.Discovered, deploy.Origin);

            var cron = await db.AtlasServices.SingleAsync(s => s.ProductId == system.Id && s.Kind == "cron");
            var schedule = await db.AtlasLinks.SingleAsync(l => l.FromServiceId == cron.Id && l.ToServiceId == pipeline.Id);
            Assert.Equal("schedules", schedule.Relation);

            var pipelineEvidence = await db.AtlasEvidence.SingleAsync(e => e.SubjectId == pipeline.Id && e.Source == $"repo:{repo}");
            Assert.Equal("triggers", pipelineEvidence.Relation);

            var repoRow = await db.AtlasRepos.SingleAsync(r => r.FullName == repo);
            Assert.NotNull(repoRow.LastSyncAt);
            Assert.Equal(AtlasScopes.Pushed, repoRow.LastSyncScope);
            Assert.Contains(repoRow.Stack, f => f.Key == "framework" && f.Value == "Next.js 16.4.5");
            return 0;
        });
    }

    [Fact]
    public async Task The_same_request_twice_is_a_replay_and_duplicates_nothing()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();
        var key = Unique("key");
        var body = Body(repo, "pushed", UsualPackage(), key: key);

        var first = await SyncOkAsync(client, body);
        var nodesBefore = await ReadAsync(db => db.AtlasServices.CountAsync(s => s.ProductId == system.Id));
        var evidenceBefore = await ReadAsync(db => db.AtlasEvidence.CountAsync(e => e.Source == $"repo:{repo}"));

        var second = await SyncOkAsync(client, body);

        Assert.True(second.GetProperty("replayed").GetBoolean());
        Assert.Equal(first.GetProperty("changeSetId").GetString(), second.GetProperty("changeSetId").GetString());
        Assert.Equal(nodesBefore, await ReadAsync(db => db.AtlasServices.CountAsync(s => s.ProductId == system.Id)));
        Assert.Equal(evidenceBefore, await ReadAsync(db => db.AtlasEvidence.CountAsync(e => e.Source == $"repo:{repo}")));
        Assert.Equal(1, await ReadAsync(db => db.AtlasChangeSets.CountAsync(c => c.IdempotencyKey == key)));
    }

    [Fact]
    public async Task The_same_package_under_another_key_is_a_noop()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();

        await SyncOkAsync(client, Body(repo, "pushed", UsualPackage(), key: Unique("first")));
        var again = await SyncOkAsync(client, Body(repo, "pushed", UsualPackage(), key: Unique("second")));

        Assert.Equal("noop", again.GetProperty("status").GetString());
        Assert.False(again.GetProperty("replayed").GetBoolean());
        Assert.Empty(Strings(again, "created"));
        Assert.Empty(Strings(again, "updated"));
        Assert.Empty(Strings(again, "gone"));
    }

    [Fact]
    public async Task Concurrent_requests_for_one_repository_create_no_duplicate_nodes()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var first = await AtlasClientAsync();
        var second = await AtlasClientAsync();

        var results = await Task.WhenAll(
            PostSyncAsync(first, Body(repo, "pushed", UsualPackage(), key: Unique("race-a"))),
            PostSyncAsync(second, Body(repo, "pushed", UsualPackage(), key: Unique("race-b"))),
            PostSyncAsync(first, Body(repo, "pushed", Pipelines(), key: Unique("race-c"))));

        Assert.All(results, r => Assert.Equal(HttpStatusCode.OK, r.Status));
        await ReadAsync(async db =>
        {
            Assert.Equal(1, await db.AtlasServices.CountAsync(s => s.ProductId == system.Id && s.Name == "CI: Deploy"));
            Assert.Equal(1, await db.AtlasServices.CountAsync(s => s.Signature == "stripe" && s.ProductId == null));
            Assert.Equal(1, await db.AtlasServices.CountAsync(s => s.Signature == "resend" && s.ProductId == null));
            return 0;
        });
    }

    [Fact]
    public async Task Two_repositories_of_one_system_share_one_stripe_until_one_stops_using_it()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repoA = RepoName();
        var repoB = RepoName();
        await SeedRepoAsync(repoA, system.Id);
        await SeedRepoAsync(repoB, system.Id);
        var client = await AtlasClientAsync();

        await SyncOkAsync(client, Body(repoA, "pushed", UsualPackage(), key: Unique("a")));
        await SyncOkAsync(client, Body(repoB, "pushed", UsualPackage(), key: Unique("b")));

        var stripeKey = await ReadAsync(async db =>
        {
            var stripe = await db.AtlasServices.SingleAsync(s => s.Signature == "stripe" && s.ProductId == null);
            var sources = await db.AtlasEvidence.Where(e => e.SubjectId == stripe.Id && e.GoneAt == null).Select(e => e.Source).ToListAsync();
            Assert.Contains($"repo:{repoA}", sources);
            Assert.Contains($"repo:{repoB}", sources);
            return stripe.Key;
        });

        // Repository B stops using Stripe: a complete pushed scan says so, for B only.
        var json = await SyncOkAsync(client, Body(repoB, "pushed", UsualPackage(withStripe: false), key: Unique("b-without")));
        Assert.Contains(stripeKey, Strings(json, "gone"));

        await ReadAsync(async db =>
        {
            var stripe = await db.AtlasServices.SingleAsync(s => s.Key == stripeKey);
            Assert.Null(stripe.RetiredAt);
            var goneFor = await db.AtlasEvidence.SingleAsync(e => e.SubjectId == stripe.Id && e.Source == $"repo:{repoB}");
            Assert.NotNull(goneFor.GoneAt);
            var stillFor = await db.AtlasEvidence.SingleAsync(e => e.SubjectId == stripe.Id && e.Source == $"repo:{repoA}");
            Assert.Null(stillFor.GoneAt);
            return 0;
        });
    }

    [Fact]
    public async Task A_resource_two_systems_use_is_one_node()
    {
        var acme = await SeedSystemAsync(Unique("acme"));
        var globex = await SeedSystemAsync(Unique("globex"));
        var repoAcme = RepoName();
        var repoGlobex = RepoName();
        await SeedRepoAsync(repoAcme, acme.Id);
        await SeedRepoAsync(repoGlobex, globex.Id);
        var client = await AtlasClientAsync();

        await SyncOkAsync(client, Body(repoAcme, "pushed", UsualPackage(), key: Unique("acme")));
        await SyncOkAsync(client, Body(repoGlobex, "pushed", UsualPackage(), key: Unique("globex")));

        await ReadAsync(async db =>
        {
            var resend = await db.AtlasServices.Where(s => s.Signature == "resend" && s.ProductId == null).ToListAsync();
            Assert.Single(resend);
            var sources = await db.AtlasEvidence.Where(e => e.SubjectId == resend[0].Id && e.GoneAt == null).Select(e => e.Source).ToListAsync();
            Assert.Contains($"repo:{repoAcme}", sources);
            Assert.Contains($"repo:{repoGlobex}", sources);
            return 0;
        });
    }

    // ---- Scopes ----------------------------------------------------------------------------------

    [Fact]
    public async Task Scope_only_goes_up_local_never_marks_missing_and_deployed_needs_an_environment()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();

        await SyncOkAsync(client, Body(repo, "local", UsualPackage(), key: Unique("local-1")));
        Assert.Equal(AtlasScopes.Local, await StripeEvidenceScopeAsync(repo));

        await SyncOkAsync(client, Body(repo, "pushed", UsualPackage(), key: Unique("pushed-1")));
        Assert.Equal(AtlasScopes.Pushed, await StripeEvidenceScopeAsync(repo));

        // A local scan that no longer sees Stripe is not proof that Stripe is gone.
        var local = await SyncOkAsync(client, Body(repo, "local", UsualPackage(withStripe: false), key: Unique("local-2")));
        Assert.Empty(Strings(local, "gone"));
        Assert.Equal(AtlasScopes.Pushed, await StripeEvidenceScopeAsync(repo));
        Assert.Null(await StripeGoneAtAsync(repo));

        // A deployed scan without an environment is refused.
        var (status, raw, _) = await PostSyncAsync(client, Body(repo, "deployed", UsualPackage(), key: Unique("deployed-none")));
        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Contains("ambiente", raw);

        var deployed = await SyncOkAsync(client, Body(repo, "deployed", UsualPackage(), key: Unique("deployed-1"), environment: "production", commit: "d3ployed"));
        Assert.Equal(AtlasScopes.Deployed, await StripeEvidenceScopeAsync(repo));
        Assert.Null(await StripeGoneAtAsync(repo));
        Assert.Equal("applied", deployed.GetProperty("status").GetString());
        await ReadAsync(async db =>
        {
            var row = await db.AtlasRepos.SingleAsync(r => r.FullName == repo);
            Assert.Equal("d3ployed", row.LastDeployedSha);
            return 0;
        });

        // And a later pushed scan does not bring the scope down.
        await SyncOkAsync(client, Body(repo, "pushed", UsualPackage(), key: Unique("pushed-2")));
        Assert.Equal(AtlasScopes.Deployed, await StripeEvidenceScopeAsync(repo));
    }

    private async Task<string> StripeEvidenceScopeAsync(string repo) => await ReadAsync(async db =>
    {
        var stripe = await db.AtlasServices.SingleAsync(s => s.Signature == "stripe" && s.ProductId == null);
        return (await db.AtlasEvidence.SingleAsync(e => e.SubjectId == stripe.Id && e.Source == $"repo:{repo}")).Scope;
    });

    private async Task<DateTime?> StripeGoneAtAsync(string repo) => await ReadAsync(async db =>
    {
        var stripe = await db.AtlasServices.SingleAsync(s => s.Signature == "stripe" && s.ProductId == null);
        return (await db.AtlasEvidence.SingleAsync(e => e.SubjectId == stripe.Id && e.Source == $"repo:{repo}")).GoneAt;
    });

    [Fact]
    public async Task A_scan_keeps_the_facts_the_collector_owns_and_replaces_the_rest()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        var row = await SeedRepoAsync(repo, system.Id);
        await ReadAsync(async db =>
        {
            var tracked = await db.AtlasRepos.SingleAsync(r => r.Id == row.Id);
            tracked.Stack = [new AtlasFact { Key = "language:TypeScript", Value = "62%" }, new AtlasFact { Key = "github:archived", Value = "não" }, new AtlasFact { Key = "framework", Value = "Velho 1.0" }];
            await db.SaveChangesAsync();
            return 0;
        });
        var client = await AtlasClientAsync();

        await SyncOkAsync(client, Body(repo, "pushed", UsualPackage(), key: Unique("stack")));

        await ReadAsync(async db =>
        {
            var stack = (await db.AtlasRepos.SingleAsync(r => r.Id == row.Id)).Stack.Select(f => (f.Key, f.Value)).ToList();
            Assert.Contains(("language:TypeScript", "62%"), stack);
            Assert.Contains(("github:archived", "não"), stack);
            Assert.DoesNotContain(("framework", "Velho 1.0"), stack);
            Assert.Contains(("framework", "Next.js 16.4.5"), stack);
            return 0;
        });
    }

    // ---- Reports, sessions and empty packages -----------------------------------------------------

    [Fact]
    public async Task Removal_reported_is_marked_and_nothing_is_retired()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();

        await SyncOkAsync(client, Body(repo, "local", Files(), report: new
        {
            ops = new object[] { new { op = "node", name = "Legacy API", kind = "api" } },
        }, key: Unique("create")));
        var key = NodeKey(system.Slug, "Legacy API");

        var json = await SyncOkAsync(client, Body(repo, "local", Files(), key: Unique("removal"), report: new
        {
            ops = new object[] { new { op = "removed", @ref = key, evidence = "relatório semanal" } },
        }));

        Assert.Contains(key, Strings(json, "removalsReported"));
        await ReadAsync(async db =>
        {
            var node = await db.AtlasServices.SingleAsync(s => s.Key == key);
            Assert.NotNull(node.RemovalReportedAt);
            Assert.Null(node.RetiredAt);
            return 0;
        });
    }

    [Fact]
    public async Task Interrupted_session_gets_repo_branch_and_sha()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();
        var activityId = Guid.NewGuid();
        await ReadAsync(async db =>
        {
            db.AtlasActivities.Add(new AtlasActivity
            {
                Id = activityId, ProductId = system.Id, Description = "Ajustar a cobrança", ActorName = "Ana", StartedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
            return 0;
        });

        await SyncOkAsync(client, Body(repo, "local", UsualPackage(), key: Unique("session"), activity: activityId,
            branch: "feat/cobranca", commit: "5e5510n", tool: "claude-code"));

        await ReadAsync(async db =>
        {
            var activity = await db.AtlasActivities.SingleAsync(a => a.Id == activityId);
            Assert.Equal(repo, activity.Repo);
            Assert.Equal("feat/cobranca", activity.Branch);
            Assert.Equal("5e5510n", activity.HeadSha);
            Assert.Equal("claude-code", activity.Tool);
            Assert.NotNull(activity.LastSyncAt);
            Assert.Null(activity.FinishedAt);
            return 0;
        });
    }

    [Fact]
    public async Task Empty_files_with_pushed_scope_marks_nothing_gone()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();
        await SyncOkAsync(client, Body(repo, "pushed", UsualPackage(), key: Unique("full")));

        var json = await SyncOkAsync(client, Body(repo, "pushed", Files(), key: Unique("empty")));

        Assert.Equal("noop", json.GetProperty("status").GetString());
        Assert.Empty(Strings(json, "gone"));
        Assert.Null(await StripeGoneAtAsync(repo));
    }

    // ---- Secrets -------------------------------------------------------------------------------

    [Fact]
    public async Task Secrets_in_the_report_and_in_secret_files_never_reach_the_map()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();

        const string summary = "Ajuste: sk_live_ABCDEFGHIJKLMNOPQRST, ghp_abcdefghijklmnopqrstuvwxyz0123456789, password=hunter2hunter2 e\n"
            + "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKabcdef\n-----END RSA PRIVATE KEY-----";
        const string envFile = "STRIPE_SECRET_KEY=sk_live_SEGREDOXYZ123456789\n";
        var (status, raw, json) = await PostSyncAsync(client, Body(repo, "pushed", Files(
            ("package.json", PackageJson("stripe")), (".env", envFile)),
            key: Unique("leak"),
            report: new
            {
                summary,
                ops = new object[]
                {
                    new { op = "node", name = "Cobrança", kind = "payment", facts = new Dictionary<string, string> { ["Chave"] = "ghp_abcdefghijklmnopqrstuvwxyz0123456789" } },
                },
            }));

        Assert.Equal(HttpStatusCode.OK, status);
        const string secret1 = "sk_live_ABCDEF";
        const string secret2 = "ghp_abcdef";
        const string secret3 = "hunter2hunter2";
        const string secret4 = "MIIBOgIBAAJBAKabcdef";
        const string secret5 = "SEGREDOXYZ";
        foreach (var secret in new[] { secret1, secret2, secret3, secret4, secret5 })
            Assert.DoesNotContain(secret, raw);

        Assert.Equal("partial", json.GetProperty("status").GetString());
        Assert.Contains(json.GetProperty("rejected").EnumerateArray(), r => r.GetProperty("op").GetString()!.StartsWith("file:.env", StringComparison.Ordinal));

        await ReadAsync(async db =>
        {
            var changeSet = await db.AtlasChangeSets.SingleAsync(c => c.Repo == repo);
            Assert.Contains("[removido]", changeSet.Summary);
            foreach (var secret in new[] { secret1, secret2, secret3, secret4, secret5 })
            {
                Assert.DoesNotContain(secret, changeSet.Summary);
                Assert.DoesNotContain(secret, changeSet.Result);
            }

            var evidence = await db.AtlasEvidence.Where(e => e.Source.StartsWith("repo:") || e.Source == "agent").ToListAsync();
            Assert.All(evidence, e =>
            {
                foreach (var secret in new[] { secret1, secret2, secret3, secret5 })
                {
                    Assert.DoesNotContain(secret, e.Ref);
                    Assert.DoesNotContain(secret, e.Detail ?? "");
                }
            });

            var services = await db.AtlasServices.Where(s => s.ProductId == system.Id || s.Signature == "stripe").ToListAsync();
            Assert.DoesNotContain(services, s => s.Key.Contains("env:") || s.Name.Contains("STRIPE_SECRET_KEY"));
            var billing = services.Single(s => s.Name == "Cobrança");
            Assert.Equal("[removido]", billing.Facts.Single().Value);

            var history = await db.AtlasChanges.Where(c => c.ChangeSetId == changeSet.Id).ToListAsync();
            Assert.All(history, h => Assert.DoesNotContain(secret2, JsonSerializer.Serialize(h.Fields)));
            return 0;
        });
    }

    // ---- Access and refusals -------------------------------------------------------------------

    [Fact]
    public async Task Access_needs_a_session_or_a_token_with_the_atlas_scope()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);

        var anonymous = fx.Factory.CreateClient();
        var (anonymousStatus, _, _) = await PostSyncAsync(anonymous, Body(repo, "pushed", UsualPackage()));
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousStatus);

        var tasksOnly = fx.Factory.CreateClient();
        tasksOnly.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", await TokenAsync(StaffTokenScopes.Tasks));
        var (tasksStatus, _, _) = await PostSyncAsync(tasksOnly, Body(repo, "pushed", UsualPackage()));
        Assert.Equal(HttpStatusCode.Forbidden, tasksStatus);

        var stateAnonymous = await fx.Factory.CreateClient().GetAsync($"/v1/staff/atlas/sync/state?repo={repo}");
        Assert.Equal(HttpStatusCode.Unauthorized, stateAnonymous.StatusCode);
    }

    [Fact]
    public async Task Repository_without_a_system_is_422_and_another_system_is_409()
    {
        var acme = await SeedSystemAsync(Unique("acme"));
        var globex = await SeedSystemAsync(Unique("globex"));
        var unassigned = RepoName();
        await SeedRepoAsync(unassigned, null);
        var assigned = RepoName();
        await SeedRepoAsync(assigned, acme.Id);
        var client = await AtlasClientAsync();

        var (noSystem, rawNoSystem, _) = await PostSyncAsync(client, Body(unassigned, "pushed", UsualPackage()));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, noSystem);
        Assert.Contains("Repositório não associado a um sistema", rawNoSystem);

        var (wrongSystem, rawWrong, _) = await PostSyncAsync(client, Body(assigned, "pushed", UsualPackage(), system: globex.Slug));
        Assert.Equal(HttpStatusCode.Conflict, wrongSystem);
        Assert.Contains("outro sistema", rawWrong);

        // Sending the system the repository already has is fine; the first time a repository is seen, the system names it.
        await SyncOkAsync(client, Body(assigned, "pushed", UsualPackage(), system: acme.Slug, key: Unique("same-system")));
        var (fresh, _, _) = await PostSyncAsync(client, Body(RepoName(), "pushed", UsualPackage(), system: Unique("inexistente"), key: Unique("unknown")));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, fresh);
    }

    [Fact]
    public async Task Sync_state_reflects_the_last_sync()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();

        var before = await SyncOkAsync(client, Body(repo, "pushed", UsualPackage(), key: Unique("state")));
        var state = await (await client.GetAsync($"/v1/staff/atlas/sync/state?repo={repo}")).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(repo, state.GetProperty("repo").GetString());
        Assert.True(state.GetProperty("registered").GetBoolean());
        Assert.Equal(system.Slug, state.GetProperty("system").GetProperty("slug").GetString());
        Assert.Equal("pushed", state.GetProperty("lastSyncScope").GetString());
        Assert.NotEqual(JsonValueKind.Null, state.GetProperty("lastSyncAt").ValueKind);
        Assert.Equal("c0ffee", state.GetProperty("lastSyncSha").GetString());
        Assert.NotNull(before.GetProperty("changeSetId").GetString());

        var unknown = await (await client.GetAsync($"/v1/staff/atlas/sync/state?repo={RepoName()}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(unknown.GetProperty("registered").GetBoolean());
    }

    [Fact]
    public async Task History_rows_of_a_sync_say_sync_and_name_its_change_set()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();

        var json = await SyncOkAsync(client, Body(repo, "pushed", Pipelines(), key: Unique("history")));
        var changeSetId = Guid.Parse(json.GetProperty("changeSetId").GetString()!);

        await ReadAsync(async db =>
        {
            var rows = await db.AtlasChanges.Where(c => c.ChangeSetId == changeSetId).ToListAsync();
            Assert.NotEmpty(rows);
            Assert.All(rows, r =>
            {
                Assert.Equal("sync", r.Source);
                Assert.Equal("Ana (Claude)", r.Actor);
            });
            Assert.Contains(rows, r => r.Op == "created" && r.EntityType == "service");
            return 0;
        });
    }

    // ---- Scan by the server ----------------------------------------------------------------------

    [Fact]
    public async Task Server_scan_without_a_github_token_is_409()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = await SeedRepoAsync(RepoName(), system.Id);
        var client = await AtlasClientAsync();

        var res = await client.PostAsync($"/v1/staff/atlas/repos/{repo.Id}/scan", null);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Equal("Conecte o GitHub para escanear pelo servidor (veja Integração).", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Server_scan_reads_the_tree_and_the_blobs_and_never_fetches_secret_files()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repoName = RepoName();
        var repo = await SeedRepoAsync(repoName, system.Id, branch: "main");
        var client = await AtlasClientAsync();

        var tree = JsonSerializer.Serialize(new
        {
            sha = "tree-abc",
            truncated = false,
            tree = new object[]
            {
                new { path = "package.json", type = "blob", sha = "blob-pkg", size = 120 },
                new { path = ".env", type = "blob", sha = "blob-env", size = 40 },
                new { path = "pnpm-lock.yaml", type = "blob", sha = "blob-lock", size = 10 },
                new { path = "src", type = "tree", sha = "tree-src" },
            },
        });
        var blob = JsonSerializer.Serialize(new { content = Base64(PackageJson("stripe")), encoding = "base64" });
        fx.GitHub.Calls.Clear();
        fx.GitHub.On($"/repos/{repoName}/git/trees/main", tree);
        fx.GitHub.On($"/repos/{repoName}/git/blobs/blob-pkg", blob);
        fx.Auth.Configured = true;
        try
        {
            var res = await client.PostAsync($"/v1/staff/atlas/repos/{repo.Id}/scan", null);
            var raw = await res.Content.ReadAsStringAsync();

            Assert.True(res.StatusCode == HttpStatusCode.OK, raw);
            Assert.DoesNotContain(ToggleGitHubAuth.TokenValue, raw);
            var json = JsonSerializer.Deserialize<JsonElement>(raw);
            Assert.Equal("applied", json.GetProperty("status").GetString());

            Assert.DoesNotContain(fx.GitHub.Calls, c => c.Url.Contains("blob-env", StringComparison.Ordinal));
            Assert.DoesNotContain(fx.GitHub.Calls, c => c.Url.Contains("blob-lock", StringComparison.Ordinal));
            Assert.All(fx.GitHub.Calls, c => Assert.Equal($"Bearer {ToggleGitHubAuth.TokenValue}", c.Authorization));
        }
        finally
        {
            fx.Auth.Configured = false;
        }

        await ReadAsync(async db =>
        {
            var changeSet = await db.AtlasChangeSets.SingleAsync(c => c.Repo == repoName);
            Assert.Equal("github-scan", changeSet.Source);
            Assert.Equal("tree-abc", changeSet.CommitSha);
            Assert.Equal("pushed", changeSet.Scope);
            var stripe = await db.AtlasServices.SingleAsync(s => s.Signature == "stripe" && s.ProductId == null);
            Assert.True(await db.AtlasEvidence.AnyAsync(e => e.SubjectId == stripe.Id && e.Source == $"repo:{repoName}" && e.Method == "manifest"));
            return 0;
        });
    }
}
