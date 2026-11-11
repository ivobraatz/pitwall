using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas.Graph;

/// <summary>
/// The structure of the map at one moment, kept so two moments can be compared. Only structural
/// fields, sorted by key: the same map always gives the same bytes and the same hash.
/// </summary>
internal static class AtlasSnapshots
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>The fields compared for "changed": what a person would call the node's identity and placement.</summary>
    private static readonly (string Field, Func<SnapNode, string?> Get)[] CompareFields =
    [
        ("name", n => n.Name), ("kind", n => n.Kind), ("engine", n => n.Engine), ("productId", n => n.ProductId),
        ("environment", n => n.Environment), ("provider", n => n.Provider), ("condition", n => n.Condition),
        ("group", n => n.Group), ("origin", n => n.Origin),
    ];

    public sealed record SnapNode(
        string Key, string Name, string Kind, string Engine, string? ProductId, string? Environment, string? Provider,
        string Condition, string? Group, string Origin);

    public sealed record SnapEdge(string From, string To, string Relation, bool Planned);

    public sealed record SnapData(List<SnapNode> Nodes, List<SnapEdge> Edges);

    /// <summary>The structure of the active map: retired nodes and edges are not part of it.</summary>
    public static SnapData Structure(AtlasGraphData data)
    {
        var nodes = data.ActiveNodes
            .Select(n => new SnapNode(n.Key, n.Name, n.Kind, n.Engine, n.ProductId?.ToString("D"), n.Environment, n.Provider,
                n.Condition, n.Group, n.Origin))
            .OrderBy(n => n.Key, StringComparer.Ordinal).ToList();
        var edges = data.ActiveEdges
            .Select(e => new SnapEdge(data.ById[e.From].Key, data.ById[e.To].Key, e.Relation, e.Planned))
            .OrderBy(e => e.From, StringComparer.Ordinal).ThenBy(e => e.To, StringComparer.Ordinal)
            .ThenBy(e => e.Relation, StringComparer.Ordinal)
            .ToList();
        return new SnapData(nodes, edges);
    }

    public static string Serialize(SnapData data) => JsonSerializer.Serialize(data, Options);

    public static SnapData? Parse(string json) => JsonSerializer.Deserialize<SnapData>(json, Options);

    public static string Hash(string json) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();

    /// <summary>
    /// Takes a snapshot unless the map is the same as the last one. Returns null when nothing changed,
    /// so a poll that finds the same map does not write a copy of it.
    /// </summary>
    public static async Task<AtlasSnapshot?> TakeAsync(PitwallDb db, string reason, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var data = await AtlasGraphBuilder.LoadAsync(db, now, false, ct);
        var structure = Structure(data);
        var json = Serialize(structure);
        var hash = Hash(json);
        var last = await db.AtlasSnapshots.AsNoTracking().OrderByDescending(s => s.TakenAt).Select(s => s.Hash).FirstOrDefaultAsync(ct);
        if (last == hash) return null;

        var snapshot = new AtlasSnapshot
        {
            Id = Guid.NewGuid(), TakenAt = now, Reason = Clean.Cut(reason, 40) ?? "manual", Hash = hash,
            NodeCount = structure.Nodes.Count, EdgeCount = structure.Edges.Count, Data = json,
        };
        db.AtlasSnapshots.Add(snapshot);
        await db.SaveChangesAsync(ct);
        return snapshot;
    }

    /// <summary>
    /// What changed between two structures. Node ids come from the current map (retired ones too),
    /// so a node that is gone still carries the id the console knows it by.
    /// </summary>
    public static GraphDiffDto Diff(
        SnapData? from, SnapData to, AtlasGraphData index, Guid? systemId, DiffEndDto fromEnd, DiffEndDto toEnd)
    {
        var sys = systemId?.ToString("D");
        bool Keep(SnapNode n) => sys is null || n.ProductId == sys;

        var toNodes = to.Nodes.Where(Keep).ToDictionary(n => n.Key, StringComparer.Ordinal);
        var fromNodes = (from?.Nodes ?? []).Where(Keep).ToDictionary(n => n.Key, StringComparer.Ordinal);

        NodeRefDto Ref(SnapNode n)
        {
            var productId = n.ProductId is null ? (Guid?)null : Guid.Parse(n.ProductId);
            if (index.ByKey.TryGetValue(n.Key, out var live))
                return new NodeRefDto(live.Id.ToString("D"), n.Key, n.Name, n.Kind, n.Engine, productId, live.State);
            return new NodeRefDto(n.Key, n.Key, n.Name, n.Kind, n.Engine, productId, AtlasStates.Unknown);
        }
        string IdOf(string key) => index.ByKey.TryGetValue(key, out var n) ? n.Id.ToString("D") : key;

        var added = toNodes.Values.Where(n => !fromNodes.ContainsKey(n.Key)).Select(Ref).ToList();
        var removed = fromNodes.Values.Where(n => !toNodes.ContainsKey(n.Key)).Select(Ref).ToList();
        var changed = new List<ChangedNodeDto>();
        foreach (var (key, after) in toNodes)
        {
            if (!fromNodes.TryGetValue(key, out var before)) continue;
            var fields = CompareFields
                .Where(f => f.Get(before) != f.Get(after))
                .Select(f => new FieldChangeDto(f.Field, f.Get(before), f.Get(after))).ToList();
            if (fields.Count > 0) changed.Add(new ChangedNodeDto(Ref(after), fields));
        }

        var fromEdges = (from?.Edges ?? []).Where(e => fromNodes.ContainsKey(e.From) && fromNodes.ContainsKey(e.To)).ToList();
        var toEdges = to.Edges.Where(e => toNodes.ContainsKey(e.From) && toNodes.ContainsKey(e.To)).ToList();
        var fromSet = fromEdges.Select(e => (e.From, e.To, e.Relation)).ToHashSet();
        var toSet = toEdges.Select(e => (e.From, e.To, e.Relation)).ToHashSet();
        var edgesAdded = toEdges.Where(e => !fromSet.Contains((e.From, e.To, e.Relation)))
            .Select(e => new DiffEdgeDto(IdOf(e.From), IdOf(e.To), e.Relation)).ToList();
        var edgesRemoved = fromEdges.Where(e => !toSet.Contains((e.From, e.To, e.Relation)))
            .Select(e => new DiffEdgeDto(IdOf(e.From), IdOf(e.To), e.Relation)).ToList();

        return new GraphDiffDto(fromEnd, toEnd, new DiffNodesDto(added, removed, changed), new DiffEdgesDto(edgesAdded, edgesRemoved));
    }
}
