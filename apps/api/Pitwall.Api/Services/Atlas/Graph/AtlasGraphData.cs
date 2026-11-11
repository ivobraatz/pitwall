using Pitwall.Domain;

namespace Pitwall.Services.Atlas.Graph;

/*
 * The in-memory picture the graph reads: every node (service or repository), every edge, and what
 * is linked to each node. Built once per request from a handful of queries; the answers are
 * projections of it. Nothing here is stored.
 */

/// <summary>A node: a service, or a repository (which the graph draws in the Code column).</summary>
internal sealed class GNode
{
    public required Guid Id { get; init; }
    public required string Key { get; init; }
    public required bool IsRepo { get; init; }
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Engine { get; set; } = AtlasEngines.App;
    public string? Group { get; set; }
    public Guid? ProductId { get; set; }
    public Guid? EnvironmentId { get; set; }
    public string? Environment { get; set; }
    public bool Shared { get; set; }
    public string? Provider { get; set; }
    public string? Url { get; set; }
    public string? Signature { get; set; }
    public string State { get; set; } = AtlasStates.Unknown;
    public string Condition { get; set; } = AtlasConditions.Ok;
    public string Origin { get; set; } = AtlasOrigins.Declared;
    public string Verification { get; set; } = AtlasVerification.Declared;
    public string? CodeScope { get; set; }
    public DateTime? VerifiedAt { get; set; }
    public string? VerifiedBy { get; set; }
    public DateTime? CheckedAt { get; set; }
    public AttentionDto Attention { get; set; } = AttentionDto.None;
    public ActivityDto Activity { get; set; } = ActivityDto.Idle;
    public LastEventDto? LastEvent { get; set; }
    public DateTime? RetiredAt { get; set; }
    public DateTime? RemovalReportedAt { get; set; }
    public DateTime? MissingSince { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    /// <summary>Evidence from repositories still seen, and all of it (gone ones included).</summary>
    public int LiveCodeEvidence { get; set; }
    public int AnyCodeEvidence { get; set; }
    /// <summary>Tasks, tickets and errors linked to the node, open ones only.</summary>
    public List<WorkLink> Work { get; } = [];

    public AtlasService? Service { get; init; }
    public AtlasRepo? Repo { get; init; }
}

/// <summary>An edge between two nodes. Links keep their id; derived edges use <c>repo:{id}&gt;{service}</c> or <c>ev:{evidence}</c>.</summary>
internal sealed record GEdge(
    string Id, Guid From, Guid To, string Relation, string Category, string? Label, bool Planned, string Origin,
    DateTime? VerifiedAt, DateTime? RetiredAt);

/// <summary>A task, ticket or error linked to a node, with the class it counts in (contract 1.7).</summary>
internal sealed record WorkLink(
    Guid? Id, string Kind, string Code, string? Note, string? Title, string? Status, string Class, string Via);

internal sealed record ProductInfo(Guid Id, string Slug, string Name, string? Color, string? Description, bool Active);

internal sealed class AtlasGraphData
{
    public required DateTime Now { get; init; }
    public required bool IncludeRetired { get; init; }
    public Dictionary<Guid, ProductInfo> Products { get; } = new();
    public Dictionary<Guid, string> EnvironmentSlugs { get; } = new();
    public List<GNode> Nodes { get; } = [];
    public Dictionary<Guid, GNode> ById { get; } = new();
    public Dictionary<string, GNode> ByKey { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<GEdge> Edges { get; } = [];
    public List<AtlasRepo> Repos { get; } = [];
    public List<AtlasStep> Steps { get; } = [];
    /// <summary>Agent sessions still open (recent ones only).</summary>
    public List<AtlasActivity> OpenActivities { get; } = [];
    /// <summary>The system of each routine run still going.</summary>
    public List<Guid?> RunningRoutineSystems { get; } = [];
    /// <summary>How many other systems depend on each system (impact categories only).</summary>
    public Dictionary<Guid, int> DependentSystems { get; } = new();

    public bool IsActiveNode(GNode n) => n.RetiredAt is null;

    public IEnumerable<GNode> ActiveNodes => Nodes.Where(IsActiveNode);

    /// <summary>Edges between nodes that are not retired.</summary>
    public IEnumerable<GEdge> ActiveEdges => Edges.Where(e => e.RetiredAt is null
        && ById.TryGetValue(e.From, out var f) && f.RetiredAt is null
        && ById.TryGetValue(e.To, out var t) && t.RetiredAt is null);

    public SystemRef? SystemOf(Guid? productId) =>
        productId is { } id && Products.TryGetValue(id, out var p) ? new SystemRef(p.Id, p.Slug, p.Name, p.Color) : null;
}
