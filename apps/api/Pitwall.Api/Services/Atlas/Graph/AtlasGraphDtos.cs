using System.Text.Json.Serialization;

namespace Pitwall.Services.Atlas.Graph;

/*
 * The graph's answers, shaped as the console reads them (apps/console/lib/atlas-graph.ts). Names go
 * out in camelCase; a null is sent as null, never left out, so the console can rely on every field.
 */

public sealed record SystemRef(Guid Id, string Slug, string Name, string? Color);

public sealed record AttentionDto(int Failure, int Security, int Task, int Improvement, int Config, int Unverified)
{
    public static readonly AttentionDto None = new(0, 0, 0, 0, 0, 0);
}

public sealed record ActivityDto(bool Running, string? Kind, DateTime? Since)
{
    public static readonly ActivityDto Idle = new(false, null, null);
}

public sealed record LastEventDto(string Type, DateTime At, string? Status, string Title);

public record GraphNodeDto(
    Guid Id, string Key, string Type, string Name, string Kind, string Engine, string? Group,
    Guid? ProductId, Guid? EnvironmentId, string? Environment, bool Shared, string? Provider, string? Url, string? Signature,
    string State, string Condition, string Origin, string Verification, string? CodeScope,
    DateTime? VerifiedAt, string? VerifiedBy, DateTime? CheckedAt, AttentionDto Attention, ActivityDto Activity, LastEventDto? LastEvent,
    DateTime? RetiredAt, DateTime? RemovalReportedAt, DateTime? MissingSince, DateTime CreatedAt, DateTime UpdatedAt);

public sealed record KeyValueDto(string Key, string Value);

/// <summary>The node of the detail: every field of a graph node, plus what only the detail carries.</summary>
public sealed record NodeDetailNode(
    Guid Id, string Key, string Type, string Name, string Kind, string Engine, string? Group,
    Guid? ProductId, Guid? EnvironmentId, string? Environment, bool Shared, string? Provider, string? Url, string? Signature,
    string State, string Condition, string Origin, string Verification, string? CodeScope,
    DateTime? VerifiedAt, string? VerifiedBy, DateTime? CheckedAt, AttentionDto Attention, ActivityDto Activity, LastEventDto? LastEvent,
    DateTime? RetiredAt, DateTime? RemovalReportedAt, DateTime? MissingSince, DateTime CreatedAt, DateTime UpdatedAt,
    string? Notes, List<KeyValueDto> Facts, List<string> Items, string? ExternalRef, string? Monitor, List<string> Aliases,
    string? Owner, string? Impact, string? DeployStatus, string? MonitorStatus, DateTime? LastDeployAt, string? CommitSha,
    List<KeyValueDto> Stack) : GraphNodeDto(
        Id, Key, Type, Name, Kind, Engine, Group, ProductId, EnvironmentId, Environment, Shared, Provider, Url, Signature,
        State, Condition, Origin, Verification, CodeScope, VerifiedAt, VerifiedBy, CheckedAt, Attention, Activity, LastEvent,
        RetiredAt, RemovalReportedAt, MissingSince, CreatedAt, UpdatedAt);

public sealed record GraphEdgeDto(
    string Id, Guid From, Guid To, string Relation, string Category, string? Label, bool Planned, string Origin,
    DateTime? VerifiedAt, DateTime? RetiredAt);

public sealed record SourceStatusDto(
    string Name, bool Connected, DateTime? LastRunAt, DateTime? LastOkAt, string? LastError, int? ItemsSeen, bool Stale);

public sealed record CoverageCheckDto(string Key, bool Ok, bool Applicable, string Label);

public sealed record CoverageDto(int Percent, List<CoverageCheckDto> Checks);

public sealed record GraphScopeDto(SystemRef? System, string? Environment);

public sealed record EngineDto(string Key, string Name, int Position);

public sealed record GraphResponseDto(
    DateTime ServerTime, GraphScopeDto Scope, List<EngineDto> Engines, List<GraphNodeDto> Nodes, List<GraphEdgeDto> Edges,
    List<SourceStatusDto> Sources, CoverageDto? Coverage);

public sealed record HealthDto(int Total, int Up, int Down, int Degraded, int Deploying, int Unknown);

public sealed record RunningDto(int Deploys, int Ci, int Agents, int Routines);

public sealed record PendingDto(int Tasks, int Tickets, int Errors, int? Alerts);

