using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
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
using Testcontainers.PostgreSql;

namespace Pitwall.Tests;

/// <summary>
/// The app configured as production is: a webhook secret and a token for GitHub (faked). Its own Postgres,
/// since the webhook tests write repositories and events that the other fixture must not see.
/// </summary>
public sealed class GitHubHookFixture : IAsyncLifetime
{
    public const string Secret = "segredo-de-teste-do-webhook";

    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder("postgres:17-alpine").Build();
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;

    /// <summary>The GitHub the app talks to: the listing of the repositories the token can see.</summary>
    public ConnectorKit.FakeProvider GitHub { get; } = new ConnectorKit.FakeProvider()
        .On("/user/repos", """
            [{"id":900001,"full_name":"Acme-Inc/Rockets","html_url":"https://github.example/acme-inc/rockets","archived":false,"fork":false,"default_branch":"main"},
             {"id":900002,"full_name":"acme-inc/unknown-app","html_url":"https://github.example/acme-inc/unknown-app","archived":false,"fork":false,"default_branch":"main"}]
            """);

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
                ["Atlas:GitHub:WebhookSecret"] = Secret,
                ["Atlas:GitHub:Token"] = ConnectorKit.Token,
            }));
            b.ConfigureServices(s => s.AddHttpClient("atlas").ConfigurePrimaryHttpMessageHandler(() => GitHub));
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

/// <summary>
/// The GitHub webhook (signed, idempotent, renames by id) and the repository list the console registers from.
/// Names and ids are made up (Acme, acme-inc/rockets).
/// </summary>
public class AtlasConnectorWebhookTests(GitHubHookFixture hook, PitwallFixture fx) : IClassFixture<GitHubHookFixture>, IClassFixture<PitwallFixture>
{
    private static string Sign(string secret, byte[] body) =>
        "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), body)).ToLowerInvariant();

