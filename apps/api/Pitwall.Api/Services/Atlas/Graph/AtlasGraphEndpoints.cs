using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas.Graph;

/// <summary>The graph's read endpoints (mapped by <c>MapAtlasGraph</c>). Each one is a projection of <see cref="AtlasGraphData"/>.</summary>
internal static class AtlasGraphEndpoints
{
    private const int DetailHistory = 20;

    // ---- The map -----------------------------------------------------------------------------

    public static async Task<IResult> Graph(
        PitwallDb db, AtlasCollectorRunner runner, CancellationToken ct,
        [FromQuery] string? system = null, [FromQuery] string? environment = null, [FromQuery] bool includeRetired = false)
    {
        var now = DateTime.UtcNow;
        var data = await AtlasGraphBuilder.LoadAsync(db, now, includeRetired, ct);
        Guid? sid = null;
        if (!string.IsNullOrWhiteSpace(system))
        {
            if (FindSystem(data, system) is not { } found) return NotFound("Sistema não encontrado.");
            sid = found.Id;
        }
        var env = Lower(environment);
        var (nodes, edges) = Project(data, sid, env);
        var coverage = sid is null ? null : AtlasCoverage.Compute(SystemNodes(data, sid.Value), data.ActiveEdges.ToList(), now);
        var sources = await AtlasSources.ListAsync(db, runner, now, ct);
        return Results.Ok(new GraphResponseDto(
            now, new GraphScopeDto(data.SystemOf(sid), env), Engines(),
            nodes.Select(ToNodeDto).ToList(), edges.Select(ToEdgeDto).ToList(), sources, coverage));
    }

