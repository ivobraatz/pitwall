namespace Pitwall.Services.Atlas.Graph;

/// <summary>
/// What would be hit if a node stopped: the nodes that depend on it, directly and through others.
/// Walks the edges backwards, only the dependency categories, at most six steps, and never twice
/// over the same node, so a cycle ends instead of looping. Monitoring and the like do not propagate.
/// </summary>
internal static class AtlasImpact
{
    public const int MaxDepth = 6;

    public static (List<GNode> Direct, List<GNode> Indirect) Of(AtlasGraphData data, Guid nodeId)
    {
        var dependents = new Dictionary<Guid, List<Guid>>();
        foreach (var e in data.ActiveEdges)
        {
            if (!AtlasGraphBuilder.ImpactCategories.Contains(e.Category)) continue;
            if (data.ById[e.From].IsRepo || data.ById[e.To].IsRepo) continue;
            if (!dependents.TryGetValue(e.To, out var list)) dependents[e.To] = list = [];
            list.Add(e.From);
        }

        var visited = new HashSet<Guid> { nodeId };
        var direct = new List<GNode>();
        var indirect = new List<GNode>();
        var frontier = new List<Guid> { nodeId };
        for (var depth = 1; depth <= MaxDepth && frontier.Count > 0; depth++)
        {
            var next = new List<Guid>();
            foreach (var current in frontier)
            {
                if (!dependents.TryGetValue(current, out var sources)) continue;
                foreach (var source in sources)
                {
                    if (!visited.Add(source)) continue;
                    next.Add(source);
                    var node = data.ById[source];
                    if (node.RetiredAt is not null) continue;
                    (depth == 1 ? direct : indirect).Add(node);
                }
            }
            frontier = next;
        }
        direct.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
        indirect.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
        return (direct, indirect);
    }
}
