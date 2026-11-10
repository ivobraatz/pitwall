namespace Pitwall.Domain;

/*
 * The Atlas: the live picture of what the team runs. A system is a Product; around it the Atlas
 * keeps where it runs (environments and services), what those services lean on (links), where its
 * code is built (repositories), what runs by itself (routines and their runs) and what is being
 * worked on right now (activities). Every table starts empty: an installation fills its own.
 */

/// <summary>A column of the engine grid: <c>staging</c>, <c>production</c>.</summary>
public class AtlasEnvironment
{
    public Guid Id { get; set; }
    public string Slug { get; set; } = null!;
    public string Name { get; set; } = null!;
    public int Position { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// Something that runs: an API on a host, a site, a worker, a database — or, with no product and
/// no environment, an outside service several systems lean on (DNS, mail, payments).
/// </summary>
public class AtlasService
{
    public Guid Id { get; set; }
    /// <summary>Null = shared by the whole operation.</summary>
    public Guid? ProductId { get; set; }
    /// <summary>Null = not tied to an environment (an outside service).</summary>
    public Guid? EnvironmentId { get; set; }
    public string Name { get; set; } = null!;
    /// <summary>api | web | worker | database | site | external | other.</summary>
    public string Kind { get; set; } = AtlasServiceKinds.Other;
    /// <summary>Who runs it, lower case: <c>railway</c>, <c>vercel</c>, <c>vm</c>… Free text; collectors match on it.</summary>
    public string? Provider { get; set; }
    /// <summary>How the provider's collector finds it: <c>project/service</c> on Railway, the project name on Vercel.</summary>
    public string? ExternalRef { get; set; }
    public string? Url { get; set; }
    /// <summary>The name of its monitor in Uptime Kuma.</summary>
    public string? MonitorRef { get; set; }
    public string? Notes { get; set; }

    // What the collectors last saw. Never written by hand.
    /// <summary>up | down | pending | maintenance, from the monitor.</summary>
    public string? MonitorStatus { get; set; }
    /// <summary>success | failed | building | skipped | sleeping | removed, from the host.</summary>
    public string? DeployStatus { get; set; }
    public DateTime? LastDeployAt { get; set; }
    public string? CommitSha { get; set; }
    public DateTime? CheckedAt { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public Product? Product { get; set; }
    public AtlasEnvironment? Environment { get; set; }

    /// <summary>One word for the grid: a monitor that is down wins over a deploy that passed.</summary>
    public string State => MonitorStatus switch
    {
        "down" => AtlasStates.Down,
        _ when DeployStatus == "building" => AtlasStates.Deploying,
        _ when DeployStatus == "failed" => AtlasStates.Degraded,
        "up" => AtlasStates.Up,
        "maintenance" or "pending" => AtlasStates.Degraded,
        // A skipped deploy leaves the previous one serving; a sleeping service wakes on the next request.
        _ when DeployStatus is "success" or "skipped" or "sleeping" => AtlasStates.Up,
        _ => AtlasStates.Unknown,
    };
}

/// <summary>"This service uses that one": drawn as an edge of the map.</summary>
public class AtlasLink
{
    public Guid Id { get; set; }
    public Guid FromServiceId { get; set; }
    public Guid ToServiceId { get; set; }
    public string? Label { get; set; }
    public DateTime CreatedAt { get; set; }

    public AtlasService From { get; set; } = null!;
    public AtlasService To { get; set; } = null!;
}

/// <summary>A code repository and the last thing its pipeline did.</summary>
public class AtlasRepo
{
    public Guid Id { get; set; }
    public Guid? ProductId { get; set; }
    /// <summary><c>owner/name</c>, lower case.</summary>
    public string FullName { get; set; } = null!;

    public string? LastRunName { get; set; }
    /// <summary>success | failure | running | cancelled | other.</summary>
    public string? LastRunStatus { get; set; }
    public DateTime? LastRunAt { get; set; }
    public string? LastRunUrl { get; set; }
    public string? LastRunSha { get; set; }
    public int? Commits7d { get; set; }
    public int? Runs7d { get; set; }
    public int? FailedRuns7d { get; set; }
    /// <summary>Open dependency alerts; null = the token cannot read them.</summary>
    public int? OpenAlerts { get; set; }
    public DateTime? CheckedAt { get; set; }

    public DateTime CreatedAt { get; set; }
    public Product? Product { get; set; }
}

/// <summary>Something that runs by itself on a schedule. The text of what to do lives here, not in the code.</summary>
public class AtlasRoutine
{
    public Guid Id { get; set; }
    public Guid? ProductId { get; set; }
    public string Slug { get; set; } = null!;
    public string Name { get; set; } = null!;
    /// <summary>daily | weekly | monthly.</summary>
    public string Frequency { get; set; } = AtlasFrequencies.Daily;
    /// <summary>What it does, in a sentence, for the people reading the list.</summary>
    public string? Description { get; set; }
    /// <summary>The instructions the runner hands to the agent.</summary>
    public string Prompt { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public Product? Product { get; set; }
    public ICollection<AtlasRoutineRun> Runs { get; set; } = [];
}

public class AtlasRoutineRun
{
    public Guid Id { get; set; }
    public Guid RoutineId { get; set; }
    /// <summary>running | ok | failed.</summary>
    public string Status { get; set; } = AtlasRunStatuses.Running;
    public DateTime StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public string? Summary { get; set; }
    /// <summary>What it produced: pull requests, tasks, alerts.</summary>
    public List<AtlasRunLink> Links { get; set; } = [];
    public string ActorName { get; set; } = null!;

    public AtlasRoutine Routine { get; set; } = null!;
}

public class AtlasRunLink
{
    /// <summary>pr | task | alert | other.</summary>
    public string Kind { get; set; } = "other";
    public string Label { get; set; } = null!;
    public string? Url { get; set; }
}

/// <summary>Work in progress on a system: an agent session, a manual operation. Shown while it runs.</summary>
public class AtlasActivity
{
    public Guid Id { get; set; }
    public Guid? ProductId { get; set; }
    public Guid? ServiceId { get; set; }
    /// <summary>The part being touched, as the writer named it ("api", "billing page").</summary>
    public string? Component { get; set; }
    public string Description { get; set; } = null!;
    /// <summary>running | ok | failed.</summary>
    public string Status { get; set; } = AtlasRunStatuses.Running;
    public string? Result { get; set; }
    public string ActorName { get; set; } = null!;
    /// <summary>claude | manual, from how the writer signed in.</summary>
    public string Source { get; set; } = TeamTaskSources.Manual;
    public DateTime StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }

    public Product? Product { get; set; }
    public AtlasService? Service { get; set; }
}

/// <summary>Something a collector found that nobody registered: it stays in sight until it is registered or dismissed.</summary>
public class AtlasDiscovery
{
    public Guid Id { get; set; }
    /// <summary>The collector: railway | github | kuma | vercel.</summary>
    public string Source { get; set; } = null!;
    /// <summary>service | repo | monitor.</summary>
    public string Kind { get; set; } = null!;
    public string ExternalRef { get; set; } = null!;
    public string Name { get; set; } = null!;
    /// <summary>The environment the provider reports, when it has one.</summary>
    public string? Environment { get; set; }
    public string? Url { get; set; }
    public DateTime FirstSeenAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    public DateTime? DismissedAt { get; set; }
}

public static class AtlasStates
{
    public const string Up = "up";
    public const string Down = "down";
    public const string Deploying = "deploying";
    public const string Degraded = "degraded";
    public const string Unknown = "unknown";
}

public static class AtlasServiceKinds
{
    public const string External = "external";
    public const string Other = "other";
    public static readonly string[] All = ["api", "web", "worker", "database", "site", External, Other];
    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}

public static class AtlasFrequencies
{
    public const string Daily = "daily";
    public static readonly string[] All = [Daily, "weekly", "monthly"];
    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}

public static class AtlasRunStatuses
{
    public const string Running = "running";
    public const string Ok = "ok";
    public const string Failed = "failed";
    public static bool IsFinal(string? s) => s is Ok or Failed;
}