    public static async Task<IResult> CompanyGraph(PitwallDb db, AtlasCollectorRunner runner, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var data = await AtlasGraphBuilder.LoadAsync(db, now, false, ct);
        var openTasks = await db.TeamTasks.AsNoTracking()
            .Where(t => t.ArchivedAt == null && t.Status != TeamTaskStatuses.Done && t.ProductId != null)
            .GroupBy(t => t.ProductId!.Value).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        string[] openTicketStatuses = [TicketStatuses.Open, TicketStatuses.InProgress];
        var tickets = await db.Tickets.AsNoTracking().Where(t => openTicketStatuses.Contains(t.Status))
            .GroupBy(t => t.ProductId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var dayAgo = now.AddDays(-1);
        var errors = await db.ServerErrors.AsNoTracking().Where(e => e.OccurredAt >= dayAgo)
            .GroupBy(e => e.ProductId).Select(g => new { g.Key, Count = g.Select(e => e.Signature).Distinct().Count() })
            .ToDictionaryAsync(g => g.Key, g => g.Count, ct);

        var cards = new List<SystemCardDto>();
        foreach (var p in data.Products.Values.Where(p => p.Active).OrderBy(p => p.Name, StringComparer.Ordinal))
        {
            var nodes = data.ActiveNodes.Where(n => n.ProductId == p.Id).ToList();
            var services = nodes.Where(n => !n.IsRepo).ToList();
            var repos = nodes.Where(n => n.IsRepo).ToList();
            var alerts = repos.Where(r => r.Repo!.OpenAlerts is not null).Select(r => r.Repo!.OpenAlerts!.Value).ToList();
            var attention = nodes.Aggregate(AttentionDto.None, (sum, n) => Add(sum, n.Attention));
            cards.Add(new SystemCardDto(
                p.Id, p.Slug, p.Name, p.Color, p.Description, SystemState(services),
                data.DependentSystems.GetValueOrDefault(p.Id) >= 2, nodes.Count,
                new HealthDto(services.Count,
                    services.Count(s => s.State == AtlasStates.Up), services.Count(s => s.State == AtlasStates.Down),
                    services.Count(s => s.State == AtlasStates.Degraded), services.Count(s => s.State == AtlasStates.Deploying),
                    services.Count(s => s.State == AtlasStates.Unknown)),
                attention,
                new RunningDto(
                    services.Count(s => s.Activity.Kind == "deploy"),
                    repos.Count(r => r.Activity.Kind == "ci"),
                    data.OpenActivities.Count(a => a.ProductId == p.Id),
                    data.RunningRoutineSystems.Count(x => x == p.Id)),
                new PendingDto(openTasks.GetValueOrDefault(p.Id), tickets.GetValueOrDefault(p.Id), errors.GetValueOrDefault(p.Id),
                    alerts.Count == 0 ? null : alerts.Sum()),
                AtlasCoverage.Compute(nodes, data.ActiveEdges.ToList(), now)));
        }

        var shared = data.ActiveNodes.Where(n => !n.IsRepo && n.ProductId is null).Select(ToNodeDto).ToList();

        // Edges between systems (or shared services): one per direction, counting the links folded into it.
        var agg = new Dictionary<(Guid From, Guid To), (int Count, SortedSet<string> Relations)>();
        foreach (var e in data.ActiveEdges)
        {
            var a = data.ById[e.From];
            var b = data.ById[e.To];
            if (a.IsRepo || b.IsRepo) continue;
            var ka = a.ProductId ?? a.Id;
            var kb = b.ProductId ?? b.Id;
            if (ka == kb) continue;
            if (!agg.TryGetValue((ka, kb), out var cell)) agg[(ka, kb)] = cell = (0, new SortedSet<string>(StringComparer.Ordinal));
            agg[(ka, kb)] = (cell.Count + 1, cell.Relations);
            cell.Relations.Add(e.Relation);
        }
        var edges = agg.OrderBy(kv => kv.Key.From).ThenBy(kv => kv.Key.To)
            .Select(kv => new CompanyEdgeDto(kv.Key.From, kv.Key.To, kv.Value.Count, kv.Value.Relations.ToList())).ToList();

        return Results.Ok(new CompanyGraphDto(now, cards, shared, edges, await AtlasSources.ListAsync(db, runner, now, ct)));
    }

    // ---- One node ----------------------------------------------------------------------------

    public static async Task<IResult> NodeDetail(Guid id, PitwallDb db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var data = await AtlasGraphBuilder.LoadAsync(db, now, true, ct);
        if (!data.ById.TryGetValue(id, out var node)) return NotFound("Nó não encontrado.");
        return Results.Ok(await DetailAsync(db, data, node, ct));
    }

    private static async Task<NodeDetailDto> DetailAsync(PitwallDb db, AtlasGraphData data, GNode node, CancellationToken ct)
    {
        // Neighbours and impact are read from the live map: a retired node is not a neighbour.
        var incoming = data.ActiveEdges.Where(e => e.To == node.Id)
            .Select(e => new EdgeNodeDto(ToEdgeDto(e), ToRef(data.ById[e.From]))).ToList();
        var outgoing = data.ActiveEdges.Where(e => e.From == node.Id)
            .Select(e => new EdgeNodeDto(ToEdgeDto(e), ToRef(data.ById[e.To]))).ToList();

        var (direct, indirect) = AtlasImpact.Of(data, node.Id);
        var impactSystems = direct.Concat(indirect).Select(n => n.ProductId).Where(p => p is not null).Distinct()
            .Select(p => data.SystemOf(p)).OfType<SystemRef>().OrderBy(s => s.Name, StringComparer.Ordinal).ToList();
        var impact = new ImpactDto(direct.Select(ToRef).ToList(), indirect.Select(ToRef).ToList(), impactSystems);

        var subjectType = node.IsRepo ? "repo" : "service";
        var evidence = await db.AtlasEvidence.AsNoTracking()
            .Where(e => e.SubjectType == subjectType && e.SubjectId == node.Id)
            .OrderBy(e => e.Source).ThenBy(e => e.Ref).ToListAsync(ct);

        List<AtlasEvent> events;
        if (node.IsRepo)
        {
            events = await db.AtlasEvents.AsNoTracking().Where(e => e.RepoId == node.Id)
                .OrderByDescending(e => e.At).Take(DetailHistory).ToListAsync(ct);
        }
        else
        {
            events = await db.AtlasEvents.AsNoTracking().Where(e => e.ServiceId == node.Id)
                .OrderByDescending(e => e.At).Take(DetailHistory).ToListAsync(ct);
        }

        var changes = await db.AtlasChanges.AsNoTracking().Where(c => c.EntityId == node.Id)
            .OrderByDescending(c => c.At).Take(DetailHistory).ToListAsync(ct);

        List<RepoRefDto> repos = node.IsRepo ? [] : data.Repos
            .Where(r => r.RetiredAt is null && r.ServiceIds.Contains(node.Id))
            .OrderBy(r => r.FullName, StringComparer.Ordinal)
            .Select(r => new RepoRefDto(r.Id, r.FullName, r.Role, r.LastRunStatus, r.LastRunAt, r.LastRunUrl, r.LastSyncAt)).ToList();

        var processes = data.Steps.Where(s => s.ServiceIds.Contains(node.Id))
            .Select(s => new ProcessRefDto(s.Process.Id, s.Process.Slug, s.Process.Name, new StepRefDto(s.Slug, s.Name, s.Status)))
            .ToList();

        // Change sets: the ones that changed this node, and for a repository the ones it sent.
        var changeSetIds = changes.Where(c => c.ChangeSetId is not null).Select(c => c.ChangeSetId!.Value)
            .Concat(evidence.Where(e => e.ChangeSetId is not null).Select(e => e.ChangeSetId!.Value)).Distinct().ToArray();
        List<AtlasChangeSet> changeSetRows = changeSetIds.Length == 0 ? [] : await db.AtlasChangeSets.AsNoTracking()
            .Where(c => changeSetIds.Contains(c.Id)).ToListAsync(ct);
        if (node.IsRepo)
        {
            var sent = await db.AtlasChangeSets.AsNoTracking().Where(c => c.RepoId == node.Id).ToListAsync(ct);
            changeSetRows = changeSetRows.Concat(sent).DistinctBy(c => c.Id).ToList();
        }
        var changeSets = changeSetRows.OrderByDescending(c => c.ReceivedAt).Take(DetailHistory).Select(ToChangeSetDto).ToList();

        var baseNode = ToNodeDto(node);
        var detail = node.Service is { } s
            ? new NodeDetailNode(
                baseNode.Id, baseNode.Key, baseNode.Type, baseNode.Name, baseNode.Kind, baseNode.Engine, baseNode.Group,
                baseNode.ProductId, baseNode.EnvironmentId, baseNode.Environment, baseNode.Shared, baseNode.Provider, baseNode.Url,
                baseNode.Signature, baseNode.State, baseNode.Condition, baseNode.Origin, baseNode.Verification, baseNode.CodeScope,
                baseNode.VerifiedAt, baseNode.VerifiedBy, baseNode.CheckedAt, baseNode.Attention, baseNode.Activity, baseNode.LastEvent,
                baseNode.RetiredAt, baseNode.RemovalReportedAt, baseNode.MissingSince, baseNode.CreatedAt, baseNode.UpdatedAt,
                s.Notes, s.Facts.Select(f => new KeyValueDto(f.Key, f.Value)).ToList(), s.Items.ToList(), s.ExternalRef, s.MonitorRef,
                s.Aliases.ToList(), s.Owner, s.Impact, s.DeployStatus, s.MonitorStatus, s.LastDeployAt, s.CommitSha, [])
            : new NodeDetailNode(
                baseNode.Id, baseNode.Key, baseNode.Type, baseNode.Name, baseNode.Kind, baseNode.Engine, baseNode.Group,
                baseNode.ProductId, baseNode.EnvironmentId, baseNode.Environment, baseNode.Shared, baseNode.Provider, baseNode.Url,
                baseNode.Signature, baseNode.State, baseNode.Condition, baseNode.Origin, baseNode.Verification, baseNode.CodeScope,
                baseNode.VerifiedAt, baseNode.VerifiedBy, baseNode.CheckedAt, baseNode.Attention, baseNode.Activity, baseNode.LastEvent,
                baseNode.RetiredAt, baseNode.RemovalReportedAt, baseNode.MissingSince, baseNode.CreatedAt, baseNode.UpdatedAt,
                null, [], [], null, null, [], null, null, null, null, null, node.Repo!.LastRunSha,
                node.Repo.Stack.Select(f => new KeyValueDto(f.Key, f.Value)).ToList());

        return new NodeDetailDto(
            detail, data.SystemOf(node.ProductId), incoming, outgoing, impact,
            evidence.Select(ToEvidenceDto).ToList(),
            node.Work.Select(w => new NodeRefLinkDto(w.Id, w.Kind, w.Code, w.Note, w.Title, w.Status, w.Class, w.Via)).ToList(),
            events.Select(ToEventDto).ToList(), changes.Select(ToChangeDto).ToList(),
            repos, processes, changeSets, ProviderUrl(node));
    }

    // ---- History ----------------------------------------------------------------------------

    public static async Task<IResult> Changes(
        PitwallDb db, CancellationToken ct, [FromQuery] string? since = null, [FromQuery] string? system = null,
        [FromQuery] Guid? entityId = null, [FromQuery] int? limit = null)
    {
        var q = db.AtlasChanges.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(since))
        {
            if (!TryInstant(since, out var s)) return Bad("Data inválida. Use ISO 8601, por exemplo 2026-11-01T00:00:00Z.");
            q = q.Where(c => c.At >= s);
        }
        if (!string.IsNullOrWhiteSpace(system))
        {
            if (await FindProductAsync(db, system, ct) is not { } p) return NotFound("Sistema não encontrado.");
            q = q.Where(c => c.ProductId == p.Id);
        }
        if (entityId is { } eid) q = q.Where(c => c.EntityId == eid);
        var rows = await q.OrderByDescending(c => c.At).Take(Limit(limit, 100, 500)).ToListAsync(ct);
        return Results.Ok(rows.Select(ToChangeDto));
    }

