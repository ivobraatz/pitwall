namespace Pitwall.Services.Atlas.Sync;

/// <summary>The body of <c>POST /v1/staff/atlas/sync</c> (contract 3). Names are camelCase on the wire.</summary>
public sealed record SyncRequest(
    string? IdempotencyKey, string? Source, string? Tool, string? Repo, string? System, string? Branch, string? CommitSha,
    string? Scope, string? Environment, string? ActivityId, List<SyncFile?>? Files, string? BundleHash, bool? Partial, SyncReport? Report);

/// <summary>One file of the package. No <see cref="Content"/> means presence only.</summary>
public sealed record SyncFile(string? Path, string? Content);

public sealed record SyncReport(
    string? Summary, List<string>? Created, List<string>? Changed, List<string>? Removed, List<string>? Attention,
    List<string>? Tasks, List<SyncOp?>? Ops);

/// <summary>
/// One report operation. <see cref="Op"/> says which fields matter: <c>node</c>, <c>edge</c>, <c>removed</c>, <c>task</c>.
/// One record for all four keeps the binding simple; the reconciler reads only the fields of its kind.
/// </summary>
public sealed record SyncOp(
    string? Op, string? Key, string? Name, string? Kind, string? Engine, string? Environment, string? Provider, string? Url,
    string? Group, string? Signature, Dictionary<string, string>? Facts, string? Evidence,
    string? From, string? To, string? Relation, string? Ref, string? Code, string? Note);

public sealed record SyncRejection(string Op, string Message);

/// <summary>The response of a sync (contract 3). A replay returns the same one with <see cref="Replayed"/> set.</summary>
public sealed record SyncResponse(
    string ChangeSetId, string Status, bool Replayed, List<string> Created, List<string> Updated, int Unchanged,
    List<string> Gone, List<string> RemovalsReported, List<SyncRejection> Rejected, List<string> Attention);

/// <summary>A request the sync refuses as a whole: the status code and the message in Portuguese for the person.</summary>
public sealed class AtlasSyncRejected(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
