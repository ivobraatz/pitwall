using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Endpoints.Staff;

namespace Pitwall.Services.Atlas.Graph;

/// <summary>
/// Loads the Atlas once and projects it into nodes and edges. Every graph read (the map, the detail,
/// insights, coverage, the snapshot) starts here, so they all agree on what exists and what it means.
/// </summary>
internal static class AtlasGraphBuilder
{
    /// <summary>Edges that mean "depends on": a failure travels along them (impact and shared systems).</summary>
    public static readonly HashSet<string> ImpactCategories = [AtlasEdgeCategories.Infra, AtlasEdgeCategories.Data, AtlasEdgeCategories.Business, AtlasEdgeCategories.Trigger];

    private static readonly TimeSpan EventWindow = TimeSpan.FromDays(90);

    public static async Task<AtlasGraphData> LoadAsync(PitwallDb db, DateTime now, bool includeRetired, CancellationToken ct)
    {
        var data = new AtlasGraphData { Now = now, IncludeRetired = includeRetired };

        foreach (var p in await db.Products.AsNoTracking()
                     .Select(p => new { p.Id, p.Slug, p.Name, p.Color, p.Description, p.DisabledAt }).ToListAsync(ct))
            data.Products[p.Id] = new ProductInfo(p.Id, p.Slug, p.Name, p.Color, p.Description, p.DisabledAt is null);
        foreach (var e in await db.AtlasEnvironments.AsNoTracking().Select(e => new { e.Id, e.Slug }).ToListAsync(ct))
            data.EnvironmentSlugs[e.Id] = e.Slug;

        var services = await db.AtlasServices.AsNoTracking().Where(s => includeRetired || s.RetiredAt == null).ToListAsync(ct);
        data.Repos.AddRange(await db.AtlasRepos.AsNoTracking().Where(r => includeRetired || r.RetiredAt == null).ToListAsync(ct));
        var links = await db.AtlasLinks.AsNoTracking().Where(l => includeRetired || l.RetiredAt == null).ToListAsync(ct);
        var refs = await db.AtlasRefs.AsNoTracking().ToListAsync(ct);
        var codeEvidence = await db.AtlasEvidence.AsNoTracking()
            .Where(e => e.SubjectType == "service" && e.Source.StartsWith("repo:")).ToListAsync(ct);
        data.Steps.AddRange(await db.AtlasSteps.AsNoTracking().Include(s => s.Process).ToListAsync(ct));

        var activityCutoff = now - StaffAtlasEndpoints.ActivityStaleAfter;
        data.OpenActivities.AddRange(await db.AtlasActivities.AsNoTracking()
            .Where(a => a.Status == AtlasRunStatuses.Running && a.StartedAt >= activityCutoff).ToListAsync(ct));
        var runCutoff = now - StaffAtlasEndpoints.RunStaleAfter;
        data.RunningRoutineSystems.AddRange(await db.AtlasRoutineRuns.AsNoTracking()
            .Where(r => r.Status == AtlasRunStatuses.Running && r.StartedAt >= runCutoff).Select(r => r.Routine.ProductId).ToListAsync(ct));

        var eventCutoff = now - EventWindow;
        var events = await db.AtlasEvents.AsNoTracking()
            .Where(e => e.At >= eventCutoff && (e.ServiceId != null || e.RepoId != null))
            .Select(e => new { e.At, e.Type, e.Status, e.Title, e.ServiceId, e.RepoId }).ToListAsync(ct);

        // Tasks: the open ones (for labels), and the ones a reference names, whatever their status.
        var openTasks = await db.TeamTasks.AsNoTracking().Where(t => t.ArchivedAt == null && t.Status != TeamTaskStatuses.Done)
            .Select(t => new { t.Id, t.Code, t.Title, t.Status, t.Labels, t.ProductId }).ToListAsync(ct);
        var taskCodes = refs.Where(r => r.Kind == AtlasRefKinds.Task).Select(r => r.Code).Distinct().ToArray();
        var refTasks = taskCodes.Length == 0 ? [] : await db.TeamTasks.AsNoTracking()
            .Where(t => taskCodes.Contains(t.Code)).Select(t => new { t.Id, t.Code, t.Title, t.Status, t.Labels, t.ArchivedAt }).ToListAsync(ct);
        var ticketCodes = refs.Where(r => r.Kind == AtlasRefKinds.Ticket).Select(r => r.Code).Distinct().ToArray();
        var refTickets = ticketCodes.Length == 0 ? [] : await db.Tickets.AsNoTracking()
            .Where(t => ticketCodes.Contains(t.Code)).Select(t => new { t.Id, t.Code, t.Title, t.Status }).ToListAsync(ct);

        // Nodes.
        foreach (var s in services)
        {
            var node = new GNode
            {
                Id = s.Id, Key = s.Key, IsRepo = false, Service = s, Name = s.Name, Kind = s.Kind, Engine = s.Engine, Group = s.Group,
                ProductId = s.ProductId, EnvironmentId = s.EnvironmentId, Provider = s.Provider, Url = s.Url, Signature = s.Signature,
                State = s.State, Condition = s.Condition, Origin = s.Origin, VerifiedAt = s.VerifiedAt, VerifiedBy = s.VerifiedBy,
                CheckedAt = s.CheckedAt, RetiredAt = s.RetiredAt, RemovalReportedAt = s.RemovalReportedAt, MissingSince = s.MissingSince,
                CreatedAt = s.CreatedAt, UpdatedAt = s.UpdatedAt,
            };
            node.Environment = s.EnvironmentId is { } envId && data.EnvironmentSlugs.TryGetValue(envId, out var slug) ? slug : null;
            AddNode(data, node);
        }
        foreach (var r in data.Repos)
        {
            var node = new GNode
            {
                Id = r.Id, Key = "repo:" + r.FullName, IsRepo = true, Repo = r, Name = r.FullName, Kind = "repo", Engine = AtlasEngines.Code,
                ProductId = r.ProductId, Provider = "github", Url = "https://github.com/" + r.FullName,
                State = RepoState(r.LastRunStatus), Origin = AtlasOrigins.Declared,
                VerifiedAt = r.CheckedAt, VerifiedBy = r.CheckedAt is null ? null : "github", CheckedAt = r.CheckedAt,
                CodeScope = r.LastSyncScope is AtlasScopes.Local or AtlasScopes.Pushed or AtlasScopes.Deployed ? r.LastSyncScope : null,
                RetiredAt = r.RetiredAt, CreatedAt = r.CreatedAt, UpdatedAt = r.LastSyncAt ?? r.CheckedAt ?? r.CreatedAt,
            };
            AddNode(data, node);
        }

        // Evidence from repositories: live and gone counts, and the strongest live scope.
        var scopes = new Dictionary<Guid, List<string>>();
        foreach (var ev in codeEvidence)
        {
            if (!data.ById.TryGetValue(ev.SubjectId, out var node)) continue;
            node.AnyCodeEvidence++;
            if (ev.GoneAt is not null) continue;
            node.LiveCodeEvidence++;
            if (!scopes.TryGetValue(node.Id, out var list)) scopes[node.Id] = list = [];
            list.Add(ev.Scope);
        }

        // Activity and last event.
        var openActivityByService = data.OpenActivities.Where(a => a.ServiceId != null)
            .GroupBy(a => a.ServiceId!.Value).ToDictionary(g => g.Key, g => g.OrderBy(a => a.StartedAt).First());
        var lastByNode = new Dictionary<Guid, LastEventDto>();
        foreach (var e in events.OrderByDescending(e => e.At))
        {
            var id = e.ServiceId ?? e.RepoId!.Value;
            lastByNode.TryAdd(id, new LastEventDto(e.Type, e.At, e.Status, e.Title));
        }

        // Tasks and tickets linked to nodes.
        var refTaskByCode = refTasks.GroupBy(t => t.Code, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        var ticketByCode = refTickets.GroupBy(t => t.Code, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        foreach (var r in refs)
        {
            if (!data.ById.TryGetValue(r.ServiceId, out var node)) continue;
            switch (r.Kind)
            {
                case AtlasRefKinds.Task:
                    if (refTaskByCode.TryGetValue(r.Code, out var task))
                    {
                        if (task.ArchivedAt is not null || task.Status == TeamTaskStatuses.Done) break;
                        node.Work.Add(new WorkLink(task.Id, AtlasRefKinds.Task, task.Code, r.Note, task.Title, task.Status,
                            AtlasAttention.ClassifyTask(task.Status, task.Labels), AtlasWorkVia.Ref));
                    }
                    else
                    {
                        // A reference to a task the board does not have: it stays open until someone removes it.
                        node.Work.Add(new WorkLink(null, AtlasRefKinds.Task, r.Code, r.Note, null, null, AtlasAttentionClasses.Task, AtlasWorkVia.Ref));
                    }
                    break;
                case AtlasRefKinds.Ticket:
                    if (ticketByCode.TryGetValue(r.Code, out var ticket))
                    {
                        if (!TicketStatuses.Active.Contains(ticket.Status)) break;
                        node.Work.Add(new WorkLink(ticket.Id, AtlasRefKinds.Ticket, ticket.Code, r.Note, ticket.Title, ticket.Status,
                            AtlasAttentionClasses.Task, AtlasWorkVia.Ref));
                    }
                    else
                    {
                        node.Work.Add(new WorkLink(null, AtlasRefKinds.Ticket, r.Code, r.Note, null, null, AtlasAttentionClasses.Task, AtlasWorkVia.Ref));
                    }
                    break;
                case AtlasRefKinds.Error:
                    // An error the team chose to track counts as a failure until the reference is removed.
                    node.Work.Add(new WorkLink(null, AtlasRefKinds.Error, r.Code, r.Note, null, null, AtlasAttentionClasses.Failure, AtlasWorkVia.Ref));
                    break;
            }
        }
        foreach (var t in openTasks)
        {
            foreach (var label in t.Labels)
            {
                if (!label.StartsWith("atlas:", StringComparison.OrdinalIgnoreCase)) continue;
                var key = label[6..].Trim();
                if (!data.ByKey.TryGetValue(key, out var node)) continue;
                // A task already linked by reference keeps its "ref" link.
                if (node.Work.Any(w => w.Id == t.Id)) continue;
                node.Work.Add(new WorkLink(t.Id, AtlasRefKinds.Task, t.Code, null, t.Title, t.Status,
                    AtlasAttention.ClassifyTask(t.Status, t.Labels), AtlasWorkVia.Label));
            }
        }

        // Repositories' activity and the node facts that depend on the projection.
        foreach (var node in data.Nodes)
        {
            if (node.IsRepo)
            {
                if (node.Repo!.LastRunStatus == AtlasRunStatuses.Running)
                    node.Activity = new ActivityDto(true, "ci", node.Repo.LastRunAt);
            }
            else
            {
                var s = node.Service!;
                if (s.DeployStatus == "building") node.Activity = new ActivityDto(true, "deploy", s.LastDeployAt);
                else if (openActivityByService.TryGetValue(node.Id, out var a)) node.Activity = new ActivityDto(true, "agent", a.StartedAt);
            }
            if (lastByNode.TryGetValue(node.Id, out var last)) node.LastEvent = last;

            var live = scopes.GetValueOrDefault(node.Id) ?? [];
            if (!node.IsRepo)
            {
                node.Verification = AtlasVerification.Derive(node.VerifiedAt, node.MissingSince, node.RemovalReportedAt, node.Origin,
                    node.LiveCodeEvidence, node.AnyCodeEvidence, now);
                node.CodeScope = StrongestCodeScope(live);
            }
            else
            {
                node.Verification = AtlasVerification.Derive(node.VerifiedAt, null, null, node.Origin, 0, 0, now);
            }
        }

        // Dependencies between systems, which decide "shared".
        var repoByName = data.Repos.ToDictionary(r => r.FullName, StringComparer.OrdinalIgnoreCase);
        var deps = new Dictionary<Guid, HashSet<Guid>>();

        // Links.
        var seen = new HashSet<(Guid, Guid, string)>();
        foreach (var l in links)
        {
            if (!data.ById.ContainsKey(l.FromServiceId) || !data.ById.ContainsKey(l.ToServiceId)) continue;
            data.Edges.Add(new GEdge(l.Id.ToString(), l.FromServiceId, l.ToServiceId, l.Relation, l.Category, l.Label, l.Planned, l.Origin,
                l.VerifiedAt, l.RetiredAt));
            seen.Add((l.FromServiceId, l.ToServiceId, l.Relation));
        }

        // Deployments: a repository delivers its services.
        foreach (var r in data.Repos)
        {
            foreach (var sid in r.ServiceIds.Distinct())
            {
                if (!data.ById.TryGetValue(sid, out var target) || target.IsRepo) continue;
                if (!seen.Add((r.Id, sid, "deploys_to"))) continue;
                data.Edges.Add(new GEdge($"repo:{r.Id}>{sid}", r.Id, sid, "deploys_to", AtlasEdgeCategories.Infra, null, false,
                    AtlasOrigins.Declared, null, null));
            }
        }

        // Code evidence that names a relation: from the repository's one service, or from the repository itself.
        foreach (var ev in codeEvidence)
        {
            if (ev.GoneAt is not null || ev.Relation is null) continue;
            if (!data.ById.TryGetValue(ev.SubjectId, out var to) || to.IsRepo) continue;
            var repoName = ev.Source["repo:".Length..];
            if (!repoByName.TryGetValue(repoName, out var repo)) continue;
            var distinct = repo.ServiceIds.Distinct().ToList();
            var from = distinct.Count == 1 && data.ById.ContainsKey(distinct[0]) ? distinct[0] : repo.Id;
            if (!data.ById.ContainsKey(from) || from == to.Id) continue;
            if (!seen.Add((from, to.Id, ev.Relation))) continue;
            data.Edges.Add(new GEdge($"ev:{ev.Id}", from, to.Id, ev.Relation, AtlasRelations.Category(ev.Relation), null, false,
                AtlasOrigins.Discovered, null, null));
        }

        // Shared: no system, or a system that at least two other systems depend on.
        foreach (var e in data.Edges)
        {
            if (!ImpactCategories.Contains(e.Category)) continue;
            var a = data.ById[e.From];
            var b = data.ById[e.To];
            if (a.IsRepo || b.IsRepo || a.ProductId is null || b.ProductId is null || a.ProductId == b.ProductId) continue;
            if (!deps.TryGetValue(b.ProductId.Value, out var set)) deps[b.ProductId.Value] = set = [];
            set.Add(a.ProductId.Value);
        }
        foreach (var (productId, set) in deps) data.DependentSystems[productId] = set.Count;
        foreach (var node in data.Nodes)
            node.Shared = node.ProductId is null || data.DependentSystems.GetValueOrDefault(node.ProductId.Value) >= 2;

        // Attention, per node (contract 1.7).
        foreach (var node in data.Nodes) node.Attention = Attention(node, data.Repos);

        return data;
    }

    private static void AddNode(AtlasGraphData data, GNode node)
    {
        data.Nodes.Add(node);
        data.ById[node.Id] = node;
        data.ByKey[node.Key] = node;
    }

    private static AttentionDto Attention(GNode node, List<AtlasRepo> repos)
    {
        var failure = 0;
        var security = 0;
        var task = 0;
        var improvement = 0;
        var config = 0;
        foreach (var w in node.Work)
        {
            switch (w.Class)
            {
                case AtlasAttentionClasses.Failure: failure++; break;
                case AtlasAttentionClasses.Security: security++; break;
                case AtlasAttentionClasses.Improvement: improvement++; break;
                case AtlasAttentionClasses.Config: config++; break;
                default: task++; break;
            }
        }
        if (node.IsRepo)
        {
            if (node.Repo!.LastRunStatus == "failure") failure++;
            security += node.Repo.OpenAlerts ?? 0;
        }
        else
        {
            if (node.State is AtlasStates.Down or AtlasStates.Degraded) failure++;
            if (node.Condition == "planned") improvement++;
            if (node.Condition is AtlasConditions.Gap or AtlasConditions.Warn) config++;
        }
        var unverified = node.Verification is AtlasVerification.NotFound or AtlasVerification.Stale or AtlasVerification.Reported;
        return new AttentionDto(failure, security, task, improvement, config, unverified ? 1 : 0);
    }

    /// <summary>The repository's last run in the vocabulary of the states.</summary>
    private static string RepoState(string? lastRun) => lastRun switch
    {
        "success" => AtlasStates.Up,
        "failure" => AtlasStates.Down,
        "running" => AtlasStates.Deploying,
        _ => AtlasStates.Unknown,
    };

    private static string? StrongestCodeScope(List<string> scopes)
    {
        string? best = null;
        foreach (var s in scopes)
        {
            if (s is not (AtlasScopes.Local or AtlasScopes.Pushed or AtlasScopes.Deployed)) continue;
            best = best is null ? s : AtlasScopes.Stronger(best, s);
        }
        return best;
    }
}

/// <summary>How a task, ticket or error reached a node: by reference, or by the task board's label.</summary>
internal static class AtlasWorkVia
{
    public const string Ref = "ref";
    public const string Label = "label";
}