    public static async Task<IResult> ChangeSets(
        PitwallDb db, CancellationToken ct, [FromQuery] string? system = null, [FromQuery] string? repo = null, [FromQuery] int? limit = null)
    {
        var q = db.AtlasChangeSets.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(system))
        {
            if (await FindProductAsync(db, system, ct) is not { } p) return NotFound("Sistema não encontrado.");
            q = q.Where(c => c.ProductId == p.Id);
        }
        if (!string.IsNullOrWhiteSpace(repo))
        {
            var r = Lower(repo);
            q = q.Where(c => c.Repo == r);
        }
        var rows = await q.OrderByDescending(c => c.ReceivedAt).Take(Limit(limit, 50, 200)).ToListAsync(ct);
        return Results.Ok(rows.Select(ToChangeSetDto));
    }

    public static async Task<IResult> Events(
        PitwallDb db, CancellationToken ct, [FromQuery] string? since = null, [FromQuery] string? system = null,
        [FromQuery] Guid? serviceId = null, [FromQuery] Guid? repoId = null, [FromQuery] int? limit = null)
    {
        var q = db.AtlasEvents.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(since))
        {
            if (!TryInstant(since, out var s)) return Bad("Data inválida. Use ISO 8601, por exemplo 2026-11-01T00:00:00Z.");
            q = q.Where(e => e.At >= s);
        }
        if (!string.IsNullOrWhiteSpace(system))
        {
            if (await FindProductAsync(db, system, ct) is not { } p) return NotFound("Sistema não encontrado.");
            q = q.Where(e => e.ProductId == p.Id);
        }
        if (serviceId is { } sid) q = q.Where(e => e.ServiceId == sid);
        if (repoId is { } rid) q = q.Where(e => e.RepoId == rid);
        var rows = await q.OrderByDescending(e => e.At).Take(Limit(limit, 100, 500)).ToListAsync(ct);
        return Results.Ok(rows.Select(ToEventDto));
    }

    public static async Task<IResult> Snapshots(PitwallDb db, CancellationToken ct, [FromQuery] int? limit = null)
    {
        var rows = await db.AtlasSnapshots.AsNoTracking().OrderByDescending(s => s.TakenAt).Take(Limit(limit, 60, 500))
            .Select(s => new { s.Id, s.TakenAt, s.Reason, s.NodeCount, s.EdgeCount }).ToListAsync(ct);
        return Results.Ok(rows.Select(s => new SnapshotDto(s.Id, s.TakenAt, s.Reason, s.NodeCount, s.EdgeCount)));
    }

    public static async Task<IResult> Diff(
        PitwallDb db, CancellationToken ct, [FromQuery] string? from = null, [FromQuery] string? to = null, [FromQuery] string? system = null)
    {
        var now = DateTime.UtcNow;
        Guid? sid = null;
        if (!string.IsNullOrWhiteSpace(system))
        {
            if (await FindProductAsync(db, system, ct) is not { } p) return NotFound("Sistema não encontrado.");
            sid = p.Id;
        }
        var toPoint = await PointAsync(db, string.IsNullOrWhiteSpace(to) ? "now" : to, now, ct);
        if (toPoint.Error is not null) return toPoint.Error;
        var fromPoint = string.IsNullOrWhiteSpace(from) ? new Point(null, null, null) : await PointAsync(db, from, now, ct);
        if (fromPoint.Error is not null) return fromPoint.Error;

        var index = await AtlasGraphBuilder.LoadAsync(db, now, true, ct);
        var toData = toPoint.Json is null ? AtlasSnapshots.Structure(index) : AtlasSnapshots.Parse(toPoint.Json)!;
        var fromEnd = new DiffEndDto(fromPoint.At, fromPoint.SnapshotId);
        var toEnd = new DiffEndDto(toPoint.At, toPoint.SnapshotId);
        // No earlier snapshot (or none named): there is nothing to compare with yet.
        if (fromPoint.Json is null) return Results.Ok(new GraphDiffDto(fromEnd, toEnd, new DiffNodesDto([], [], []), new DiffEdgesDto([], [])));
        var fromData = AtlasSnapshots.Parse(fromPoint.Json)!;
        return Results.Ok(AtlasSnapshots.Diff(fromData, toData, index, sid, fromEnd, toEnd));
    }

    /// <summary>A diff end: a snapshot id, an ISO date (the latest snapshot at or before it), or "now".</summary>
    private sealed record Point(DateTime? At, Guid? SnapshotId, string? Json, IResult? Error = null);

    private static async Task<Point> PointAsync(PitwallDb db, string raw, DateTime now, CancellationToken ct)
    {
        var s = raw.Trim();
        if (s.Equals("now", StringComparison.OrdinalIgnoreCase)) return new Point(now, null, null);
        if (Guid.TryParse(s, out var id))
        {
            var snap = await db.AtlasSnapshots.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (snap is null) return new Point(null, null, null, NotFound("Snapshot não encontrado."));
            return new Point(snap.TakenAt, snap.Id, snap.Data);
        }
        if (TryInstant(s, out var at))
        {
            var snap = await db.AtlasSnapshots.AsNoTracking().Where(x => x.TakenAt <= at)
                .OrderByDescending(x => x.TakenAt).FirstOrDefaultAsync(ct);
            return snap is null ? new Point(null, null, null) : new Point(snap.TakenAt, snap.Id, snap.Data);
        }
        return new Point(null, null, null, Bad("Ponto inválido: use o id de um snapshot, uma data ISO ou now."));
    }

    // ---- Insights, coverage, sources ---------------------------------------------------------

    public static async Task<IResult> Insights(PitwallDb db, CancellationToken ct, [FromQuery] string? system = null)
    {
        var now = DateTime.UtcNow;
        var data = await AtlasGraphBuilder.LoadAsync(db, now, false, ct);
        Guid? sid = null;
        if (!string.IsNullOrWhiteSpace(system))
        {
            if (FindSystem(data, system) is not { } found) return NotFound("Sistema não encontrado.");
            sid = found.Id;
        }
        return Results.Ok(AtlasInsights.Build(data, sid));
    }

    public static async Task<IResult> Coverage(PitwallDb db, CancellationToken ct, [FromQuery] string? system = null)
    {
        var now = DateTime.UtcNow;
        var data = await AtlasGraphBuilder.LoadAsync(db, now, false, ct);
        IReadOnlyCollection<GNode> nodes = data.ActiveNodes.ToList();
        if (!string.IsNullOrWhiteSpace(system))
        {
            if (FindSystem(data, system) is not { } found) return NotFound("Sistema não encontrado.");
            nodes = SystemNodes(data, found.Id);
        }
        return Results.Ok(AtlasCoverage.Compute(nodes, data.ActiveEdges.ToList(), now));
    }

    public static async Task<IResult> Sources(PitwallDb db, AtlasCollectorRunner runner, CancellationToken ct) =>
        Results.Ok(await AtlasSources.ListAsync(db, runner, DateTime.UtcNow, ct));

    // ---- Projection helpers -----------------------------------------------------------------

    /// <summary>
    /// The nodes of a view. A system shows its own services and repositories, the shared services
    /// linked to them, and (with an environment) the nodes of that environment and the ones without one.
    /// </summary>
    private static (List<GNode> Nodes, List<GEdge> Edges) Project(AtlasGraphData data, Guid? systemId, string? environment)
    {
        var keep = systemId is { } sid ? data.Nodes.Where(n => n.ProductId == sid).Select(n => n.Id).ToHashSet() : data.Nodes.Select(n => n.Id).ToHashSet();
        if (systemId is not null)
        {
            var own = new HashSet<Guid>(keep);
            foreach (var e in data.Edges)
            {
                if (own.Contains(e.From) == own.Contains(e.To)) continue;
                var other = own.Contains(e.From) ? e.To : e.From;
                var node = data.ById[other];
                if (!node.IsRepo && node.ProductId is null) keep.Add(other);
            }
        }
        var nodes = data.Nodes.Where(n => keep.Contains(n.Id)
            && (environment is null || n.Environment is null || n.Environment == environment)).ToList();
        var ids = nodes.Select(n => n.Id).ToHashSet();
        var edges = data.Edges.Where(e => ids.Contains(e.From) && ids.Contains(e.To)).ToList();
        return (nodes, edges);
    }

    /// <summary>The services and repositories that belong to a system (active ones only).</summary>
    private static List<GNode> SystemNodes(AtlasGraphData data, Guid systemId) =>
        data.ActiveNodes.Where(n => n.ProductId == systemId).ToList();

    private static string SystemState(IEnumerable<GNode> services)
    {
        var list = services.ToList();
        if (list.Count == 0) return AtlasStates.Unknown;
        if (list.Any(s => s.State == AtlasStates.Down)) return AtlasStates.Down;
        if (list.Any(s => s.State == AtlasStates.Deploying)) return AtlasStates.Deploying;
        if (list.Any(s => s.State == AtlasStates.Degraded)) return AtlasStates.Degraded;
        return list.All(s => s.State == AtlasStates.Up) ? AtlasStates.Up : AtlasStates.Unknown;
    }

    private static AttentionDto Add(AttentionDto a, AttentionDto b) => new(
        a.Failure + b.Failure, a.Security + b.Security, a.Task + b.Task, a.Improvement + b.Improvement,
        a.Config + b.Config, a.Unverified + b.Unverified);

    private static List<EngineDto> Engines() =>
        AtlasEngines.All.Select((e, i) => new EngineDto(e, AtlasEngines.NamePt(e), i)).ToList();

    private static string? ProviderUrl(GNode node)
    {
        if (node.IsRepo) return "https://github.com/" + node.Repo!.FullName;
        return node.Provider switch
        {
            "railway" => "https://railway.com/dashboard",
            "vercel" => "https://vercel.com/dashboard",
            "cloudflare" => "https://dash.cloudflare.com",
            _ => node.Url,
        };
    }

    private static ProductInfo? FindSystem(AtlasGraphData data, string raw)
    {
        var s = Lower(raw);
        return data.Products.Values.FirstOrDefault(p => p.Slug == s || p.Id.ToString() == s);
    }

    private static async Task<Product?> FindProductAsync(PitwallDb db, string raw, CancellationToken ct)
    {
        var s = Lower(raw);
        return await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Slug == s || p.Id.ToString() == s, ct);
    }

    // ---- DTO mapping ------------------------------------------------------------------------

    internal static GraphNodeDto ToNodeDto(GNode n) => new(
        n.Id, n.Key, n.IsRepo ? "repo" : "service", n.Name, n.Kind, n.Engine, n.Group, n.ProductId, n.EnvironmentId, n.Environment,
        n.Shared, n.Provider, n.Url, n.Signature, n.State, n.Condition, n.Origin, n.Verification, n.CodeScope,
        n.VerifiedAt, n.VerifiedBy, n.CheckedAt, n.Attention, n.Activity, n.LastEvent,
        n.RetiredAt, n.RemovalReportedAt, n.MissingSince, n.CreatedAt, n.UpdatedAt);

    private static GraphEdgeDto ToEdgeDto(GEdge e) => new(
        e.Id, e.From, e.To, e.Relation, e.Category, e.Label, e.Planned, e.Origin, e.VerifiedAt, e.RetiredAt);

    private static NodeRefDto ToRef(GNode n) => new(n.Id.ToString("D"), n.Key, n.Name, n.Kind, n.Engine, n.ProductId, n.State);

    private static EvidenceDto ToEvidenceDto(AtlasEvidence e) => new(
        e.Id, e.Source, e.Method, e.Ref, e.Detail, e.Relation, e.Scope, e.CommitSha, e.FirstSeenAt, e.LastSeenAt, e.GoneAt);

    private static AtlasEventDto ToEventDto(AtlasEvent e) => new(
        e.Id, e.At, e.Source, e.Type, e.Status, e.Title, e.Url, e.CommitSha, e.Detail, e.ProductId, e.ServiceId, e.RepoId);

    private static AtlasChangeDto ToChangeDto(AtlasChange c) => new(
        c.Id, c.At, c.Actor, c.Source, c.ChangeSetId, c.EntityType, c.EntityId, c.ProductId, c.Op,
        c.Fields.Select(f => new FieldChangeDto(f.Field, f.Before, f.After)).ToList(), c.Summary);

    private static ChangeSetDto ToChangeSetDto(AtlasChangeSet c) => new(
        c.Id, c.ReceivedAt, c.Source, c.Tool, c.Repo, c.Branch, c.CommitSha, c.Scope, c.Environment, c.Actor, c.Status, c.Summary,
        c.TaskCodes.ToList(), ParseResult(c.Result));

    /// <summary>The stored answer of a change set. Whatever the shape, a missing part reads as empty.</summary>
    private static ChangeSetResultDto ParseResult(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            var rejected = r.TryGetProperty("rejected", out var rej) && rej.ValueKind == JsonValueKind.Array
                ? rej.EnumerateArray().Select(x => new RejectedDto(Text(x, "op") ?? "", Text(x, "message") ?? "")).ToList()
                : new List<RejectedDto>();
            return new ChangeSetResultDto(
                Strings(r, "created"), Strings(r, "updated"),
                r.TryGetProperty("unchanged", out var u) && u.ValueKind == JsonValueKind.Number && u.TryGetInt32(out var n) ? n : 0,
                Strings(r, "gone"), Strings(r, "removalsReported"), rejected, Strings(r, "attention"));
        }
        catch (JsonException)
        {
            return new ChangeSetResultDto([], [], 0, [], [], [], []);
        }
    }

    private static List<string> Strings(JsonElement r, string name) =>
        r.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Array
            ? p.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList()
            : [];

    private static string? Text(JsonElement r, string name) =>
        r.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    // ---- Small helpers ---------------------------------------------------------------------

    private static string? Lower(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim().ToLowerInvariant();

    private static int Limit(int? requested, int fallback, int max) => Math.Clamp(requested ?? fallback, 1, max);

    private static bool TryInstant(string raw, out DateTime instant) =>
        DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out instant);

    private static IResult Bad(string message) => Results.BadRequest(new { message });
    private static IResult NotFound(string message) => Results.NotFound(new { message });
}
