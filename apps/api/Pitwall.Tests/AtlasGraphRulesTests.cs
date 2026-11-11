using System.Net.Http.Json;
using System.Text.Json;
using Pitwall.Domain;
using static Pitwall.Tests.GraphKit;

namespace Pitwall.Tests;

/// <summary>
/// The rules the map reads: what depends on what (impact), what needs attention and what does not
/// (no false alarms), what is missing (insights), and how sure the map is of each node (verification).
/// </summary>
[Collection("atlas-graph")]
public class AtlasGraphRulesTests(AtlasGraphFixture fx)
{
    private static string Id(Guid id) => id.ToString();

    [Fact]
    public async Task A_failure_upstream_reaches_its_direct_and_indirect_dependents_and_their_systems()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var acme = await SystemAsync(c);
        var globex = await SystemAsync(c);
        var (dns, _) = await ServiceAsync(c, null, "DNS " + acme, environment: null, kind: "dns");
        var (api, _) = await ServiceAsync(c, acme, "API");
        var (worker, _) = await ServiceAsync(c, acme, "Worker", kind: "worker");
        var (site, _) = await ServiceAsync(c, globex, "Site", kind: "site");
        var (sentry, _) = await ServiceAsync(c, null, "Sentry " + acme, environment: null, kind: "monitor");
        await LinkAsync(c, api, dns, "resolves_dns");
        await LinkAsync(c, worker, api, "calls");
        await LinkAsync(c, site, api, "depends_on");
        await LinkAsync(c, api, sentry, "monitored_by");

        var impact = (await GetAsync(c, $"/v1/staff/atlas/nodes/{dns}")).GetProperty("impact");
        var direct = impact.GetProperty("direct").EnumerateArray().Select(n => n.GetProperty("id").GetString()).ToList();
        var indirect = impact.GetProperty("indirect").EnumerateArray().Select(n => n.GetProperty("id").GetString()).ToList();
        Assert.Equal(new[] { Id(api) }, direct);
        Assert.Contains(Id(worker), indirect);
        Assert.Contains(Id(site), indirect);
        var systems = impact.GetProperty("systems").EnumerateArray().Select(s => s.GetProperty("slug").GetString()).ToList();
        Assert.Contains(acme, systems);
        Assert.Contains(globex, systems);

