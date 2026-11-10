using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Pitwall.Domain;
using static Pitwall.Tests.TeamTaskKit;

namespace Pitwall.Tests;

/// <summary>
/// What the team declares on top of what the collectors see: details and gaps on services, typed
/// links, and processes whose steps say how a thing is done today and how it should be. Names are
/// made up (Acme, Globex).
/// </summary>
public class AtlasKnowledgeTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private static string Slug(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..(prefix.Length + 9)];

    private async Task<HttpClient> AtlasTokenAsync()
    {
        var staff = await SeedStaffAsync(fx, "Bia");
        var (token, _) = await SeedTokenAsync(fx, staff.Id, [StaffTokenScopes.Atlas]);
        return TokenClient(fx, token);
    }

    private async Task<HttpClient> AdminSessionAsync()
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
        return session;
    }

    private static async Task<JsonElement> OkAsync(Task<HttpResponseMessage> call)
    {
        var res = await call;
        var body = await res.Content.ReadAsStringAsync();
        Assert.True(res.IsSuccessStatusCode, $"{(int)res.StatusCode}: {body}");
        return body.Length == 0 ? default : JsonSerializer.Deserialize<JsonElement>(body);
    }

    private static async Task<string> BadAsync(Task<HttpResponseMessage> call)
    {
        var res = await call;
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString()!;
    }

    [Fact]
    public async Task A_file_loads_details_gaps_typed_links_and_processes()
    {
        var admin = await AdminSessionAsync();
        var acme = Slug("acme");
        var globex = Slug("globex");
        var file = new
        {
            systems = new object[]
            {
                new
                {
                    slug = acme, name = "Acme",
                    services = new object[]
                    {
                        new
                        {
                            name = "API", kind = "api", environment = "production", provider = "railway", group = "Núcleo",
                            facts = new Dictionary<string, string> { ["Health"] = "/health", ["Memória"] = "1 GB" },
                            links = new object[] { new { to = $"{acme}/Bucket", kind = "storage" }, new { to = $"{acme}/App da loja", kind = "deploy", planned = true } },
                        },
                        new { name = "Bucket", kind = "storage", provider = "cloudflare" },
                        new
                        {
                            name = "App da loja", kind = "app", group = "Na web", condition = "gap", impact = "high", owner = "person",
                            task = "t-abc12", notes = "O app só sai como pacote avulso.",
                        },
                        new { name = "Conectores", kind = "integration", items = new[] { "Mastodon", "Bluesky", "Mastodon" } },
                    },
                },
                new { slug = globex, name = "Globex" },
            },
            processes = new object[]
            {
                new
                {
                    slug = $"{acme}-funil", name = "Funil",
                    stages = new[] { new { key = "oferta", name = "Oferta" }, new { key = "receita", name = "Receita" } },
                    steps = new object[]
                    {
                        new { slug = "acme-oferta", name = "Planos", system = acme, stage = "oferta", status = "ok", owner = "auto", services = new[] { $"{acme}/API" } },
                        new { slug = "acme-nota", name = "Nota fiscal", system = acme, stage = "receita", status = "warn", impact = "medium", today = "Sem emitir." },
                        new { slug = "globex-oferta", name = "Planos", system = globex, stage = "oferta", status = "gap", impact = "low", next = "Escrever a oferta." },
                    },
                },
                new
                {
                    slug = $"{acme}-manter", name = "Cuidar dos sistemas", system = acme,
                    steps = new object[] { new { slug = "ci", name = "Código e CI", status = "ok" }, new { slug = "custos", name = "Custos", status = "idea" } },
                },
            },
        };
        var result = await OkAsync(admin.PostAsJsonAsync("/v1/staff/atlas/import", file));
        Assert.Equal(2, result.GetProperty("processes").GetInt32());
        Assert.Equal(5, result.GetProperty("steps").GetInt32());
        Assert.Equal(2, result.GetProperty("links").GetInt32());

        var overview = await OkAsync(admin.GetAsync("/v1/staff/atlas"));
        var services = overview.GetProperty("services").EnumerateArray().ToList();
        var api = services.Single(s => s.GetProperty("name").GetString() == "API" && s.GetProperty("group").GetString() == "Núcleo");
        Assert.Equal(["Health", "Memória"], api.GetProperty("facts").EnumerateArray().Select(f => f.GetProperty("key").GetString()));
        Assert.Equal("ok", api.GetProperty("condition").GetString());
        var app = services.Single(s => s.GetProperty("name").GetString() == "App da loja");
        Assert.Equal("gap", app.GetProperty("condition").GetString());
        Assert.Equal("T-ABC12", app.GetProperty("task").GetString());
        var connectors = services.Single(s => s.GetProperty("name").GetString() == "Conectores");
        Assert.Equal(2, connectors.GetProperty("items").GetArrayLength());
        var planned = overview.GetProperty("links").EnumerateArray().Single(l => l.GetProperty("to").GetGuid() == app.GetProperty("id").GetGuid());
        Assert.True(planned.GetProperty("planned").GetBoolean());
        Assert.Equal("deploy", planned.GetProperty("kind").GetString());

        var acmeRow = overview.GetProperty("systems").EnumerateArray().Single(s => s.GetProperty("slug").GetString() == acme);
        Assert.Equal(1, acmeRow.GetProperty("attention").GetProperty("gaps").GetInt32());
        Assert.Equal(1, acmeRow.GetProperty("attention").GetProperty("warnings").GetInt32());

        var processes = await OkAsync(admin.GetAsync("/v1/staff/atlas/processes"));
        var funnel = processes.EnumerateArray().Single(p => p.GetProperty("slug").GetString() == $"{acme}-funil");
        Assert.Equal(["oferta", "receita"], funnel.GetProperty("stages").EnumerateArray().Select(s => s.GetProperty("key").GetString()));
        var first = funnel.GetProperty("steps")[0];
        Assert.Equal("acme-oferta", first.GetProperty("slug").GetString());
        Assert.Equal(api.GetProperty("id").GetGuid(), first.GetProperty("services")[0].GetGuid());

        // One system's view keeps the steps of that system only.
        var globexOnly = await OkAsync(admin.GetAsync($"/v1/staff/atlas/processes?system={globex}"));
        Assert.Equal(["globex-oferta"], globexOnly.EnumerateArray().Single().GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("slug").GetString()));

        // What needs a person: high impact first, then medium, then low.
        var attention = await OkAsync(admin.GetAsync($"/v1/staff/atlas/attention"));
        var mine = attention.EnumerateArray().Where(i => i.GetProperty("system").ValueKind == JsonValueKind.Object
            && i.GetProperty("system").GetProperty("slug").GetString() is { } s && (s == acme || s == globex)).ToList();
        Assert.Equal(["App da loja", "Nota fiscal", "Planos"], mine.Select(i => i.GetProperty("title").GetString()));
        Assert.Equal("service", mine[0].GetProperty("source").GetString());
        Assert.Equal("Escrever a oferta.", mine[2].GetProperty("next").GetString());
    }

    [Fact]
    public async Task Sending_the_steps_sends_the_whole_process_and_a_step_can_change_alone()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var slug = $"{acme}-venda";
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/processes", new
        {
            slug, name = "Venda sob medida", system = acme,
            steps = new[] { new { slug = "contato", name = "Contato", status = "gap" }, new { slug = "proposta", name = "Proposta", status = "gap" } },
        }));
        // The step changes alone; the rest of the process stays.
        var step = await OkAsync(mcp.PostAsJsonAsync($"/v1/staff/atlas/processes/{slug}/steps", new { slug = "contato", status = "ok", today = "Formulário vira chamado." }));
        Assert.Equal("ok", step.GetProperty("status").GetString());
        Assert.Equal("Contato", step.GetProperty("name").GetString());

        // Sending the steps again replaces them: the one left out goes away, order follows the list.
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/processes", new
        {
            slug, steps = new[] { new { slug = "contrato", name = "Contrato", status = "next" }, new { slug = "contato", name = "Contato", status = "ok" } },
        }));
        var process = (await OkAsync(mcp.GetAsync("/v1/staff/atlas/processes"))).EnumerateArray().Single(p => p.GetProperty("slug").GetString() == slug);
        Assert.Equal(["contrato", "contato"], process.GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("slug").GetString()));
        Assert.Equal("Formulário vira chamado.", process.GetProperty("steps")[1].GetProperty("today").GetString());
        Assert.Equal("Venda sob medida", process.GetProperty("name").GetString());
    }

    [Fact]
    public async Task What_does_not_fit_is_refused_with_a_message()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));

        Assert.Contains("Condição inválida", await BadAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/services", new { system = acme, name = "X", condition = "broken" })));
        Assert.Contains("Impacto inválido", await BadAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/services", new { system = acme, name = "X", impact = "huge" })));
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/services", new { system = acme, name = "A" }));
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/services", new { system = acme, name = "B" }));
        Assert.Contains("Tipo de ligação inválido", await BadAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/links", new { from = $"{acme}/A", to = $"{acme}/B", kind = "magic" })));

        var slug = $"{acme}-funil";
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/processes", new { slug, name = "Funil", stages = new[] { new { key = "oferta", name = "Oferta" } } }));
        Assert.Contains("Estágio desconhecido", await BadAsync(mcp.PostAsJsonAsync($"/v1/staff/atlas/processes/{slug}/steps", new { slug = "x", name = "X", stage = "venda" })));
        Assert.Contains("Situação inválida", await BadAsync(mcp.PostAsJsonAsync($"/v1/staff/atlas/processes/{slug}/steps", new { slug = "x", name = "X", status = "done" })));
        Assert.Contains("Serviço não encontrado", await BadAsync(mcp.PostAsJsonAsync($"/v1/staff/atlas/processes/{slug}/steps", new { slug = "x", name = "X", services = new[] { $"{acme}/Nada" } })));
        Assert.Equal(HttpStatusCode.NotFound, (await mcp.PostAsJsonAsync("/v1/staff/atlas/processes/nada-aqui/steps", new { slug = "x", name = "X" })).StatusCode);
    }
}
