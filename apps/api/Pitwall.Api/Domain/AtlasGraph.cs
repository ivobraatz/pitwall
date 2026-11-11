namespace Pitwall.Domain;

/*
 * The graph's own records: evidence (why the map says a thing exists), the history of changes
 * (append-only), the change sets an agent or a pipeline sent, references to tasks and tickets,
 * the operational events, the state of each source, and the snapshots the diff reads.
 */

/// <summary>
/// One reason the map believes a node, an edge or a repository exists: a manifest, a provider's
/// API, an agent's report, a person. Evidence goes away (GoneAt) when its source stops seeing it.
/// </summary>
public class AtlasEvidence
{
    public Guid Id { get; set; }
    /// <summary><c>service</c>, <c>link</c> or <c>repo</c>.</summary>
    public string SubjectType { get; set; } = null!;
    public Guid SubjectId { get; set; }
    /// <summary>Where it came from: <c>repo:acme-inc/rockets</c>, <c>collector:railway</c>, <c>agent</c>, <c>console</c>, <c>import</c>.</summary>
    public string Source { get; set; } = null!;
    /// <summary>manifest, env-example, workflow, config, api, webhook, report, manual.</summary>
    public string Method { get; set; } = null!;
    /// <summary>Where in the source: <c>package.json#dependencies.stripe</c>, <c>railway:acme/api@production</c>.</summary>
    public string Ref { get; set; } = null!;
    public string? Detail { get; set; }
    /// <summary>For code evidence: the relation the repository has with the node.</summary>
    public string? Relation { get; set; }
    /// <summary>The strongest scope seen (<see cref="AtlasScopes"/>).</summary>
    public string Scope { get; set; } = AtlasScopes.Declared;
    public string? CommitSha { get; set; }
    public Guid? ChangeSetId { get; set; }
    public DateTime FirstSeenAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    /// <summary>The source stopped seeing it at this instant. Cleared when it comes back.</summary>
    public DateTime? GoneAt { get; set; }
}

/// <summary>One line of history: who changed what, from where, when. Written by the change recorder, never edited.</summary>
public class AtlasChange
{
    public Guid Id { get; set; }
    public DateTime At { get; set; }
    /// <summary>The person, or "Name (Claude)" for a token, or "Sistema", "Importação", "Coletor".</summary>
    public string Actor { get; set; } = null!;
    /// <summary><c>console, mcp, import, collector, sync, system</c>.</summary>
    public string Source { get; set; } = null!;
    public Guid? ChangeSetId { get; set; }
    /// <summary><c>service, link, repo, process, step, routine, environment, system, ref</c>.</summary>
    public string EntityType { get; set; } = null!;
    public Guid EntityId { get; set; }
    public Guid? ProductId { get; set; }
    /// <summary><c>created, updated, retired, restored, renamed, deleted</c>.</summary>
    public string Op { get; set; } = null!;
    public List<AtlasFieldChange> Fields { get; set; } = [];
    public string? Summary { get; set; }
}

/// <summary>One field that moved, with its value before and after (each cut to 500 characters).</summary>
public class AtlasFieldChange
{
    public string Field { get; set; } = null!;
    public string? Before { get; set; }
    public string? After { get; set; }
}

/// <summary>
/// One request that changed the map, from an agent, a pipeline, a hook or the CLI. Its key makes a
/// retry a no-op; its result is kept so a replay answers the same thing.
/// </summary>
public class AtlasChangeSet
{
    public Guid Id { get; set; }
    public string IdempotencyKey { get; set; } = null!;
    /// <summary><c>agent, ci, git-hook, cli, github-scan, console</c>.</summary>
    public string Source { get; set; } = null!;
    public string? Tool { get; set; }
    public Guid? ProductId { get; set; }
    public Guid? RepoId { get; set; }
    public string? Repo { get; set; }
    public string? Branch { get; set; }
    public string? CommitSha { get; set; }
    public string Scope { get; set; } = AtlasScopes.Declared;
    public string? Environment { get; set; }
    public string Actor { get; set; } = null!;
    public Guid? ActivityId { get; set; }
    /// <summary>What was reported, already sanitized.</summary>
    public string? Summary { get; set; }
    public List<string> TaskCodes { get; set; } = [];
    /// <summary><c>applied, noop, partial, rejected</c>.</summary>
    public string Status { get; set; } = null!;
    public string? BundleHash { get; set; }
    public DateTime ReceivedAt { get; set; }
    public DateTime? AppliedAt { get; set; }
    /// <summary>The response the request got, as JSON text, kept for replays.</summary>
    public string Result { get; set; } = "{}";
}

/// <summary>A link from a node to a task, a ticket or an error, kept on the node. The task board's label links are read too.</summary>
public class AtlasRef
{
    public Guid Id { get; set; }
    public Guid ServiceId { get; set; }
    /// <summary><see cref="AtlasRefKinds"/>: task, ticket, error.</summary>
    public string Kind { get; set; } = null!;
    public string Code { get; set; } = null!;
    public string? Note { get; set; }
    public string Source { get; set; } = null!;
    public string CreatedBy { get; set; } = null!;
    public DateTime CreatedAt { get; set; }

    public AtlasService Service { get; set; } = null!;
}

/// <summary>Something that happened in an operational source: a deploy, a run, a monitor going down, a push, a sync.</summary>
public class AtlasEvent
{
    public Guid Id { get; set; }
    public DateTime At { get; set; }
    /// <summary><c>github, railway, vercel, kuma, cloudflare, agent, routine, sync</c>, and <c>github-webhook</c> for the webhook.</summary>
    public string Source { get; set; } = null!;
    /// <summary>ci.started, deploy.failed, monitor.down, pr.merged… (see the contract).</summary>
    public string Type { get; set; } = null!;
    public Guid? ProductId { get; set; }
    public Guid? ServiceId { get; set; }
    public Guid? RepoId { get; set; }
    /// <summary><c>started, succeeded, failed, info</c>.</summary>
    public string? Status { get; set; }
    public string Title { get; set; } = null!;
    public string? Url { get; set; }
    public string? CommitSha { get; set; }
    public string? Detail { get; set; }
    /// <summary>The provider's id for this event. Unique per source, so a repeated delivery is written once.</summary>
    public string? ExternalId { get; set; }
}

/// <summary>What a source last did: when it ran, when it last succeeded, what it saw, what went wrong.</summary>
public class AtlasSource
{
    /// <summary>The source's name, the primary key: <c>railway, github, kuma, vercel, cloudflare, github-webhook, sync</c>.</summary>
    public string Name { get; set; } = null!;
    public DateTime? LastRunAt { get; set; }
    public DateTime? LastOkAt { get; set; }
    public string? LastError { get; set; }
    public int? ItemsSeen { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>The structure of the map at one moment, for the diff and the timeline. Data is JSON: only structural fields, sorted by key.</summary>
public class AtlasSnapshot
{
    public Guid Id { get; set; }
    public DateTime TakenAt { get; set; }
    public string Reason { get; set; } = null!;
    /// <summary>SHA-256 of <see cref="Data"/>: a snapshot is only taken when it changes.</summary>
    public string Hash { get; set; } = null!;
    public int NodeCount { get; set; }
    public int EdgeCount { get; set; }
    public string Data { get; set; } = null!;
}
