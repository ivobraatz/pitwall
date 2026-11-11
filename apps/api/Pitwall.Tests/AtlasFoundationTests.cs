using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Atlas;
using static Pitwall.Tests.TeamTaskKit;

namespace Pitwall.Tests;

/// <summary>
/// The Atlas foundation: keys that outlive a rename, aliases, retirement instead of deletion, the
/// relation of a link, references to tasks, the history of changes, concurrency, and the shared
/// evidence and event rules. Every name here is made up (Acme, Globex, Initech).
/// </summary>
public class AtlasFoundationTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private static string Slug(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..(prefix.Length + 9)];

    private async Task<HttpClient> AtlasTokenAsync()
    {
        var staff = await SeedStaffAsync(fx, "Bia");
        var (token, _) = await SeedTokenAsync(fx, staff.Id, [StaffTokenScopes.Atlas]);
        return TokenClient(fx, token);
    }

    private static async Task<JsonElement> OkAsync(Task<HttpResponseMessage> call)
    {
        var res = await call;
        var body = await res.Content.ReadAsStringAsync();
        Assert.True(res.IsSuccessStatusCode, $"{(int)res.StatusCode}: {body}");
        return body.Length == 0 ? default : JsonSerializer.Deserialize<JsonElement>(body);
    }

    private static JsonElement? Node(JsonElement overview, Guid id) =>
        overview.GetProperty("services").EnumerateArray().Where(s => s.GetProperty("id").GetGuid() == id).Select(s => (JsonElement?)s).FirstOrDefault();

    private async Task<Guid> ServiceAsync(HttpClient mcp, string system, string name, object? extra = null, string environment = "production")
    {
        var body = new Dictionary<string, object?> { ["system"] = system, ["environment"] = environment, ["name"] = name, ["kind"] = "api" };
        if (extra is not null)
            foreach (var p in JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(extra))!)
                body[p.Key] = p.Value;
        return (await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/services", body))).GetProperty("id").GetGuid();
    }

    private static async Task<T> InDbAsync<T>(PitwallFixture f, Func<PitwallDb, Task<T>> act)
    {
        using var scope = f.Factory.Services.CreateScope();
        return await act(scope.ServiceProvider.GetRequiredService<PitwallDb>());
    }

    [Fact]
    public async Task The_key_is_generated_and_stays_when_the_service_is_renamed()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var created = await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/services", new { system = acme, environment = "production", name = "API", kind = "api" }));
        var id = created.GetProperty("id").GetGuid();
        Assert.Equal($"{acme}:production:api", created.GetProperty("key").GetString());
        Assert.Equal("app", created.GetProperty("engine").GetString());

        var renamed = await OkAsync(mcp.PostAsJsonAsync($"/v1/staff/atlas/services/{id}/rename", new { name = "API v2" }));
        Assert.Equal($"{acme}:production:api", renamed.GetProperty("key").GetString());

        var node = Node(await OkAsync(mcp.GetAsync("/v1/staff/atlas")), id)!.Value;
        Assert.Equal($"{acme}:production:api", node.GetProperty("key").GetString());
        Assert.Equal("API v2", node.GetProperty("name").GetString());
        Assert.Contains("API", node.GetProperty("aliases").EnumerateArray().Select(a => a.GetString()));
    }

    [Fact]
    public async Task An_alias_finds_the_renamed_service_when_linking()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var api = await ServiceAsync(mcp, acme, "API");
        await ServiceAsync(mcp, acme, "Banco", new { kind = "database" });
        await OkAsync(mcp.PostAsJsonAsync($"/v1/staff/atlas/services/{api}/rename", new { name = "API v2" }));

        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/links", new { from = $"{acme}/production/API", to = $"{acme}/production/Banco" }));
        var links = (await OkAsync(mcp.GetAsync("/v1/staff/atlas"))).GetProperty("links").EnumerateArray();
        Assert.Contains(links, l => l.GetProperty("from").GetGuid() == api);
    }

    [Fact]
    public async Task Renaming_to_a_name_in_use_is_a_conflict()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        await ServiceAsync(mcp, acme, "API");
        var banco = await ServiceAsync(mcp, acme, "Banco");

        var res = await mcp.PostAsJsonAsync($"/v1/staff/atlas/services/{banco}/rename", new { name = "api" });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace((await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString()));
    }

    [Fact]
    public async Task Retiring_takes_a_service_off_the_map_and_restoring_brings_it_back_with_its_links()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var api = await ServiceAsync(mcp, acme, "API");
        var banco = await ServiceAsync(mcp, acme, "Banco", new { kind = "database" });
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/links", new { from = api, to = banco, kind = "host" }));

        Assert.Equal(HttpStatusCode.NoContent, (await mcp.DeleteAsync($"/v1/staff/atlas/services/{api}")).StatusCode);
        var gone = await OkAsync(mcp.GetAsync("/v1/staff/atlas"));
        Assert.Null(Node(gone, api));
        Assert.DoesNotContain(gone.GetProperty("links").EnumerateArray(), l => l.GetProperty("from").GetGuid() == api);

        // It is still in the database, retired, with the same instant on its link.
        var retiredAt = await InDbAsync(fx, db => db.AtlasServices.Where(s => s.Id == api).Select(s => s.RetiredAt).SingleAsync());
        Assert.NotNull(retiredAt);
        Assert.NotNull(await InDbAsync(fx, db => db.AtlasChanges.Where(c => c.EntityId == api && c.Op == "retired").SingleOrDefaultAsync()));

        await OkAsync(mcp.PostAsync($"/v1/staff/atlas/services/{api}/restore", null));
        var back = await OkAsync(mcp.GetAsync("/v1/staff/atlas"));
        Assert.NotNull(Node(back, api));
        Assert.Contains(back.GetProperty("links").EnumerateArray(), l => l.GetProperty("from").GetGuid() == api && l.GetProperty("to").GetGuid() == banco);
    }

    [Fact]
    public async Task Two_relations_between_the_same_pair_are_two_links_and_the_old_kind_updates_the_only_one()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var api = await ServiceAsync(mcp, acme, "API");
        var ia = await ServiceAsync(mcp, acme, "IA", new { kind = "integration" });

        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/links", new { from = api, to = ia, relation = "depends_on" }));
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/links", new { from = api, to = ia, relation = "calls" }));
        var pair = (await OkAsync(mcp.GetAsync("/v1/staff/atlas"))).GetProperty("links").EnumerateArray()
            .Where(l => l.GetProperty("from").GetGuid() == api && l.GetProperty("to").GetGuid() == ia)
            .Select(l => l.GetProperty("relation").GetString()).Order().ToList();
        Assert.Equal(["calls", "depends_on"], pair);

        // An old client sends only a kind between a different pair: one link, updated by a second call.
        var banco = await ServiceAsync(mcp, acme, "Banco", new { kind = "database" });
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/links", new { from = api, to = banco, kind = "host" }));
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/links", new { from = api, to = banco, kind = "host", label = "principal" }));
        var single = (await OkAsync(mcp.GetAsync("/v1/staff/atlas"))).GetProperty("links").EnumerateArray()
            .Where(l => l.GetProperty("from").GetGuid() == api && l.GetProperty("to").GetGuid() == banco).ToList();
        Assert.Single(single);
        Assert.Equal("principal", single[0].GetProperty("label").GetString());
        Assert.Equal("hosted_on", single[0].GetProperty("relation").GetString());
    }

    [Fact]
    public async Task A_task_code_becomes_a_reference_and_references_can_be_added_and_removed()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var api = await ServiceAsync(mcp, acme, "API", new { task = "T-AB123" });

        var taskRefs = await InDbAsync(fx, db => db.AtlasRefs.Where(r => r.ServiceId == api && r.Kind == "task").Select(r => r.Code).ToListAsync());
        Assert.Equal(["T-AB123"], taskRefs);

        var added = await OkAsync(mcp.PostAsJsonAsync($"/v1/staff/atlas/services/{api}/refs", new { kind = "ticket", code = "chamado-7", note = "erro no login" }));
        Assert.Equal("CHAMADO-7", added.GetProperty("code").GetString());
        var refId = added.GetProperty("id").GetGuid();
        Assert.Equal(1, await InDbAsync(fx, db => db.AtlasRefs.CountAsync(r => r.Id == refId && r.Kind == "ticket")));

        Assert.Equal(HttpStatusCode.NoContent, (await mcp.DeleteAsync($"/v1/staff/atlas/refs/{refId}")).StatusCode);
        Assert.Equal(0, await InDbAsync(fx, db => db.AtlasRefs.CountAsync(r => r.Id == refId)));
    }

    [Fact]
    public async Task The_history_names_the_actor_and_the_source_of_each_change()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var api = await ServiceAsync(mcp, acme, "API");
        await OkAsync(mcp.PostAsJsonAsync($"/v1/staff/atlas/services/{api}/rename", new { name = "API v2" }));
        await mcp.DeleteAsync($"/v1/staff/atlas/services/{api}");
        await OkAsync(mcp.PostAsync($"/v1/staff/atlas/services/{api}/restore", null));

        // The console acts too: a person signed in, not a token.
        var (session, _) = await SignInAsync(fx, "Ana");
        await OkAsync(session.PostAsJsonAsync($"/v1/staff/atlas/services/{api}/rename", new { name = "API v3" }));

        var changes = await InDbAsync(fx, db => db.AtlasChanges.Where(c => c.EntityId == api).OrderBy(c => c.At)
            .Select(c => new { c.Op, c.Actor, c.Source }).ToListAsync());
        Assert.Equal(["created", "renamed", "retired", "restored", "renamed"], changes.Select(c => c.Op));
        Assert.Equal(["Bia (Claude)", "Bia (Claude)", "Bia (Claude)", "Bia (Claude)", "Ana"], changes.Select(c => c.Actor));
        Assert.Equal(["mcp", "mcp", "mcp", "mcp", "console"], changes.Select(c => c.Source));
    }

    [Fact]
    public async Task A_change_made_only_of_observations_writes_no_history()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var api = await ServiceAsync(mcp, acme, "API");
        var before = await InDbAsync(fx, db => db.AtlasChanges.CountAsync(c => c.EntityId == api));

        await WithDbAsync(fx, async db =>
        {
            var service = await db.AtlasServices.SingleAsync(s => s.Id == api);
            service.DeployStatus = "success";
            service.MonitorStatus = "up";
            service.CheckedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });
        Assert.Equal(before, await InDbAsync(fx, db => db.AtlasChanges.CountAsync(c => c.EntityId == api)));
    }

    [Fact]
    public async Task Two_saves_from_stale_copies_conflict_instead_of_overwriting()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var api = await ServiceAsync(mcp, acme, "API");

        using var first = fx.Factory.Services.CreateScope();
        using var second = fx.Factory.Services.CreateScope();
        var db1 = first.ServiceProvider.GetRequiredService<PitwallDb>();
        var db2 = second.ServiceProvider.GetRequiredService<PitwallDb>();
        var a = await db1.AtlasServices.SingleAsync(s => s.Id == api);
        var b = await db2.AtlasServices.SingleAsync(s => s.Id == api);

        a.Notes = "primeiro";
        await db1.SaveChangesAsync();
        b.Notes = "segundo";
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => db2.SaveChangesAsync());
    }

    [Fact]
    public async Task Evidence_upserts_once_and_only_its_own_source_goes_missing()
    {
        var mcp = await AtlasTokenAsync();
        var acme = Slug("acme");
        await OkAsync(mcp.PostAsJsonAsync("/v1/staff/atlas/systems", new { slug = acme, name = "Acme" }));
        var api = await ServiceAsync(mcp, acme, "API");
        var repo = $"repo:acme-inc/{acme}";
        var railway = "collector:railway";

        await WithDbAsync(fx, async db =>
        {
            var now = DateTime.UtcNow;
            await AtlasEvidenceWriter.UpsertAsync(db, "service", api, repo, "manifest", "package.json#dependencies.stripe", "local", now);
            await AtlasEvidenceWriter.UpsertAsync(db, "service", api, railway, "api", "railway:acme/api", "runtime", now);
            await db.SaveChangesAsync();
        });
        await WithDbAsync(fx, async db =>
        {
            var again = await AtlasEvidenceWriter.UpsertAsync(db, "service", api, repo, "manifest", "package.json#dependencies.stripe", "pushed", DateTime.UtcNow);
            Assert.Equal("pushed", again.Scope);
            await db.SaveChangesAsync();
        });
        Assert.Equal(1, await InDbAsync(fx, db => db.AtlasEvidence.CountAsync(e => e.SubjectId == api && e.Source == repo)));

        await WithDbAsync(fx, async db =>
        {
            // The repository no longer shows the dependency; nothing else of the collector is touched.
            var gone = await AtlasEvidenceWriter.MarkGoneAsync(db, repo, [], DateTime.UtcNow);
            Assert.Equal(1, gone);
            await db.SaveChangesAsync();
        });
        var goneBy = await InDbAsync(fx, db => db.AtlasEvidence.Where(e => e.SubjectId == api).ToListAsync());
        Assert.NotNull(goneBy.Single(e => e.Source == repo).GoneAt);
        Assert.Null(goneBy.Single(e => e.Source == railway).GoneAt);
    }

    [Fact]
    public async Task An_event_with_the_same_source_and_external_id_is_written_once()
    {
        var first = await InDbAsync(fx, async db =>
        {
            var added = await AtlasEvents.RecordAsync(db, NewEvent("dep-1"));
            await db.SaveChangesAsync();
            return added;
        });
        var second = await InDbAsync(fx, async db =>
        {
            var added = await AtlasEvents.RecordAsync(db, NewEvent("dep-1"));
            await db.SaveChangesAsync();
            return added;
        });
        Assert.True(first);
        Assert.False(second);
        Assert.Equal(1, await InDbAsync(fx, db => db.AtlasEvents.CountAsync(e => e.Source == "railway" && e.ExternalId == "dep-1")));
    }

    private static AtlasEvent NewEvent(string externalId) => new()
    {
        Id = Guid.NewGuid(), At = DateTime.UtcNow, Source = "railway", Type = "deploy.succeeded", Status = "succeeded",
        Title = "Deploy da API", ExternalId = externalId,
    };

}
