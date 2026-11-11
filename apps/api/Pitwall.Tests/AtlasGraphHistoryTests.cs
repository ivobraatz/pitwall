using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Atlas.Graph;
using static Pitwall.Tests.GraphKit;

namespace Pitwall.Tests;

/// <summary>
/// The map's memory: snapshots (taken only when the map changed), the diff between two of them, the
/// history of changes, change sets, and the events that were seen. Every name here is made up.
/// </summary>
[Collection("atlas-graph")]
public class AtlasGraphHistoryTests(AtlasGraphFixture fx)
{
    [Fact]
    public async Task The_diff_lists_what_was_added_removed_renamed_and_rewired()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await SystemAsync(c);
        var (api, _) = await ServiceAsync(c, sys, "API");
        var (banco, _) = await ServiceAsync(c, sys, "Banco", kind: "database");
        await LinkAsync(c, api, banco, "reads_from");

        Guid first = Guid.Empty;
        await DbAsync(fx, async db =>
        {
            var snap = await AtlasSnapshots.TakeAsync(db, "teste", CancellationToken.None);
            Assert.NotNull(snap);
            first = snap!.Id;
        });

        await OkAsync(await c.PostAsJsonAsync($"/v1/staff/atlas/services/{api}/rename", new { name = "API v2" }));
        await OkAsync(await c.DeleteAsync($"/v1/staff/atlas/services/{banco}"));
        var (cache, _) = await ServiceAsync(c, sys, "Cache", kind: "cache");
        await LinkAsync(c, api, cache, "reads_from");

        await DbAsync(fx, async db =>
        {
            var second = await AtlasSnapshots.TakeAsync(db, "teste", CancellationToken.None);
            Assert.NotNull(second);
            // Nothing changed since: the same map is not stored twice.
            Assert.Null(await AtlasSnapshots.TakeAsync(db, "teste", CancellationToken.None));
        });

        var diff = await GetAsync(c, $"/v1/staff/atlas/diff?from={first}&to=now&system={sys}");
        Assert.Equal(first, diff.GetProperty("from").GetProperty("snapshotId").GetGuid());
        Assert.Equal(JsonValueKind.Null, diff.GetProperty("to").GetProperty("snapshotId").ValueKind);

        var added = diff.GetProperty("nodes").GetProperty("added").EnumerateArray().Select(n => n.GetProperty("id").GetString()).ToList();
        Assert.Contains(Id(cache), added);
        var removed = diff.GetProperty("nodes").GetProperty("removed").EnumerateArray().Select(n => n.GetProperty("id").GetString()).ToList();
        Assert.Contains(Id(banco), removed);
        var changed = diff.GetProperty("nodes").GetProperty("changed").EnumerateArray().Single(n => n.GetProperty("node").GetProperty("id").GetString() == Id(api));
        var nameField = changed.GetProperty("fields").EnumerateArray().Single(f => f.GetProperty("field").GetString() == "name");
        Assert.Equal("API", nameField.GetProperty("before").GetString());
        Assert.Equal("API v2", nameField.GetProperty("after").GetString());