public sealed record SystemCardDto(
    Guid Id, string Slug, string Name, string? Color, string? Description, string State, bool Shared, int NodeCount,
    HealthDto Health, AttentionDto Attention, RunningDto Running, PendingDto Pending, CoverageDto Coverage);

public sealed record CompanyEdgeDto(Guid From, Guid To, int Count, List<string> Relations);

public sealed record CompanyGraphDto(
    DateTime ServerTime, List<SystemCardDto> Systems, List<GraphNodeDto> Shared, List<CompanyEdgeDto> Edges, List<SourceStatusDto> Sources);

public sealed record NodeRefDto(string Id, string Key, string Name, string Kind, string Engine, Guid? ProductId, string State);

public sealed record EvidenceDto(
    Guid Id, string Source, string Method, string Ref, string? Detail, string? Relation, string Scope, string? CommitSha,
    DateTime FirstSeenAt, DateTime LastSeenAt, DateTime? GoneAt);

public sealed record NodeRefLinkDto(
    Guid? Id, string Kind, string Code, string? Note, string? Title, string? Status,
    [property: JsonPropertyName("class")] string Class, string Via);

public sealed record AtlasEventDto(
    Guid Id, DateTime At, string Source, string Type, string? Status, string Title, string? Url, string? CommitSha, string? Detail,
    Guid? ProductId, Guid? ServiceId, Guid? RepoId);

public sealed record FieldChangeDto(string Field, string? Before, string? After);

public sealed record AtlasChangeDto(
    Guid Id, DateTime At, string Actor, string Source, Guid? ChangeSetId, string EntityType, Guid EntityId, Guid? ProductId,
    string Op, List<FieldChangeDto> Fields, string? Summary);

public sealed record RejectedDto(string Op, string Message);

public sealed record ChangeSetResultDto(
    List<string> Created, List<string> Updated, int Unchanged, List<string> Gone, List<string> RemovalsReported,
    List<RejectedDto> Rejected, List<string> Attention);

public sealed record ChangeSetDto(
    Guid Id, DateTime ReceivedAt, string Source, string? Tool, string? Repo, string? Branch, string? CommitSha, string Scope,
    string? Environment, string Actor, string Status, string? Summary, List<string> TaskCodes, ChangeSetResultDto Result);

public sealed record EdgeNodeDto(GraphEdgeDto Edge, NodeRefDto Node);

public sealed record ImpactDto(List<NodeRefDto> Direct, List<NodeRefDto> Indirect, List<SystemRef> Systems);

public sealed record RepoRefDto(
    Guid Id, string FullName, string? Role, string? LastRunStatus, DateTime? LastRunAt, string? LastRunUrl, DateTime? LastSyncAt);

public sealed record StepRefDto(string Slug, string Name, string Status);

public sealed record ProcessRefDto(Guid Id, string Slug, string Name, StepRefDto Step);

public sealed record NodeDetailDto(
    NodeDetailNode Node, SystemRef? System, List<EdgeNodeDto> Incoming, List<EdgeNodeDto> Outgoing, ImpactDto Impact,
    List<EvidenceDto> Evidence, List<NodeRefLinkDto> Refs, List<AtlasEventDto> Events, List<AtlasChangeDto> Changes,
    List<RepoRefDto> Repos, List<ProcessRefDto> Processes, List<ChangeSetDto> ChangeSets, string? ProviderUrl);

public sealed record InsightDto(string Id, string Rule, string Severity, string Title, string Detail, List<string> NodeIds, SystemRef? System);

public sealed record SnapshotDto(Guid Id, DateTime TakenAt, string Reason, int NodeCount, int EdgeCount);

public sealed record DiffEndDto(DateTime? At, Guid? SnapshotId);

public sealed record ChangedNodeDto(NodeRefDto Node, List<FieldChangeDto> Fields);

public sealed record DiffNodesDto(List<NodeRefDto> Added, List<NodeRefDto> Removed, List<ChangedNodeDto> Changed);

public sealed record DiffEdgeDto(string From, string To, string Relation);

public sealed record DiffEdgesDto(List<DiffEdgeDto> Added, List<DiffEdgeDto> Removed);

public sealed record GraphDiffDto(DiffEndDto From, DiffEndDto To, DiffNodesDto Nodes, DiffEdgesDto Edges);
