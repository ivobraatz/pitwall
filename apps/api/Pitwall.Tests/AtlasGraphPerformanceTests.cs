using System.Diagnostics;
using System.Net;
using Microsoft.EntityFrameworkCore;
using Pitwall.Domain;
using static Pitwall.Tests.GraphKit;

namespace Pitwall.Tests;

/// <summary>A large map: 1000 services and 2000 links, written in batches. The map must answer in time.</summary>
[Collection("atlas-graph")]
public class AtlasGraphPerformanceTests(AtlasGraphFixture fx)
{
    private const int Services = 1000;

    [Fact]
    public async Task A_thousand_services_and_two_thousand_links_answer_in_time()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await SystemAsync(c);

        await DbAsync(fx, async db =>
        {
            var product = await db.Products.SingleAsync(p => p.Slug == sys);
            var now = DateTime.UtcNow;
            var nodes = Enumerable.Range(0, Services).Select(i => new AtlasService
            {
                Id = Guid.NewGuid(), Key = $"{sys}:production:svc-{i:D4}", Engine = AtlasEngines.App, ProductId = product.Id,
                Name = $"Serviço {i:D4}", Kind = AtlasServiceKinds.Other, Origin = AtlasOrigins.Declared, Condition = AtlasConditions.Ok,
                CreatedAt = now, UpdatedAt = now,
            }).ToList();
            db.AtlasServices.AddRange(nodes);
            await db.SaveChangesAsync();

            var links = new List<AtlasLink>();
            for (var i = 0; i < Services; i++)
            {
                for (var k = 1; k <= 2; k++)
                {
                    links.Add(new AtlasLink
                    {
                        Id = Guid.NewGuid(), FromServiceId = nodes[i].Id, ToServiceId = nodes[(i + k) % Services].Id,
                        Relation = k == 1 ? AtlasRelations.DependsOn : "calls", Origin = AtlasOrigins.Declared, CreatedAt = now, UpdatedAt = now,
                    });
                }
            }
            db.AtlasLinks.AddRange(links);
            await db.SaveChangesAsync();
        });

        var first = await DbAsync(fx, db => db.AtlasServices.Where(s => s.Key.StartsWith(sys + ":")).Select(s => s.Id).FirstAsync());

        var watch = Stopwatch.StartNew();
        using var graphResponse = await c.GetAsync($"/v1/staff/atlas/graph?system={sys}");
        watch.Stop();
        Assert.Equal(HttpStatusCode.OK, graphResponse.StatusCode);
        Assert.True(watch.ElapsedMilliseconds < 1500, $"/graph levou {watch.ElapsedMilliseconds} ms");

        // The first call warms the connection and the query plans; the second one is measured.
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync($"/v1/staff/atlas/nodes/{first}")).StatusCode);
        watch.Restart();
        using var detail = await c.GetAsync($"/v1/staff/atlas/nodes/{first}");
        watch.Stop();
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);
        Assert.True(watch.ElapsedMilliseconds < 500, $"/nodes/{{id}} levou {watch.ElapsedMilliseconds} ms");
    }
}
