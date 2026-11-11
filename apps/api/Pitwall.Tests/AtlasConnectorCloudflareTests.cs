using Microsoft.EntityFrameworkCore;
using Pitwall.Domain;
using Pitwall.Services.Atlas;

namespace Pitwall.Tests;

/// <summary>
/// The Cloudflare collector on a faked account (names made up: acme.example, acme-worker). Registered
/// resources match by reference, discovered nodes adopt the reference, domains follow their zone, and
/// what is not registered becomes a discovery.
/// </summary>
public class AtlasConnectorCloudflareTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private const string Account = "acc-acme-test";

    private static ConnectorKit.FakeProvider Listings() => new ConnectorKit.FakeProvider()
        .On("/zones?", """{"success":true,"result":[{"id":"z1","name":"acme.example"}],"result_info":{"page":1,"total_pages":1}}""")
        .On("/dns_records", """{"success":true,"result":[{"name":"api.acme.example","type":"A"},{"name":"www.acme.example","type":"CNAME"}],"result_info":{"page":1,"total_pages":1}}""")
        .On("/workers/scripts", """{"success":true,"result":[{"id":"acme-worker"},{"id":"globex-worker"},{"id":"acme-api"},{"id":"unknown-worker"}]}""")
        .On("/pages/projects", """{"success":true,"result":[{"name":"acme-site"}]}""")
        .On("/r2/buckets", """{"success":true,"result":{"buckets":[{"name":"acme-assets"}]}}""");

    [Fact]
    public void Cloudflare_needs_its_token_and_the_account()
    {
        var http = new HttpClient(new ConnectorKit.FakeProvider());
        Assert.False(new CloudflareCollector(http, null, Account).Configured);
        Assert.False(new CloudflareCollector(http, ConnectorKit.Token, " ").Configured);
        Assert.True(new CloudflareCollector(http, ConnectorKit.Token, Account).Configured);
    }

    [Fact]
    public async Task Registered_resources_match_by_reference_and_the_rest_is_discovered()
    {
        var (productId, environmentId) = await ConnectorKit.SeedSystemAsync(fx);
        var zone = await ConnectorKit.SeedServiceAsync(fx, productId, null, "Zona acme", "cloudflare", "zone:acme.example");
        var dns = await ConnectorKit.SeedServiceAsync(fx, productId, null, "API DNS", "cloudflare", "dns:api.acme.example");
        var worker = await ConnectorKit.SeedServiceAsync(fx, productId, environmentId, "Worker acme", "cloudflare", "worker:acme-worker");
        var pages = await ConnectorKit.SeedServiceAsync(fx, productId, environmentId, "Site", "cloudflare", "pages:acme-site");
        var bucket = await ConnectorKit.SeedServiceAsync(fx, productId, null, "Assets", "cloudflare", "r2:acme-assets");
        var oldPages = await ConnectorKit.SeedServiceAsync(fx, productId, environmentId, "Site antigo", "cloudflare", "pages:old-site");

        // Discovered nodes from a manifest, with the names the resource carries: they take the reference.
        var globex = await ConnectorKit.SeedServiceAsync(fx, productId, null, "globex-worker", signature: "cloudflare-worker", origin: AtlasOrigins.Discovered);
        var acmeApi = await ConnectorKit.SeedServiceAsync(fx, productId, null, "Worker acme-api", signature: "cloudflare-worker", origin: AtlasOrigins.Discovered);

        // A domain has no provider of its own: the host decides which zone verifies it.
        var domain = await ConnectorKit.SeedServiceAsync(fx, productId, null, "Site público", kind: "domain", url: "https://www.acme.example/pricing");
        var outside = await ConnectorKit.SeedServiceAsync(fx, productId, null, "Status", kind: "domain", url: "https://status.globex.example");

        var provider = Listings();
        await ConnectorKit.Runner(fx, new CloudflareCollector(new HttpClient(provider), ConnectorKit.Token, Account))
            .RunAllAsync(CancellationToken.None);

        async Task<AtlasService> Row(Guid id) => await ConnectorKit.ReadAsync(fx, db => db.AtlasServices.SingleAsync(s => s.Id == id));

        foreach (var verified in new[] { zone, dns, worker, pages, bucket })
        {
            var row = await Row(verified.Id);
            Assert.NotNull(row.VerifiedAt);
            Assert.Equal("cloudflare", row.VerifiedBy);
            Assert.Null(row.MissingSince);
        }

        var adopted = await Row(globex.Id);
        Assert.Equal("worker:globex-worker", adopted.ExternalRef);
        Assert.Equal("cloudflare", adopted.Provider);
        Assert.NotNull(adopted.VerifiedAt);
        Assert.Equal("worker:acme-api", (await Row(acmeApi.Id)).ExternalRef);

        var inZone = await Row(domain.Id);
        Assert.NotNull(inZone.VerifiedAt);
        Assert.Equal("cloudflare", inZone.VerifiedBy);
        Assert.Null((await Row(outside.Id)).VerifiedAt);

        // Registered and no longer listed: missing, with the event.
        Assert.NotNull((await Row(oldPages.Id)).MissingSince);
        Assert.Single(await ConnectorKit.ReadAsync(fx, db => db.AtlasEvents.Where(e => e.ServiceId == oldPages.Id && e.Type == "resource.missing").ToListAsync()));

        // Evidence says where the proof is.
        var proof = await ConnectorKit.ReadAsync(fx, db => db.AtlasEvidence.SingleAsync(e => e.SubjectId == worker.Id && e.Source == "collector:cloudflare"));
        Assert.Equal("cloudflare:worker:acme-worker", proof.Ref);
        Assert.Equal(AtlasScopes.Runtime, proof.Scope);

        // Unregistered workers are discovered; DNS names are not (there are too many).
        var found = await ConnectorKit.ReadAsync(fx, db => db.AtlasDiscoveries.Where(d => d.Source == "cloudflare").Select(d => d.ExternalRef).ToListAsync());
        Assert.Contains("worker:unknown-worker", found);
        Assert.DoesNotContain("worker:globex-worker", found);
        Assert.DoesNotContain("worker:acme-worker", found);
        Assert.DoesNotContain(found, r => r.StartsWith("dns:", StringComparison.Ordinal));

        Assert.All(provider.Requests, r =>
        {
            Assert.Equal($"Bearer {ConnectorKit.Token}", r.Authorization);
            Assert.StartsWith("https://api.cloudflare.com/client/v4/", r.Url);
            Assert.DoesNotContain(ConnectorKit.Token, r.Url + r.Body);
        });
    }
}
