using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Releases;
using Pitwall.Services.Webhooks;
using Testcontainers.PostgreSql;

namespace Pitwall.Tests;

/// <summary>A fresh Postgres per test class, the real app on top, the model and the network faked.</summary>
public sealed class PitwallFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder("postgres:17-alpine").Build();
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public string ConnectionString => _pg.GetConnectionString();
    public FakeModel Model { get; } = new();
    public CapturingHandler Webhooks { get; } = new();

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
                s.AddSingleton<IReleaseNoteModel>(Model);
                s.AddHttpClient("webhooks").ConfigurePrimaryHttpMessageHandler(() => Webhooks);
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

    /// <summary>A product with a webhook and keys for each scope, straight into the database.</summary>
    public async Task<(Product Product, string SupportKey, string ReleaseKey, string WebhookSecret)> SeedProductAsync(bool autoPublish = true)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        var secrets = scope.ServiceProvider.GetRequiredService<Secrets>();
        var slug = "p" + Guid.NewGuid().ToString("N")[..8];
        var webhookSecret = Tokens.NewWebhookSecret();
        var product = new Product
        {
            Id = Guid.NewGuid(), Slug = slug, Name = "Produto", WebhookUrl = $"https://hooks.test/{slug}",
            WebhookSecretSealed = secrets.Seal(webhookSecret),
            Settings = new ProductSettings { AutoPublishReleases = autoPublish, Locales = ["pt", "en"] },
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        var support = Tokens.NewProductKey(slug);
        var release = Tokens.NewProductKey(slug);
        db.Products.Add(product);
        db.ProductKeys.Add(new ProductKey { Id = Guid.NewGuid(), ProductId = product.Id, Name = "s", Prefix = "s", Hash = Tokens.Hash(support), Scopes = [KeyScopes.Support, KeyScopes.Errors], CreatedAt = DateTime.UtcNow });
        db.ProductKeys.Add(new ProductKey { Id = Guid.NewGuid(), ProductId = product.Id, Name = "r", Prefix = "r", Hash = Tokens.Hash(release), Scopes = [KeyScopes.Releases], CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        return (product, support, release, webhookSecret);
    }

    public HttpClient Client(string key, Actor? actor = null)
    {
        var client = Factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);
        if (actor is not null) client.DefaultRequestHeaders.Add(Actor.Header, Actor.Encode(actor));
        return client;
    }
}

public sealed class FakeModel : IReleaseNoteModel
{
    public string? Reply { get; set; }
    public string? LastUser { get; private set; }
    public Task<string?> CompleteAsync(string system, string user, IReadOnlyDictionary<string, JsonElement> schema, CancellationToken ct)
    {
        LastUser = user;
        return Task.FromResult(Reply);
    }
}

public sealed class CapturingHandler : HttpMessageHandler
{
    public List<(HttpRequestMessage Request, string Body)> Requests { get; } = [];
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Requests.Add((request, await request.Content!.ReadAsStringAsync(ct)));
        return new HttpResponseMessage(HttpStatusCode.OK);
    }
}

