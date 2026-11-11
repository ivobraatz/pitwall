using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Atlas;
using Pitwall.Services.Atlas.Sync;

namespace Pitwall.Tests;

/// <summary>
/// A scan adopts the nodes a person declared by hand, instead of making a second node next to them (contract 5.3).
/// Its own class, so its own database: the shared "resend" node is found by signature, and only the shared
/// test here may create it, so nothing else in this class syncs a mail provider.
/// </summary>
public class AtlasSyncMatchTests(AtlasSyncFixture fx) : IClassFixture<AtlasSyncFixture>
{
    private const string Pipeline = "gh-workflow:deploy.yml";

    private const string DeployWorkflow = """
        name: Deploy
        on:
          push:
            branches: [main]
        jobs:
          deploy:
            steps:
              - run: railway up --service api
        """;

    private sealed record DeclaredNode(string Name, string Kind, string? Environment = null, string? Provider = null);

    // ---- Helpers -----------------------------------------------------------------------------

    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..(prefix.Length + 9)];

    private static string RepoName() => $"acme-inc/{Unique("rockets")}";

    private static string NodeKey(string system, string name) => $"{system}:any:{AtlasWriter.NameSlug(name)}";

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

    private async Task<AtlasRepo> SeedRepoAsync(string fullName, Guid productId)
    {
        using var scope = fx.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        var repo = new AtlasRepo { Id = Guid.NewGuid(), FullName = fullName, ProductId = productId, DefaultBranch = "main", CreatedAt = DateTime.UtcNow };
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

    private static object Body(string repo, string scope, object? files, object? report = null, string? key = null, string commit = "c0ffee") =>
        new { idempotencyKey = key, source = "agent", repo, commitSha = commit, scope, files, report };

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

    /// <summary>Declares nodes of the repository's system by a report, as a person or an agent does.</summary>
    private static async Task DeclareAsync(HttpClient client, string repo, params DeclaredNode[] nodes)
    {
        await SyncOkAsync(client, Body(repo, "local", Files(), key: Unique("declare"), report: new
        {
            ops = nodes.Select(n => (object)new { op = "node", name = n.Name, kind = n.Kind, environment = n.Environment, provider = n.Provider }).ToArray(),
        }));
    }

    /// <summary>A shared declared node (no system): how a person declares an outside service, such as a mail provider.</summary>
    private async Task<Guid> SharedDeclaredAsync(string name, string kind, string provider)
    {
        using var scope = fx.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        var now = DateTime.UtcNow;
        var service = new AtlasService
        {
            Id = Guid.NewGuid(), Key = $"shared:any:{AtlasWriter.NameSlug(name)}", Name = name, Kind = kind, Provider = provider,
            Engine = AtlasEngines.ForKind(kind), Origin = AtlasOrigins.Declared, CreatedAt = now, UpdatedAt = now,
        };
        db.AtlasServices.Add(service);
        await db.SaveChangesAsync();
        return service.Id;
    }

    private static string PackageJson(params string[] deps)
    {
        var dependencies = deps.ToDictionary(d => d, _ => (object)"^1.0.0");
        dependencies["next"] = "16.4.5";
        return JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["name"] = "rockets",
            ["packageManager"] = "pnpm@9.15.0",
            ["dependencies"] = dependencies,
        });
    }

    private static object Package(params string[] deps) => Files(("package.json", PackageJson(deps)), ("pnpm-lock.yaml", null));

    // ---- Declared nodes that a scan adopts -----------------------------------------------------------

    [Fact]
    public async Task Declared_database_in_two_environments_is_adopted_not_duplicated()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();
        await DeclareAsync(client, repo,
            new DeclaredNode("Banco", "database", "production", Provider: "acme-db"),
            new DeclaredNode("Banco", "database", "staging"));

        var json = await SyncOkAsync(client, Body(repo, "pushed", Package("pg"), key: Unique("pg")));

        Assert.DoesNotContain(NodeKey(system.Slug, "Postgres"), Strings(json, "created"));
        await ReadAsync(async db =>
        {
            var banco = await db.AtlasServices.Where(s => s.ProductId == system.Id && s.Name == "Banco").ToListAsync();
            Assert.Equal(2, banco.Count);
            Assert.All(banco, s => Assert.Equal("postgres", s.Signature));
            Assert.Equal(0, await db.AtlasServices.CountAsync(s => s.ProductId == system.Id && s.Name == "Postgres"));
            foreach (var node in banco)
                Assert.True(await db.AtlasEvidence.AnyAsync(e => e.SubjectId == node.Id && e.Source == $"repo:{repo}"));

            // The declared node keeps what the person wrote: the scan adds only the signature and the evidence.
            Assert.Equal("acme-db", banco.Single(s => s.EnvironmentId != null && s.Provider == "acme-db").Provider);
            return 0;
        });
    }

    [Fact]
    public async Task Two_declared_databases_in_one_environment_are_ambiguous_and_the_scan_creates_one_node()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();
        await DeclareAsync(client, repo,
            new DeclaredNode("Banco principal", "database", "production"),
            new DeclaredNode("Banco de relatórios", "database", "production"));

        var json = await SyncOkAsync(client, Body(repo, "pushed", Package("pg"), key: Unique("pg")));

        Assert.Contains(NodeKey(system.Slug, "Postgres"), Strings(json, "created"));
        await ReadAsync(async db =>
        {
            var declared = await db.AtlasServices.Where(s => s.ProductId == system.Id && s.Kind == "database" && s.Name != "Postgres").ToListAsync();
            Assert.Equal(2, declared.Count);
            Assert.All(declared, s => Assert.Null(s.Signature));
            var created = await db.AtlasServices.SingleAsync(s => s.ProductId == system.Id && s.Name == "Postgres");
            Assert.Equal("postgres", created.Signature);
            Assert.Equal(AtlasOrigins.Discovered, created.Origin);
            return 0;
        });
    }

    [Fact]
    public async Task Declared_shared_mail_service_is_adopted_by_its_provider()
    {
        // This class syncs no other mail provider, so the shared "resend" node is only the one declared here.
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();
        var mailId = await SharedDeclaredAsync("E-mail transacional", "email", "resend");

        var json = await SyncOkAsync(client, Body(repo, "pushed", Package("resend"), key: Unique("resend")));

        Assert.Empty(Strings(json, "created"));
        await ReadAsync(async db =>
        {
            var resend = await db.AtlasServices.Where(s => s.ProductId == null && s.Signature == "resend").ToListAsync();
            Assert.Equal(mailId, Assert.Single(resend).Id);
            Assert.Equal(0, await db.AtlasServices.CountAsync(s => s.ProductId == null && s.Key == "shared:any:resend"));
            Assert.True(await db.AtlasEvidence.AnyAsync(e => e.SubjectId == mailId && e.Source == $"repo:{repo}"));
            return 0;
        });
    }

    [Fact]
    public async Task Declared_pipeline_without_environment_is_adopted_by_the_workflow()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();
        await DeclareAsync(client, repo, new DeclaredNode("CI", "pipeline"));

        var json = await SyncOkAsync(client, Body(repo, "pushed", Files((".github/workflows/deploy.yml", DeployWorkflow)), key: Unique("ci")));

        Assert.DoesNotContain(NodeKey(system.Slug, "CI: Deploy"), Strings(json, "created"));
        await ReadAsync(async db =>
        {
            var ci = await db.AtlasServices.SingleAsync(s => s.ProductId == system.Id && s.Name == "CI");
            Assert.Equal(Pipeline, ci.Signature);
            Assert.Equal(0, await db.AtlasServices.CountAsync(s => s.ProductId == system.Id && s.Name == "CI: Deploy"));
            Assert.True(await db.AtlasEvidence.AnyAsync(e => e.SubjectId == ci.Id && e.Source == $"repo:{repo}"));
            return 0;
        });
    }

    [Fact]
    public async Task Retired_declared_database_is_not_adopted()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();
        await DeclareAsync(client, repo, new DeclaredNode("Banco", "database", "production"));
        await ReadAsync(async db =>
        {
            var banco = await db.AtlasServices.SingleAsync(s => s.ProductId == system.Id && s.Name == "Banco");
            banco.RetiredAt = DateTime.UtcNow;
            banco.RetiredReason = "substituído";
            await db.SaveChangesAsync();
            return 0;
        });

        var json = await SyncOkAsync(client, Body(repo, "pushed", Package("pg"), key: Unique("pg")));

        Assert.Contains(NodeKey(system.Slug, "Postgres"), Strings(json, "created"));
        await ReadAsync(async db =>
        {
            var banco = await db.AtlasServices.SingleAsync(s => s.ProductId == system.Id && s.Name == "Banco");
            Assert.Null(banco.Signature);
            Assert.NotNull(banco.RetiredAt);
            return 0;
        });
    }

    [Fact]
    public async Task A_second_scan_of_the_same_files_under_another_commit_creates_no_node()
    {
        var system = await SeedSystemAsync(Unique("acme"));
        var repo = RepoName();
        await SeedRepoAsync(repo, system.Id);
        var client = await AtlasClientAsync();
        await DeclareAsync(client, repo,
            new DeclaredNode("Banco", "database", "production"),
            new DeclaredNode("Banco", "database", "staging"));
        await SyncOkAsync(client, Body(repo, "pushed", Package("pg"), key: Unique("first"), commit: "c0ffee"));
        var before = await ReadAsync(db => db.AtlasServices.CountAsync(s => s.ProductId == system.Id));

        var second = await SyncOkAsync(client, Body(repo, "pushed", Package("pg"), key: Unique("second"), commit: "beef01"));

        Assert.Empty(Strings(second, "created"));
        Assert.Equal(before, await ReadAsync(db => db.AtlasServices.CountAsync(s => s.ProductId == system.Id)));
        Assert.Equal(2, await ReadAsync(db => db.AtlasServices.CountAsync(s => s.ProductId == system.Id && s.Signature == "postgres")));
    }
}