        // Monitoring does not propagate: nothing depends on the monitor through an operational edge.
        var monitorImpact = (await GetAsync(c, $"/v1/staff/atlas/nodes/{sentry}")).GetProperty("impact");
        Assert.Empty(monitorImpact.GetProperty("direct").EnumerateArray());
        Assert.Empty(monitorImpact.GetProperty("indirect").EnumerateArray());
    }

    [Fact]
    public async Task A_cycle_in_the_dependencies_ends_instead_of_looping()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await SystemAsync(c);
        var (a, _) = await ServiceAsync(c, sys, "A");
        var (b, _) = await ServiceAsync(c, sys, "B");
        var (x, _) = await ServiceAsync(c, sys, "C");
        await LinkAsync(c, b, a, "depends_on");
        await LinkAsync(c, a, b, "depends_on");
        await LinkAsync(c, x, a, "calls");

        var impact = (await GetAsync(c, $"/v1/staff/atlas/nodes/{a}")).GetProperty("impact");
        var direct = impact.GetProperty("direct").EnumerateArray().Select(n => n.GetProperty("id").GetString()).ToList();
        Assert.Contains(Id(b), direct);
        Assert.Contains(Id(x), direct);
        Assert.DoesNotContain(Id(a), direct);
        Assert.Empty(impact.GetProperty("indirect").EnumerateArray());
    }

    [Fact]
    public async Task The_impact_walk_stops_after_six_steps()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await SystemAsync(c);
        var chain = new List<Guid>();
        for (var i = 0; i < 8; i++) chain.Add((await ServiceAsync(c, sys, $"Elo {i}")).Id);
        for (var i = 1; i < chain.Count; i++) await LinkAsync(c, chain[i], chain[i - 1], "depends_on");

        var impact = (await GetAsync(c, $"/v1/staff/atlas/nodes/{chain[0]}")).GetProperty("impact");
        var reached = impact.GetProperty("direct").EnumerateArray().Concat(impact.GetProperty("indirect").EnumerateArray())
            .Select(n => n.GetProperty("id").GetString()).ToHashSet();
        Assert.Equal(6, reached.Count);
        Assert.Contains(Id(chain[6]), reached);
        Assert.DoesNotContain(Id(chain[7]), reached);
    }

    [Fact]
    public async Task A_task_in_the_normal_course_counts_as_task_not_as_failure()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await SystemAsync(c);
        var (plain, _) = await ServiceAsync(c, sys, "Plain");
        var (down, _) = await ServiceAsync(c, sys, "Down");
        var (seg, _) = await ServiceAsync(c, sys, "Segurança");
        var (mel, _) = await ServiceAsync(c, sys, "Melhoria");
        var (blocked, _) = await ServiceAsync(c, sys, "Bloqueado");
        var (gap, _) = await ServiceAsync(c, sys, "Falta", extra: new { condition = "gap" });
        var (done, _) = await ServiceAsync(c, sys, "Pronto");
        var (archived, archivedKey) = await ServiceAsync(c, sys, "Arquivado");
        await ServiceAsync(c, sys, "Planejado", extra: new { condition = "planned" });
        var (labelled, labelledKey) = await ServiceAsync(c, sys, "Ligado por etiqueta");

        await DbAsync(fx, async db =>
        {
            var now = DateTime.UtcNow;
            db.AtlasServices.Single(s => s.Id == down).MonitorStatus = "down";
            var todo = NewTask("todo", [], now);
            var segTask = NewTask("todo", ["segurança"], now);
            var melTask = NewTask("todo", ["melhoria"], now);
            var blockedTask = NewTask("blocked", [], now);
            var doneTask = NewTask("done", [], now);
            var archivedTask = NewTask("todo", ["atlas:" + archivedKey], now, archived: true);
            var labelTask = NewTask("todo", ["atlas:" + labelledKey], now);
            db.TeamTasks.AddRange(todo, segTask, melTask, blockedTask, doneTask, archivedTask, labelTask);
            db.AtlasRefs.Add(Ref(plain, todo.Code, now));
            db.AtlasRefs.Add(Ref(mel, melTask.Code, now));
            db.AtlasRefs.Add(Ref(blocked, blockedTask.Code, now));
            db.AtlasRefs.Add(Ref(done, doneTask.Code, now));
            db.AtlasRefs.Add(Ref(seg, segTask.Code, now));
            await db.SaveChangesAsync();
        });

        var graph = await GetAsync(c, $"/v1/staff/atlas/graph?system={sys}");
        AssertAttention(NodeNamed(graph, "Plain"), task: 1);
        AssertAttention(NodeNamed(graph, "Down"), failure: 1);
        AssertAttention(NodeNamed(graph, "Segurança"), security: 1);
        AssertAttention(NodeNamed(graph, "Melhoria"), improvement: 1);
        AssertAttention(NodeNamed(graph, "Bloqueado"), config: 1);
        AssertAttention(NodeNamed(graph, "Falta"), config: 1);
        AssertAttention(NodeNamed(graph, "Pronto"));
        AssertAttention(NodeNamed(graph, "Arquivado"));
        AssertAttention(NodeNamed(graph, "Planejado"), improvement: 1);
        AssertAttention(NodeNamed(graph, "Ligado por etiqueta"), task: 1);
        Assert.Equal("label", (await GetAsync(c, $"/v1/staff/atlas/nodes/{labelled}")).GetProperty("refs")[0].GetProperty("via").GetString());
        Assert.Equal(JsonValueKind.Object, NodeNamed(graph, "Plain").GetProperty("activity").ValueKind);
    }

    [Fact]
    public async Task A_service_without_monitoring_gets_an_insight_and_still_reads_unknown()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await SystemAsync(c);
        var (api, _) = await ServiceAsync(c, sys, "API sem monitor");
        var (watched, _) = await ServiceAsync(c, sys, "API com monitor", extra: new { monitor = "api-com-monitor" });
        var (db, _) = await ServiceAsync(c, sys, "Dados", kind: "database");

        var insights = (await GetAsync(c, $"/v1/staff/atlas/insights?system={sys}")).EnumerateArray().ToList();
        var noMonitoring = insights.Where(i => i.GetProperty("rule").GetString() == "no-monitoring").ToList();
        Assert.Contains(noMonitoring, i => i.GetProperty("nodeIds")[0].GetString() == Id(api));
        Assert.DoesNotContain(noMonitoring, i => i.GetProperty("nodeIds")[0].GetString() == Id(watched));
        Assert.Contains(insights, i => i.GetProperty("rule").GetString() == "no-backup" && i.GetProperty("nodeIds")[0].GetString() == Id(db));
        GraphKit.HasProperties(noMonitoring[0], "id", "rule", "severity", "title", "detail", "nodeIds", "system");
        Assert.Equal("check", noMonitoring.First(i => i.GetProperty("nodeIds")[0].GetString() == Id(api)).GetProperty("severity").GetString());

        // Nothing has seen it: the state is unknown, never up.
        var detail = await GetAsync(c, $"/v1/staff/atlas/nodes/{api}");
        Assert.Equal("unknown", detail.GetProperty("node").GetProperty("state").GetString());
    }

    [Fact]
    public async Task Verification_reads_the_timestamps_and_the_code_evidence()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await SystemAsync(c);
        var (fresh, _) = await ServiceAsync(c, sys, "Recente");
        var (old, _) = await ServiceAsync(c, sys, "Antigo");
        var (gone, _) = await ServiceAsync(c, sys, "Sumiu");
        var (code, _) = await ServiceAsync(c, sys, "No código");
        var now = DateTime.UtcNow;
        await DbAsync(fx, async db =>
        {
            var f = db.AtlasServices.Single(s => s.Id == fresh);
            f.VerifiedAt = now.AddHours(-1);
            f.VerifiedBy = "railway";
            var o = db.AtlasServices.Single(s => s.Id == old);
            o.VerifiedAt = now.AddDays(-3);
            o.VerifiedBy = "railway";
            db.AtlasServices.Single(s => s.Id == gone).MissingSince = now;
            db.AtlasEvidence.Add(GraphKitEvidence(code, "repo:" + sys + "/app", now));
            await db.SaveChangesAsync();
        });

        var graph = await GetAsync(c, $"/v1/staff/atlas/graph?system={sys}");
        var recent = NodeNamed(graph, "Recente");
        Assert.Equal("verified", recent.GetProperty("verification").GetString());
        Assert.Equal("railway", recent.GetProperty("verifiedBy").GetString());
        Assert.Equal("stale", NodeNamed(graph, "Antigo").GetProperty("verification").GetString());
        Assert.Equal("not_found", NodeNamed(graph, "Sumiu").GetProperty("verification").GetString());
        var inCode = NodeNamed(graph, "No código");
        Assert.Equal("found_in_code", inCode.GetProperty("verification").GetString());
        Assert.Equal("pushed", inCode.GetProperty("codeScope").GetString());
        AssertAttention(NodeNamed(graph, "Sumiu"), unverified: 1);

        var insights = (await GetAsync(c, $"/v1/staff/atlas/insights?system={sys}")).EnumerateArray().ToList();
        Assert.Contains(insights, i => i.GetProperty("rule").GetString() == "missing-at-provider" && i.GetProperty("nodeIds")[0].GetString() == Id(gone));
    }

    [Fact]
    public async Task Coverage_counts_only_the_checks_that_apply()
    {
        var c = await TokenAsync(fx, StaffTokenScopes.Atlas);
        var sys = await SystemAsync(c);
        var (api, _) = await ServiceAsync(c, sys, "API", extra: new { monitor = "api-up" });
        await OkAsync(await c.PostAsJsonAsync("/v1/staff/atlas/repos", new { fullName = $"{sys}/app", system = sys, services = new[] { api.ToString() } }));

        var coverage = await GetAsync(c, $"/v1/staff/atlas/coverage?system={sys}");
        var checks = coverage.GetProperty("checks").EnumerateArray().ToDictionary(k => k.GetProperty("key").GetString()!, k => k);
        Assert.True(checks["repo_linked"].GetProperty("ok").GetBoolean());
        Assert.True(checks["monitoring"].GetProperty("ok").GetBoolean());
        Assert.False(checks["backup"].GetProperty("applicable").GetBoolean());
        Assert.False(checks["repo_synced"].GetProperty("ok").GetBoolean());
        var percent = coverage.GetProperty("percent").GetInt32();
        Assert.InRange(percent, 0, 100);
    }

    private static TeamTask NewTask(string status, string[] labels, DateTime now, bool archived = false) => new()
    {
        Id = Guid.NewGuid(), Code = "T-" + Guid.NewGuid().ToString("N")[..5].ToUpperInvariant(), Title = "Tarefa de teste", Body = "",
        Status = status, Position = 1, Priority = TeamTaskPriorities.Normal, Labels = labels, Source = TeamTaskSources.Manual,
        CreatedByRef = "teste", CreatedByName = "Teste", CreatedAt = now, UpdatedAt = now,
        DoneAt = status == TeamTaskStatuses.Done ? now : null, ArchivedAt = archived ? now : null,
    };

    private static AtlasRef Ref(Guid serviceId, string code, DateTime now) => new()
    {
        Id = Guid.NewGuid(), ServiceId = serviceId, Kind = AtlasRefKinds.Task, Code = code, Source = "console",
        CreatedBy = "teste", CreatedAt = now,
    };

    private static AtlasEvidence GraphKitEvidence(Guid serviceId, string source, DateTime now) => new()
    {
        Id = Guid.NewGuid(), SubjectType = "service", SubjectId = serviceId, Source = source, Method = "manifest",
        Ref = "package.json#name", Relation = null, Scope = AtlasScopes.Pushed, FirstSeenAt = now, LastSeenAt = now,
    };
}
