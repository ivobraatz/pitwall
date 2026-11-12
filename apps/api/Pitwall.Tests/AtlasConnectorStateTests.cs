using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Atlas;

namespace Pitwall.Tests;

/// <summary>Shared pieces of the connector tests: a provider that answers canned bodies, and the seeds of the Atlas. Every name is made up.</summary>
public static class ConnectorKit
{
    public const string Token = "token-de-teste-somente-leitura";

    public static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..(prefix.Length + 9)];

    /// <summary>Answers by the first rule whose text is in the URL or the body; records every request.</summary>
    public sealed class FakeProvider : HttpMessageHandler
    {
        private readonly List<(string Match, HttpStatusCode Status, string Body)> _rules = [];
        public List<(string Url, string Body, string? Authorization)> Requests { get; } = [];

        public FakeProvider On(string match, string body, HttpStatusCode status = HttpStatusCode.OK)
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

    /// <summary>A product and the production environment (found or made).</summary>
    public static async Task<(Guid ProductId, Guid EnvironmentId)> SeedSystemAsync(PitwallFixture fx)
    {
        var product = new Product { Id = Guid.NewGuid(), Slug = Unique("acme"), Name = "Acme", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
        var environmentId = Guid.Empty;
        await TeamTaskKit.WithDbAsync(fx, async db =>
        {
            db.Products.Add(product);
            var production = await db.AtlasEnvironments.FirstOrDefaultAsync(e => e.Slug == "production")
                ?? db.AtlasEnvironments.Add(new AtlasEnvironment { Id = Guid.NewGuid(), Slug = "production", Name = "Produção", CreatedAt = DateTime.UtcNow }).Entity;
            await db.SaveChangesAsync();
            environmentId = production.Id;
        });
        return (product.Id, environmentId);
    }

    public static async Task<AtlasService> SeedServiceAsync(PitwallFixture fx, Guid productId, Guid? environmentId, string name,
        string? provider = null, string? externalRef = null, string? monitor = null, string? signature = null,
        string kind = AtlasServiceKinds.Other, string? url = null, string origin = AtlasOrigins.Declared)
    {
        var service = new AtlasService
        {
            Id = Guid.NewGuid(), ProductId = productId, EnvironmentId = environmentId, Name = name, Provider = provider,
            ExternalRef = externalRef, MonitorRef = monitor, Signature = signature, Kind = kind, Url = url, Origin = origin,
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow, Key = $"teste:{Guid.NewGuid():N}",
        };
        await TeamTaskKit.WithDbAsync(fx, async db => { db.AtlasServices.Add(service); await db.SaveChangesAsync(); });
        return service;
    }

    public static async Task<T> ReadAsync<T>(PitwallFixture fx, Func<PitwallDb, Task<T>> read)
    {
        using var scope = fx.Factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<PitwallDb>());
    }

    /// <summary>A runner with exactly these collectors, its own status, the app's scope factory.</summary>
    public static AtlasCollectorRunner Runner(PitwallFixture fx, params IAtlasCollector[] collectors) =>
        new(collectors, fx.Factory.Services.GetRequiredService<IServiceScopeFactory>(), new AtlasCollectorStatus(),
            NullLogger<AtlasCollectorRunner>.Instance);
}