    private static async Task<HttpResponseMessage> PostAsync(HttpClient client, string eventName, string delivery, object payload,
        string? signature = null, bool sign = true)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload);
        using var req = new HttpRequestMessage(HttpMethod.Post, "/v1/hooks/github") { Content = new ByteArrayContent(bytes) };
        req.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        req.Headers.Add("X-GitHub-Event", eventName);
        req.Headers.Add("X-GitHub-Delivery", delivery);
        if (signature is not null) req.Headers.Add("X-Hub-Signature-256", signature);
        else if (sign) req.Headers.Add("X-Hub-Signature-256", Sign(GitHubHookFixture.Secret, bytes));
        return await client.SendAsync(req);
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage res) =>
        JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.Clone();

    private static async Task<AtlasRepo> SeedRepoAsync(WebApplicationFactory<Program> factory, string fullName, string? externalId, Guid? productId = null, string? role = null)
    {
        var repo = new AtlasRepo { Id = Guid.NewGuid(), FullName = fullName, ExternalId = externalId, ProductId = productId, Role = role, CreatedAt = DateTime.UtcNow };
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        db.AtlasRepos.Add(repo);
        await db.SaveChangesAsync();
        return repo;
    }

    private static async Task<T> ReadAsync<T>(WebApplicationFactory<Program> factory, Func<PitwallDb, Task<T>> read)
    {
        using var scope = factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<PitwallDb>());
    }

    /// <summary>A token with the Atlas scope, straight into the factory's database.</summary>
    private static async Task<string> SeedAtlasTokenAsync(WebApplicationFactory<Program> factory)
    {
        var now = DateTime.UtcNow;
        var token = Tokens.NewStaffToken();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        var staff = new StaffUser
        {
            Id = Guid.NewGuid(), Email = $"staff-{Guid.NewGuid():N}@pitwall.test", Name = "Bia", Role = StaffRoles.Agent,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("senha-de-teste", 4), CreatedAt = now,
        };
        db.Staff.Add(staff);
        db.StaffTokens.Add(new StaffToken
        {
            Id = Guid.NewGuid(), StaffUserId = staff.Id, Name = "teste", Prefix = token[..12], Hash = Tokens.Hash(token),
            Scopes = [StaffTokenScopes.Atlas], CreatedAt = now,
        });
        await db.SaveChangesAsync();
        return token;
    }

    [Fact]
    public async Task Without_a_secret_the_hook_does_not_exist()
    {
        // The plain test fixture has no webhook secret: the same answer as for any unknown address.
        var client = fx.Factory.CreateClient();
        var res = await PostAsync(client, "ping", Guid.NewGuid().ToString(), new { zen = "test" }, sign: false);
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task A_wrong_or_missing_signature_is_refused()
    {
        var client = hook.Factory.CreateClient();
        var payload = new { zen = "test" };
        var wrong = Sign("outro-segredo", JsonSerializer.SerializeToUtf8Bytes(payload));
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "ping", "d-wrong", payload, signature: wrong)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "ping", "d-none", payload, sign: false)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "ping", "d-hex", payload, signature: "sha256=zz")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "ping", "d-prefix", payload, signature: "md5=abc")).StatusCode);
    }

    [Fact]
    public async Task A_ping_is_acknowledged()
    {
        var res = await PostAsync(hook.Factory.CreateClient(), "ping", Guid.NewGuid().ToString(), new { zen = "Keep it logically awesome." });
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    [Fact]
    public async Task A_failed_workflow_run_updates_the_repository_and_records_ci_failed()
    {
        var name = $"acme-inc/{ConnectorKit.Unique("rockets")}";
        var externalId = Random.Shared.NextInt64(10_000_000, 99_999_999).ToString();
        var repo = await SeedRepoAsync(hook.Factory, name, externalId);
        var delivery = Guid.NewGuid().ToString();

        var res = await PostAsync(hook.Factory.CreateClient(), "workflow_run", delivery, new
        {
            action = "completed",
            workflow_run = new { id = 77001, name = "CI", @event = "push", status = "completed", conclusion = "failure",
                created_at = "2026-11-09T10:00:00Z", html_url = "https://github.example/acme-inc/rockets/actions/runs/77001", head_sha = "0123abc" },
            repository = new { id = long.Parse(externalId), full_name = name },
        });

        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        Assert.True((await JsonAsync(res)).GetProperty("accepted").GetBoolean());
        var row = await ReadAsync(hook.Factory, db => db.AtlasRepos.SingleAsync(r => r.Id == repo.Id));
        Assert.Equal("failure", row.LastRunStatus);
        Assert.Equal("CI", row.LastRunName);
        Assert.Equal("0123abc", row.LastRunSha);
        Assert.Equal(new DateTime(2026, 11, 9, 10, 0, 0, DateTimeKind.Utc), row.LastRunAt);

        var ci = await ReadAsync(hook.Factory, db => db.AtlasEvents.SingleAsync(e => e.RepoId == repo.Id && e.Type == "ci.failed"));
        Assert.Equal("github", ci.Source);
        Assert.Equal("failed", ci.Status);
        Assert.Equal("run:77001:failure", ci.ExternalId);

        var source = await ReadAsync(hook.Factory, db => db.AtlasSources.SingleAsync(s => s.Name == "github-webhook"));
        Assert.NotNull(source.LastOkAt);
    }

    [Fact]
    public async Task The_same_delivery_twice_records_one_event()
    {
        var name = $"acme-inc/{ConnectorKit.Unique("pushes")}";
        var externalId = Random.Shared.NextInt64(10_000_000, 99_999_999).ToString();
        await SeedRepoAsync(hook.Factory, name, externalId);
        var delivery = Guid.NewGuid().ToString();
        var payload = new
        {
            @ref = "refs/heads/main", after = "fedcba9876", commits = new[] { new { id = "a" }, new { id = "b" } },
            repository = new { id = long.Parse(externalId), full_name = name },
        };
        var client = hook.Factory.CreateClient();

        var first = await JsonAsync(await PostAsync(client, "push", delivery, payload));
        var second = await JsonAsync(await PostAsync(client, "push", delivery, payload));

        Assert.Equal(1, first.GetProperty("recorded").GetInt32());
        Assert.Equal(0, second.GetProperty("recorded").GetInt32());
        var events = await ReadAsync(hook.Factory, db => db.AtlasEvents.Where(e => e.ExternalId == delivery).ToListAsync());
        var pushed = Assert.Single(events);
        Assert.Equal("push", pushed.Type);
        Assert.Equal("2 commits em main", pushed.Title);
        Assert.Equal("fedcba9876", pushed.CommitSha);
    }

    [Fact]
    public async Task A_renamed_repository_keeps_its_id_and_takes_the_new_name()
    {
        var oldName = $"acme-inc/{ConnectorKit.Unique("before")}";
        var newName = $"acme-inc/{ConnectorKit.Unique("after")}";
        var externalId = Random.Shared.NextInt64(10_000_000, 99_999_999).ToString();
        var repo = await SeedRepoAsync(hook.Factory, oldName, externalId);

        var res = await PostAsync(hook.Factory.CreateClient(), "repository", Guid.NewGuid().ToString(), new
        {
            action = "renamed",
            repository = new { id = long.Parse(externalId), full_name = newName },
        });

        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var row = await ReadAsync(hook.Factory, db => db.AtlasRepos.SingleAsync(r => r.Id == repo.Id));
        Assert.Equal(newName, row.FullName);
        Assert.Equal(externalId, row.ExternalId);
    }

    [Fact]
    public async Task A_delivery_for_an_unknown_repository_is_accepted_and_nothing_is_written()
    {
        var delivery = Guid.NewGuid().ToString();
        var res = await PostAsync(hook.Factory.CreateClient(), "push", delivery, new
        {
            @ref = "refs/heads/main", after = "00ff", commits = new[] { new { id = "a" } },
            repository = new { id = 8_888_881L, full_name = $"acme-inc/{ConnectorKit.Unique("stranger")}" },
        });

        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        Assert.False((await JsonAsync(res)).GetProperty("accepted").GetBoolean());
        Assert.False(await ReadAsync(hook.Factory, db => db.AtlasEvents.AnyAsync(e => e.ExternalId == delivery)));
    }

    [Fact]
    public async Task A_merged_pull_request_records_pr_merged()
    {
        var name = $"acme-inc/{ConnectorKit.Unique("merges")}";
        var externalId = Random.Shared.NextInt64(10_000_000, 99_999_999).ToString();
        await SeedRepoAsync(hook.Factory, name, externalId);
        var delivery = Guid.NewGuid().ToString();

        await PostAsync(hook.Factory.CreateClient(), "pull_request", delivery, new
        {
            action = "closed", number = 42, pull_request = new { title = "Ajusta o painel", merged = true, html_url = "https://github.example/acme-inc/x/pull/42", head = new { sha = "abc999" } },
            repository = new { id = long.Parse(externalId), full_name = name },
        });

        var merged = await ReadAsync(hook.Factory, db => db.AtlasEvents.SingleAsync(e => e.ExternalId == delivery));
        Assert.Equal("pr.merged", merged.Type);
        Assert.Equal("PR #42: Ajusta o painel", merged.Title);
    }

    [Fact]
    public async Task The_repository_list_marks_what_is_registered_with_its_system_and_role()
    {
        var product = new Product { Id = Guid.NewGuid(), Slug = ConnectorKit.Unique("acme"), Name = "Acme", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
        using (var scope = hook.Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<PitwallDb>().Products.Add(product);
            await scope.ServiceProvider.GetRequiredService<PitwallDb>().SaveChangesAsync();
        }
        // The listing names it acme-inc/rockets with id 900001: registered by id, whatever the case of its name.
        await SeedRepoAsync(hook.Factory, "acme-inc/rockets", "900001", product.Id, role: "backend");
        var token = await SeedAtlasTokenAsync(hook.Factory);
        var client = hook.Factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var before = hook.GitHub.Requests.Count(r => r.Url.Contains("/user/repos"));
        var first = await client.GetAsync("/v1/staff/atlas/github/repos");
        var second = await client.GetAsync("/v1/staff/atlas/github/repos");
        var listed = hook.GitHub.Requests.Count(r => r.Url.Contains("/user/repos")) - before;
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        // Five minutes of memory: the second call did not ask GitHub again (the first may have, if this is the first call of the run).
        Assert.True(listed <= 1, $"GitHub was asked {listed} times");

        var rows = (await JsonAsync(first)).EnumerateArray().ToList();
        var rockets = rows.Single(r => r.GetProperty("fullName").GetString() == "acme-inc/rockets");
        Assert.True(rockets.GetProperty("registered").GetBoolean());
        Assert.Equal("backend", rockets.GetProperty("role").GetString());
        Assert.Equal(product.Slug, rockets.GetProperty("system").GetProperty("slug").GetString());
        Assert.Equal(product.Name, rockets.GetProperty("system").GetProperty("name").GetString());
        Assert.Equal("main", rockets.GetProperty("defaultBranch").GetString());

        var unknown = rows.Single(r => r.GetProperty("fullName").GetString() == "acme-inc/unknown-app");
        Assert.False(unknown.GetProperty("registered").GetBoolean());
        Assert.Equal(JsonValueKind.Null, unknown.GetProperty("system").ValueKind);
    }

    [Fact]
    public async Task The_repository_list_answers_409_without_a_github_connection()
    {
        var token = await SeedAtlasTokenAsync(fx.Factory);
        var client = fx.Factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var res = await client.GetAsync("/v1/staff/atlas/github/repos");
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Contains("Conecte o GitHub", (await JsonAsync(res)).GetProperty("message").GetString());
    }
}