public class ReleaseFlowTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private const string Note = """
        {"publish": true,
         "pt": {"title": "Relatórios agendados", "summary": "Agende relatórios.", "new": ["**Agendamento** de relatórios"], "improvements": []},
         "en": {"title": "Scheduled reports", "summary": "Schedule reports.", "new": ["**Scheduling** for reports"], "improvements": []}}
        """;

    [Fact]
    public async Task A_release_publishes_its_note_resolves_its_tickets_and_tells_the_product()
    {
        var (product, supportKey, releaseKey, secret) = await fx.SeedProductAsync();
        var customer = fx.Client(supportKey, new Actor("ws-1", "Acme", "u-1", "Ana", null));
        var created = await (await customer.PostAsJsonAsync("/v1/support/tickets", new { title = "Falha", body = "Erro ao exportar" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var code = created.GetProperty("code").GetString();

        fx.Model.Reply = Note;
        var res = await fx.Client(releaseKey).PostAsJsonAsync("/v1/ingest/releases", new
        {
            version = "0.3.120",
            commits = new[]
            {
                new { sha = "a1b2c3d4e5", subject = "feat(reports): scheduling", body = (string?)null },
                new { sha = "f6e5d4c3b2", subject = $"fix(export): empty sheets ({code})", body = (string?)"Closes the reported bug." },
            },
        });
        var outcome = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("published", outcome.GetProperty("status").GetString());
        Assert.Equal(code, outcome.GetProperty("resolvedTickets")[0].GetString());
        Assert.Contains("feat(reports): scheduling", fx.Model.LastUser);

        // The ticket is resolved, with the version, and the customer sees it.
        var ticket = await customer.GetFromJsonAsync<JsonElement>($"/v1/support/tickets/{created.GetProperty("id").GetString()}");
        Assert.Equal("resolved", ticket.GetProperty("status").GetString());
        Assert.Equal("0.3.120", ticket.GetProperty("fixedIn").GetString());

        // The public changelog has it in both languages.
        var anon = fx.Factory.CreateClient();
        var pt = await anon.GetFromJsonAsync<JsonElement>($"/v1/public/{product.Slug}/releases?locale=pt-BR");
        Assert.Equal("Relatórios agendados", pt.GetProperty("items")[0].GetProperty("title").GetString());
        var en = await anon.GetFromJsonAsync<JsonElement>($"/v1/public/{product.Slug}/releases?locale=en");
        Assert.Equal("Scheduled reports", en.GetProperty("items")[0].GetProperty("title").GetString());

        // Same version again: nothing happens twice.
        var again = await (await fx.Client(releaseKey).PostAsJsonAsync("/v1/ingest/releases", new
        {
            version = "0.3.120", commits = new[] { new { sha = "x", subject = "feat: y", body = (string?)null } },
        })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("exists", again.GetProperty("status").GetString());

        // The outbox holds created, status_changed and release.published; the dispatcher signs and sends them.
        var dispatcher = fx.Factory.Services.GetRequiredService<WebhookDispatcher>();
        await dispatcher.DispatchBatchAsync(CancellationToken.None);
        var mine = fx.Webhooks.Requests.Where(r => r.Request.RequestUri!.AbsolutePath.EndsWith(product.Slug)).ToList();
        var events = mine.Select(r => r.Request.Headers.GetValues("Pitwall-Event").Single()).ToList();
        Assert.Contains(WebhookEvents.TicketCreated, events);
        Assert.Contains(WebhookEvents.TicketStatusChanged, events);
        Assert.Contains(WebhookEvents.ReleasePublished, events);

        var (request, body) = mine.First();
        var header = request.Headers.GetValues("Pitwall-Signature").Single();
        var ts = long.Parse(header.Split(',')[0][2..]);
        Assert.Equal(WebhookSigner.Sign(secret, ts, body), header);
    }

    [Fact]
    public async Task Drafts_wait_for_the_team_and_nothing_noteworthy_stays_silent()
    {
        var (product, _, releaseKey, _) = await fx.SeedProductAsync(autoPublish: false);
        fx.Model.Reply = Note;
        var draft = await (await fx.Client(releaseKey).PostAsJsonAsync("/v1/ingest/releases", new
        {
            version = "1.0.0", commits = new[] { new { sha = "a", subject = "feat: x", body = (string?)null } },
        })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("draft", draft.GetProperty("status").GetString());
        var pub = await fx.Factory.CreateClient().GetFromJsonAsync<JsonElement>($"/v1/public/{product.Slug}/releases");
        Assert.Equal(0, pub.GetProperty("items").GetArrayLength());

        fx.Model.Reply = """{"publish": false, "pt": {"title": "", "summary": "", "new": [], "improvements": []}, "en": {"title": "", "summary": "", "new": [], "improvements": []}}""";
        var silent = await (await fx.Client(releaseKey).PostAsJsonAsync("/v1/ingest/releases", new
        {
            version = "1.0.1", commits = new[] { new { sha = "b", subject = "fix: internal", body = (string?)null } },
        })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("skipped", silent.GetProperty("status").GetString());
    }
}
