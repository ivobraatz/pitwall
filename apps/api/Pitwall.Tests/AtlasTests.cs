using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitwall.Domain;
using static Pitwall.Tests.TeamTaskKit;

namespace Pitwall.Tests;

/// <summary>
/// The Atlas over HTTP: it starts empty, the console and the MCP register through the same
/// upserts, a file loads a whole map at once, and activity and routine runs show up as "now".
/// Every name here is made up (Acme, Globex): an installation's real map lives in its database.
/// </summary>
public class AtlasTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private static string Slug(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..(prefix.Length + 9)];

    private async Task<HttpClient> AtlasTokenAsync(params string[] scopes)
    {
        var staff = await SeedStaffAsync(fx, "Bia");
        var (token, _) = await SeedTokenAsync(fx, staff.Id, scopes.Length == 0 ? [StaffTokenScopes.Atlas] : scopes);
        return TokenClient(fx, token);
    }

    private static async Task<JsonElement> OkAsync(Task<HttpResponseMessage> call)
    {
        var res = await call;
        var body = await res.Content.ReadAsStringAsync();
        Assert.True(res.IsSuccessStatusCode, $"{(int)res.StatusCode}: {body}");
        return body.Length == 0 ? default : JsonSerializer.Deserialize<JsonElement>(body);
    }

    private static JsonElement System(JsonElement overview, string slug) =>
        overview.GetProperty("systems").EnumerateArray().Single(s => s.GetProperty("slug").GetString() == slug);

    [Fact]
    public async Task A_new_installation_has_an_empty_atlas()
    {
        await using var isolated = new PitwallFixture();
        await isolated.InitializeAsync();
        try
        {
            var (session, _) = await SignInAsync(isolated);
            var overview = await OkAsync(session.GetAsync("/v1/staff/atlas"));
            foreach (var list in new[] { "systems", "environments", "services", "links", "repos", "now", "discoveries" })
                Assert.Equal(0, overview.GetProperty(list).GetArrayLength());
            Assert.All(overview.GetProperty("collectors").EnumerateArray(), c => Assert.False(c.GetProperty("connected").GetBoolean()));
            Assert.Equal(0, (await OkAsync(session.GetAsync("/v1/staff/atlas/routines"))).GetArrayLength());
        }
        finally { await isolated.DisposeAsync(); }
    }

    [Fact]
    public async Task Registering_twice_updates_instead_of_duplicating()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        var created = await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme", color = "#5eb0ff" }));
        Assert.True(created.GetProperty("created").GetBoolean());
        var again = await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, description = "Foguetes sob medida" }));
        Assert.False(again.GetProperty("created").GetBoolean());

        var service = new { system = acme, environment = "production", name = "API", kind = "api", provider = "Railway", externalRef = "acme/api", monitor = "Acme API" };
        var first = await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/services", service));
        var second = await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/services", service with { kind = "worker" }));
        Assert.Equal(first.GetProperty("id").GetGuid(), second.GetProperty("id").GetGuid());
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/services", new { name = $"Mail {acme}", provider = "mailer" }));
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/links", new { from = $"{acme}/production/API", to = $"Mail {acme}" }));
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/links", new { from = $"{acme}/API", to = $"Mail {acme}", label = "e-mail" }));
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/repos", new { fullName = $"Acme-Inc/{acme}", system = acme }));

        var overview = await OkAsync(mcp.GetAsync("/v1/staff/atlas"));
        var system = System(overview, acme);
        Assert.Equal("Acme", system.GetProperty("name").GetString());
        Assert.Equal("Foguetes sob medida", system.GetProperty("description").GetString());
        Assert.Equal(1, system.GetProperty("health").GetProperty("total").GetInt32());
        var api = overview.GetProperty("services").EnumerateArray().Single(s => s.GetProperty("id").GetGuid() == first.GetProperty("id").GetGuid());
        Assert.Equal("worker", api.GetProperty("kind").GetString());
        Assert.Equal("railway", api.GetProperty("provider").GetString());
        Assert.Equal("unknown", api.GetProperty("state").GetString());
        Assert.Single(overview.GetProperty("links").EnumerateArray(), l => l.GetProperty("from").GetGuid() == first.GetProperty("id").GetGuid());
        Assert.Contains(overview.GetProperty("repos").EnumerateArray(), r => r.GetProperty("fullName").GetString() == $"acme-inc/{acme}");
        Assert.Contains(overview.GetProperty("environments").EnumerateArray(), e => e.GetProperty("slug").GetString() == "production");
    }

    [Fact]
    public async Task Bad_input_is_refused_with_a_message()
    {
        var mcp = await AtlasTokenAsync();
        async Task Refused(string path, object body, HttpStatusCode status = HttpStatusCode.BadRequest)
        {
            var res = await mcp.PostAsJsonAsync(path, body);
            Assert.Equal(status, res.StatusCode);
            Assert.False(string.IsNullOrWhiteSpace((await res.Json()).GetProperty("message").GetString()));
        }
        await Refused("/v1/staff/atlas/systems", new { slug = "Com Espaço", name = "x" });
        await Refused("/v1/staff/atlas/systems", new { slug = Slug("novo") });
        await Refused("/v1/staff/atlas/services", new { system = "nao-existe", name = "API" });
        await Refused("/v1/staff/atlas/services", new { name = "API", url = "javascript:alert(1)" });
        await Refused("/v1/staff/atlas/repos", new { fullName = "sem-barra" });
        await Refused("/v1/staff/atlas/routines", new { slug = Slug("r"), name = "Rotina", frequency = "hourly" });
        await Refused("/v1/staff/atlas/links", new { from = "nada", to = "nada" });
        await Refused("/v1/staff/atlas/activities", new { description = "" });
        await Refused("/v1/staff/atlas/activities", new { system = "nao-existe", description = "x" }, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Token_needs_the_atlas_scope_and_reaches_nothing_else()
    {
        var tasksOnly = await AtlasTokenAsync(StaffTokenScopes.Tasks);
        var refused = await tasksOnly.GetAsync("/v1/staff/atlas");
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Contains("escopo atlas", (await refused.Json()).GetProperty("message").GetString());

        var atlas = await AtlasTokenAsync();
        Assert.Equal(HttpStatusCode.OK, (await atlas.GetAsync("/v1/staff/atlas")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await atlas.GetAsync("/v1/staff/tasks/board")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await atlas.GetAsync("/v1/staff/products")).StatusCode);
        // Loading a whole map is for an admin at the console: a token never does it.
        Assert.Equal(HttpStatusCode.Unauthorized, (await atlas.PostAsJsonAsync("/v1/staff/atlas/import", new { })).StatusCode);

        var (agent, _) = await SignInAsync(fx);
        Assert.Equal(HttpStatusCode.Forbidden, (await agent.PostAsJsonAsync("/v1/staff/atlas/import", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await NewClient(fx).GetAsync("/v1/staff/atlas")).StatusCode);
    }

    [Fact]
    public async Task Import_loads_a_map_once_and_again_without_duplicating()
    {
        var admin = await SeedStaffAsync(fx, "Ana", StaffRoles.Admin);
        var session = NewClient(fx);
        using (var login = new HttpRequestMessage(HttpMethod.Post, "/v1/staff/auth/login"))
        {
            login.Headers.Add(Pitwall.Auth.StaffSessionAuthHandler.CsrfHeader, "1");
            login.Content = JsonContent.Create(new { email = admin.Email, password = "senha-de-teste" });
            Assert.Equal(HttpStatusCode.OK, (await session.SendAsync(login)).StatusCode);
        }
        session.DefaultRequestHeaders.Add(Pitwall.Auth.StaffSessionAuthHandler.CsrfHeader, "1");

        var globex = Slug("globex");
        var cdn = $"CDN {globex}";
        var file = new
        {
            environments = new[] { new { slug = "staging", name = "Staging" }, new { slug = "production", name = "Produção" } },
            shared = new[] { new { name = cdn, provider = "cdn" } },
            systems = new[]
            {
                new
                {
                    slug = globex, name = "Globex", description = "Energia limpa", color = "#34d08c",
                    repos = new[] { $"globex-corp/{globex}" },
                    services = new object[]
                    {
                        new { name = "API", kind = "api", environment = "production", provider = "railway", externalRef = "globex/api", uses = new[] { cdn, $"{globex}/production/Banco" } },
                        new { name = "Banco", kind = "database", environment = "production", provider = "railway" },
                        new { name = "API", kind = "api", environment = "staging", provider = "railway" },
                    },
                },
            },
            routines = new[] { new { slug = $"saude-{globex}", name = "Saúde", frequency = "daily", system = globex, prompt = "Confira os monitores." } },
        };

        var dry = await OkAsync(session.PostAsJsonAsync("/v1/staff/atlas/import?dryRun=true", file));
        Assert.Equal(4, dry.GetProperty("services").GetInt32());
        await WithDbAsync(fx, async db => Assert.False(await db.Products.AnyAsync(p => p.Slug == globex)));

        foreach (var _ in new[] { 1, 2 })
        {
            var result = await OkAsync(session.PostAsJsonAsync("/v1/staff/atlas/import", file));
            Assert.Equal(1, result.GetProperty("systems").GetInt32());
            Assert.Equal(2, result.GetProperty("links").GetInt32());
            Assert.Equal(1, result.GetProperty("routines").GetInt32());
        }
        await WithDbAsync(fx, async db =>
        {
            var product = await db.Products.SingleAsync(p => p.Slug == globex);
            Assert.Equal(3, await db.AtlasServices.CountAsync(s => s.ProductId == product.Id));
            Assert.Equal(2, await db.AtlasLinks.CountAsync(l => l.From.ProductId == product.Id));
            Assert.Equal(1, await db.AtlasRepos.CountAsync(r => r.ProductId == product.Id));
            Assert.Equal(1, await db.AtlasRoutines.CountAsync(r => r.ProductId == product.Id));
        });

        // One bad line and nothing of the file is saved.
        var other = Slug("initech");
        var bad = await session.PostAsJsonAsync("/v1/staff/atlas/import", new
        {
            systems = new object[] { new { slug = other, name = "Initech" }, new { slug = "Inválido!", name = "x" } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(1, (await bad.Json()).GetProperty("errors").GetArrayLength());
        await WithDbAsync(fx, async db => Assert.False(await db.Products.AnyAsync(p => p.Slug == other)));
    }

    [Fact]
    public async Task Activity_shows_as_now_until_it_is_finished()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var service = await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/services", new { system = acme, environment = "production", name = "API" }));

        var started = await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/activities", new { system = acme, component = "api", description = "Corrigindo o cálculo de frete" }));
        var id = started.GetProperty("id").GetGuid();
        JsonElement? Mine(JsonElement overview) => overview.GetProperty("now").EnumerateArray()
            .Where(n => n.GetProperty("id").GetString() == id.ToString()).Select(n => (JsonElement?)n).FirstOrDefault();

        var now = Mine(await OkAsync(mcp.GetAsync("/v1/staff/atlas")));
        Assert.NotNull(now);
        Assert.Equal("activity", now.Value.GetProperty("kind").GetString());
        Assert.Equal("Bia (Claude)", now.Value.GetProperty("actor").GetString());
        // The component named a registered service, so that node is the one to pulse.
        Assert.Equal(service.GetProperty("id").GetGuid(), now.Value.GetProperty("serviceId").GetGuid());

        await OkAsync(mcp.PostAsJsonAsync($"/v1/staff/atlas/activities/{id}/finish", new { status = "ok", result = "PR aberto" }));
        Assert.Null(Mine(await OkAsync(mcp.GetAsync("/v1/staff/atlas"))));
        // Finishing again keeps the first result.
        await OkAsync(mcp.PostAsJsonAsync($"/v1/staff/atlas/activities/{id}/finish", new { status = "failed" }));
        await WithDbAsync(fx, async db => Assert.Equal("ok", (await db.AtlasActivities.SingleAsync(a => a.Id == id)).Status));

        // An activity nobody closed stops being "now" on its own.
        var stale = await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/activities", new { description = "Sessão abandonada" }));
        var staleId = stale.GetProperty("id").GetGuid();
        await WithDbAsync(fx, db => db.AtlasActivities.Where(a => a.Id == staleId)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.StartedAt, DateTime.UtcNow.AddHours(-13))));
        Assert.DoesNotContain((await OkAsync(mcp.GetAsync("/v1/staff/atlas"))).GetProperty("now").EnumerateArray(),
            n => n.GetProperty("id").GetString() == staleId.ToString());
    }

    [Fact]
    public async Task Routine_run_is_listed_with_what_it_produced()
    {
        var mcp = await AtlasTokenAsync();
        var slug = Slug("triagem");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/routines", new { slug, name = "Triagem de erros", frequency = "daily", description = "Lê os erros novos", prompt = "Leia os erros novos e abra um PR quando a causa for clara." }));

        var due = await OkAsync(mcp.GetAsync("/v1/staff/atlas/routines?frequency=daily&enabled=true"));
        var routine = due.EnumerateArray().Single(r => r.GetProperty("slug").GetString() == slug);
        Assert.StartsWith("Leia os erros", routine.GetProperty("prompt").GetString());
        Assert.Equal(JsonValueKind.Null, routine.GetProperty("lastRun").ValueKind);

        var run = await OkAsync(mcp.PostAsync($"/v1/staff/atlas/routines/{slug}/runs", null));
        var runId = run.GetProperty("id").GetGuid();
        Assert.Contains((await OkAsync(mcp.GetAsync("/v1/staff/atlas"))).GetProperty("now").EnumerateArray(),
            n => n.GetProperty("kind").GetString() == "routine" && n.GetProperty("id").GetString() == runId.ToString());

        Assert.Equal(HttpStatusCode.BadRequest, (await mcp.PostAsJsonAsync($"/v1/staff/atlas/runs/{runId}/finish", new { status = "talvez" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await mcp.PostAsJsonAsync($"/v1/staff/atlas/runs/{runId}/finish",
            new { status = "ok", links = new[] { new { kind = "pr", label = "x", url = "ftp://nope" } } })).StatusCode);
        await OkAsync(mcp.PostAsJsonAsync($"/v1/staff/atlas/runs/{runId}/finish", new
        {
            status = "ok", result = "2 erros novos, 1 PR",
            links = new[] { new { kind = "pr", label = "Corrige o frete", url = "https://git.example.com/acme/acme/pull/7" }, new { kind = "task", label = "T-AAAAA", url = "" } },
        }));

        var runs = await OkAsync(mcp.GetAsync($"/v1/staff/atlas/routines/{slug}/runs"));
        var done = runs.EnumerateArray().Single();
        Assert.Equal("ok", done.GetProperty("status").GetString());
        Assert.Equal(["pr", "task"], done.GetProperty("links").EnumerateArray().Select(l => l.GetProperty("kind").GetString()));
        var listed = (await OkAsync(mcp.GetAsync("/v1/staff/atlas/routines"))).EnumerateArray().Single(r => r.GetProperty("slug").GetString() == slug);
        Assert.Equal("2 erros novos, 1 PR", listed.GetProperty("lastRun").GetProperty("summary").GetString());

        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/routines", new { slug, enabled = false }));
        Assert.DoesNotContain((await OkAsync(mcp.GetAsync("/v1/staff/atlas/routines?enabled=true"))).EnumerateArray(), r => r.GetProperty("slug").GetString() == slug);
        Assert.Equal(HttpStatusCode.NotFound, (await mcp.PostAsync("/v1/staff/atlas/routines/nao-existe/runs", null)).StatusCode);
    }

    [Fact]
    public async Task Overview_counts_what_is_pending_and_flows_mark_the_gaps()
    {
        var staff = await SeedStaffAsync(fx, "Bia");
        var (token, _) = await SeedTokenAsync(fx, staff.Id, [StaffTokenScopes.Atlas, StaffTokenScopes.Tasks]);
        var mcp = TokenClient(fx, token);
        var acme = Slug("acme");
        var system = await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var productId = system.GetProperty("id").GetGuid();
        await CreateTaskAsync(mcp, new { title = "Gerar token de leitura", product = acme });
        await CreateTaskAsync(mcp, new { title = "Já feita", product = acme, status = "done" });
        await WithDbAsync(fx, async db =>
        {
            foreach (var signature in new[] { "a", "a", "b" })
                db.ServerErrors.Add(new ServerError
                {
                    Id = Guid.NewGuid(), ProductId = productId, TraceId = Guid.NewGuid().ToString("N"), Method = "GET", Path = "/x",
                    StatusCode = 500, ExceptionType = "Boom", Message = "boom", Signature = signature, OccurredAt = DateTime.UtcNow, ReceivedAt = DateTime.UtcNow,
                });
            db.AtlasRepos.Add(new AtlasRepo { Id = Guid.NewGuid(), ProductId = productId, FullName = $"acme-inc/{acme}", OpenAlerts = 3, Commits7d = 12, Runs7d = 9, FailedRuns7d = 2, CheckedAt = DateTime.UtcNow, CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        });

        var pending = System(await OkAsync(mcp.GetAsync("/v1/staff/atlas")), acme).GetProperty("pending");
        Assert.Equal(1, pending.GetProperty("tasks").GetInt32());
        Assert.Equal(2, pending.GetProperty("errors").GetInt32());
        Assert.Equal(3, pending.GetProperty("alerts").GetInt32());

        var flows = (await OkAsync(mcp.GetAsync($"/v1/staff/atlas/flows?system={acme}"))).EnumerateArray().Single().GetProperty("flows");
        JsonElement Step(string flow, string step) => flows.EnumerateArray().Single(f => f.GetProperty("key").GetString() == flow)
            .GetProperty("steps").EnumerateArray().Single(s => s.GetProperty("key").GetString() == step);
        Assert.Equal(12, Step("code", "commit").GetProperty("value").GetInt32());
        Assert.Equal(9, Step("code", "ci").GetProperty("value").GetInt32());
        Assert.Equal("2", Step("code", "ci").GetProperty("detail").GetString());
        // No service registered, so nothing is known about deploys or production: a gap, not a zero.
        Assert.Equal(JsonValueKind.Null, Step("code", "deploy").GetProperty("value").ValueKind);
        Assert.Equal(JsonValueKind.Null, Step("code", "production").GetProperty("value").ValueKind);
        Assert.Equal(2, Step("errors", "error").GetProperty("value").GetInt32());
        Assert.Equal(2, Step("errors", "task").GetProperty("value").GetInt32());
        Assert.Equal(1, Step("errors", "fix").GetProperty("value").GetInt32());
        Assert.Equal(JsonValueKind.Null, Step("content", "social").GetProperty("value").ValueKind);
    }
}