        var edgesAdded = diff.GetProperty("edges").GetProperty("added").EnumerateArray().ToList();
        Assert.Contains(edgesAdded, e => e.GetProperty("from").GetString() == Id(api) && e.GetProperty("to").GetString() == Id(cache) && e.GetProperty("relation").GetString() == "reads_from");
        var edgesRemoved = diff.GetProperty("edges").GetProperty("removed").EnumerateArray().ToList();
        Assert.Contains(edgesRemoved, e => e.GetProperty("from").GetString() == Id(api) && e.GetProperty("to").GetString() == Id(banco));
    }

    [Fact]
    public async Task Without_an_earlier_snapshot_the_diff_has_no_from_and_no_lists()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await SystemAsync(c);
        await ServiceAsync(c, sys, "API");

        var diff = await GetAsync(c, $"/v1/staff/atlas/diff?from=2000-01-01T00:00:00Z&to=now&system={sys}");
        Assert.Equal(JsonValueKind.Null, diff.GetProperty("from").GetProperty("at").ValueKind);
        Assert.Empty(diff.GetProperty("nodes").GetProperty("added").EnumerateArray());
        Assert.Empty(diff.GetProperty("edges").GetProperty("added").EnumerateArray());
    }

    [Fact]
    public async Task Snapshots_are_listed_and_changes_come_newest_first()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await SystemAsync(c);
        var (api, _) = await ServiceAsync(c, sys, "API");
        await OkAsync(await c.PostAsJsonAsync($"/v1/staff/atlas/services/{api}/rename", new { name = "API nova" }));
        await DbAsync(fx, db => AtlasSnapshots.TakeAsync(db, "teste", CancellationToken.None));

        var snapshots = await GetAsync(c, "/v1/staff/atlas/snapshots?limit=5");
        Assert.True(snapshots.GetArrayLength() >= 1);
        GraphKit.HasProperties(snapshots[0], "id", "takenAt", "reason", "nodeCount", "edgeCount");

        var changes = (await GetAsync(c, $"/v1/staff/atlas/changes?system={sys}")).EnumerateArray().ToList();
        Assert.True(changes.Count >= 2);
        var times = changes.Select(ch => ch.GetProperty("at").GetDateTime()).ToList();
        Assert.Equal(times.OrderByDescending(t => t).ToList(), times);
        GraphKit.HasProperties(changes[0], "id", "at", "actor", "source", "changeSetId", "entityType", "entityId", "productId", "op", "fields", "summary");
        Assert.Contains(changes, ch => ch.GetProperty("op").GetString() == "renamed" && ch.GetProperty("entityId").GetGuid() == api);

        var future = await GetAsync(c, $"/v1/staff/atlas/changes?system={sys}&since={DateTime.UtcNow.AddDays(1):O}");
        Assert.Empty(future.EnumerateArray());
    }

    [Fact]
    public async Task Change_sets_keep_the_answer_they_got()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var repo = $"acme-{Guid.NewGuid():N}"[..20] + "/app";
        await DbAsync(fx, async db =>
        {
            db.AtlasChangeSets.Add(new AtlasChangeSet
            {
                Id = Guid.NewGuid(), IdempotencyKey = Guid.NewGuid().ToString("N"), Source = "ci", Tool = "github-actions",
                Repo = repo, Branch = "main", CommitSha = "abc1234", Scope = AtlasScopes.Pushed, Actor = "Acme CI",
                Summary = "Sincronização de teste", TaskCodes = ["T-ABCDE"], Status = "partial", ReceivedAt = DateTime.UtcNow,
                Result = """{"created":["API"],"updated":[],"unchanged":2,"gone":[],"removalsReported":[],"rejected":[{"op":"node","message":"campo inválido"}],"attention":[]}""",
            });
            await db.SaveChangesAsync();
        });

        var rows = (await GetAsync(c, $"/v1/staff/atlas/changesets?repo={repo}")).EnumerateArray().ToList();
        var row = Assert.Single(rows);
        Assert.Equal("partial", row.GetProperty("status").GetString());
        Assert.Equal("T-ABCDE", row.GetProperty("taskCodes")[0].GetString());
        var result = row.GetProperty("result");
        Assert.Equal(2, result.GetProperty("unchanged").GetInt32());
        Assert.Equal("API", result.GetProperty("created")[0].GetString());
        Assert.Equal("campo inválido", result.GetProperty("rejected")[0].GetProperty("message").GetString());
    }

    [Fact]
    public async Task Events_of_a_node_come_newest_first_and_the_detail_shows_them()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await SystemAsync(c);
        var (api, _) = await ServiceAsync(c, sys, "API");
        var now = DateTime.UtcNow;
        await DbAsync(fx, async db =>
        {
            var productId = await db.Products.Where(p => p.Slug == sys).Select(p => p.Id).SingleAsync();
            db.AtlasEvents.Add(new AtlasEvent { Id = Guid.NewGuid(), At = now.AddMinutes(-10), Source = "railway", Type = "deploy.failed", ProductId = productId, ServiceId = api, Status = "failed", Title = "Deploy falhou", ExternalId = "deploy-1" });
            db.AtlasEvents.Add(new AtlasEvent { Id = Guid.NewGuid(), At = now, Source = "railway", Type = "deploy.succeeded", ProductId = productId, ServiceId = api, Status = "succeeded", Title = "Deploy ok", ExternalId = "deploy-2" });
            await db.SaveChangesAsync();
        });

        var events = (await GetAsync(c, $"/v1/staff/atlas/events?serviceId={api}")).EnumerateArray().ToList();
        Assert.Equal("deploy.succeeded", events[0].GetProperty("type").GetString());
        Assert.Equal("deploy.failed", events[1].GetProperty("type").GetString());

        var detail = await GetAsync(c, $"/v1/staff/atlas/nodes/{api}");
        Assert.Equal(2, detail.GetProperty("events").GetArrayLength());
        var last = NodeNamed(await GetAsync(c, $"/v1/staff/atlas/graph?system={sys}"), "API").GetProperty("lastEvent");
        Assert.Equal("deploy.succeeded", last.GetProperty("type").GetString());
    }

    private static string Id(Guid id) => id.ToString();
}