/// <summary>
/// The collectors against a faked provider, through the runner: what a failed run leaves alone, what a
/// transition writes once, what a complete listing says is missing and what brings it back.
/// </summary>
public class AtlasConnectorStateTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    /// <summary>A Railway listing: one project with "api" (and "worker" when listed), in production; api's deploy is a success.</summary>
    private static ConnectorKit.FakeProvider RailwayRound(string project, bool withWorker)
    {
        var services = withWorker
            ? "{\"node\":{\"id\":\"s1\",\"name\":\"api\"}},{\"node\":{\"id\":\"s2\",\"name\":\"worker\"}}"
            : "{\"node\":{\"id\":\"s1\",\"name\":\"api\"}}";
        return new ConnectorKit.FakeProvider()
            .On("query { me {", "{\"data\":{\"me\":{\"workspaces\":[]}}}")
            .On("projects", "{\"data\":{\"projects\":{\"edges\":[{\"node\":{\"id\":\"p1\",\"name\":\"" + project + "\"}}]}}}")
            .On("project(id", "{\"data\":{\"project\":{\"services\":{\"edges\":[" + services + "]},\"environments\":{\"edges\":[{\"node\":{\"id\":\"e1\",\"name\":\"production\"}}]}}}}")
            .On("deployments(first", "{\"data\":{"
                + "\"d0\":{\"edges\":[{\"node\":{\"id\":\"d-1\",\"status\":\"SUCCESS\",\"createdAt\":\"2026-11-08T12:00:00.000Z\",\"meta\":{\"commitHash\":\"abc1234\"}}}]},"
                + "\"d1\":{\"edges\":[]}}}");
    }

    private static string Metrics(string monitor, int value) =>
        $"monitor_status{{monitor_name=\"{monitor}\",monitor_type=\"http\",monitor_url=\"https://api.acme.example/health\"}} {value}\n";

    private Task<AtlasSource> SourceAsync(string name) =>
        ConnectorKit.ReadAsync(fx, db => db.AtlasSources.SingleAsync(s => s.Name == name));

    private Task<AtlasService> ServiceAsync(Guid id) =>
        ConnectorKit.ReadAsync(fx, db => db.AtlasServices.SingleAsync(s => s.Id == id));

    [Fact]
    public async Task A_failed_run_keeps_the_last_success_and_its_verification()
    {
        var (productId, environmentId) = await ConnectorKit.SeedSystemAsync(fx);
        var project = ConnectorKit.Unique("acme");
        var api = await ConnectorKit.SeedServiceAsync(fx, productId, environmentId, "API", "railway", $"{project}/api");

        await ConnectorKit.Runner(fx, new RailwayCollector(new HttpClient(RailwayRound(project, withWorker: false)), ConnectorKit.Token))
            .RunAllAsync(CancellationToken.None);
        var before = await SourceAsync("railway");
        var verifiedBefore = await ServiceAsync(api.Id);
        Assert.NotNull(before.LastOkAt);
        Assert.Null(before.LastError);
        Assert.Equal(1, before.ItemsSeen);
        Assert.NotNull(verifiedBefore.VerifiedAt);

        // The provider fails on the first call of the run: nothing of the run is saved.
        var failing = new ConnectorKit.FakeProvider()
            .On("query", "{\"errors\":[{\"message\":\"Service unavailable\"}]}", HttpStatusCode.InternalServerError);
        await ConnectorKit.Runner(fx, new RailwayCollector(new HttpClient(failing), ConnectorKit.Token)).RunAllAsync(CancellationToken.None);

        var failed = await SourceAsync("railway");
        Assert.NotNull(failed.LastError);
        Assert.Contains("500", failed.LastError);
        Assert.True(failed.LastRunAt > before.LastRunAt);
        Assert.Equal(before.LastOkAt, failed.LastOkAt);
        Assert.Equal(before.ItemsSeen, failed.ItemsSeen);

        var kept = await ServiceAsync(api.Id);
        Assert.Equal(verifiedBefore.VerifiedAt, kept.VerifiedAt);
        Assert.Equal("success", kept.DeployStatus);
        Assert.Null(kept.MissingSince);

        // The next run is whole again: the error is cleared and the success moves on.
        await ConnectorKit.Runner(fx, new RailwayCollector(new HttpClient(RailwayRound(project, withWorker: false)), ConnectorKit.Token))
            .RunAllAsync(CancellationToken.None);
        var recovered = await SourceAsync("railway");
        Assert.Null(recovered.LastError);
        Assert.True(recovered.LastOkAt > before.LastOkAt);
    }

    [Fact]
    public async Task A_verified_railway_service_gets_one_deploy_event_across_identical_rounds()
    {
        var (productId, environmentId) = await ConnectorKit.SeedSystemAsync(fx);
        var project = ConnectorKit.Unique("acme");
        var api = await ConnectorKit.SeedServiceAsync(fx, productId, environmentId, "API", "railway", $"{project}/api");

        for (var round = 0; round < 2; round++)
            await ConnectorKit.Runner(fx, new RailwayCollector(new HttpClient(RailwayRound(project, withWorker: false)), ConnectorKit.Token))
                .RunAllAsync(CancellationToken.None);

        var deploys = await ConnectorKit.ReadAsync(fx, db => db.AtlasEvents.Where(e => e.ServiceId == api.Id && e.Type == "deploy.succeeded").ToListAsync());
        var deploy = Assert.Single(deploys);
        Assert.Equal("railway", deploy.Source);
        Assert.Equal("d-1:succeeded", deploy.ExternalId);
        Assert.Equal("abc1234", deploy.CommitSha);

        var verified = await ServiceAsync(api.Id);
        Assert.NotNull(verified.VerifiedAt);
        Assert.Equal("railway", verified.VerifiedBy);

        var evidence = await ConnectorKit.ReadAsync(fx, db => db.AtlasEvidence.Where(e => e.SubjectId == api.Id && e.Source == "collector:railway").ToListAsync());
        var proof = Assert.Single(evidence);
        Assert.Equal($"railway:{project}/api@production", proof.Ref);
        Assert.Equal(AtlasScopes.Runtime, proof.Scope);
        Assert.Equal("api", proof.Method);
        Assert.Null(proof.GoneAt);
    }

    [Fact]
    public async Task A_service_that_leaves_the_listing_is_missing_until_it_comes_back()
    {
        var (productId, environmentId) = await ConnectorKit.SeedSystemAsync(fx);
        var project = ConnectorKit.Unique("acme");
        var api = await ConnectorKit.SeedServiceAsync(fx, productId, environmentId, "API", "railway", $"{project}/api");
        var worker = await ConnectorKit.SeedServiceAsync(fx, productId, environmentId, "Worker", "railway", $"{project}/worker");

        async Task RunAsync(bool withWorker) =>
            await ConnectorKit.Runner(fx, new RailwayCollector(new HttpClient(RailwayRound(project, withWorker)), ConnectorKit.Token))
                .RunAllAsync(CancellationToken.None);

        await RunAsync(withWorker: true);
        Assert.Null((await ServiceAsync(worker.Id)).MissingSince);

        // Gone from the listing: missing, one event, its evidence stops being seen. The api stays.
        await RunAsync(withWorker: false);
        Assert.NotNull((await ServiceAsync(worker.Id)).MissingSince);
        Assert.Null((await ServiceAsync(api.Id)).MissingSince);
        var missing = await ConnectorKit.ReadAsync(fx, db => db.AtlasEvents.Where(e => e.ServiceId == worker.Id && e.Type == "resource.missing").ToListAsync());
        Assert.Single(missing);
        var goneEvidence = await ConnectorKit.ReadAsync(fx, db => db.AtlasEvidence.Where(e => e.SubjectId == worker.Id).ToListAsync());
        Assert.All(goneEvidence, e => Assert.NotNull(e.GoneAt));

        // Still gone the next time: no second event.
        await RunAsync(withWorker: false);
        Assert.Single(await ConnectorKit.ReadAsync(fx, db => db.AtlasEvents.Where(e => e.ServiceId == worker.Id && e.Type == "resource.missing").ToListAsync()));

        // Back in the listing: missing is cleared and one event says so.
        await RunAsync(withWorker: true);
        Assert.Null((await ServiceAsync(worker.Id)).MissingSince);
        var found = await ConnectorKit.ReadAsync(fx, db => db.AtlasEvents.Where(e => e.ServiceId == worker.Id && e.Type == "resource.found").ToListAsync());
        Assert.Single(found);
    }

    [Fact]
    public async Task Kuma_down_then_up_writes_both_events_and_nothing_on_a_repeat()
    {
        var (productId, environmentId) = await ConnectorKit.SeedSystemAsync(fx);
        var monitor = ConnectorKit.Unique("Acme API");
        var site = await ConnectorKit.SeedServiceAsync(fx, productId, environmentId, "Site", monitor: monitor);

        async Task RoundAsync(int value)
        {
            var provider = new ConnectorKit.FakeProvider().On("/metrics", Metrics(monitor, value));
            await ConnectorKit.Runner(fx, new KumaCollector(new HttpClient(provider), "https://status.acme.example", ConnectorKit.Token))
                .RunAllAsync(CancellationToken.None);
        }

        await RoundAsync(0);
        Assert.Equal("down", (await ServiceAsync(site.Id)).MonitorStatus);
        await RoundAsync(1);
        Assert.Equal("up", (await ServiceAsync(site.Id)).MonitorStatus);
        await RoundAsync(1);

        var types = await ConnectorKit.ReadAsync(fx, db => db.AtlasEvents.Where(e => e.ServiceId == site.Id)
            .Select(e => e.Type).ToListAsync());
        Assert.Equal(2, types.Count);
        Assert.Single(types, t => t == "monitor.down");
        Assert.Single(types, t => t == "monitor.up");
        Assert.NotNull((await ServiceAsync(site.Id)).VerifiedAt);
        Assert.Equal("kuma", (await ServiceAsync(site.Id)).VerifiedBy);
    }
}
