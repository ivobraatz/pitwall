namespace Pitwall.Domain;

/// <summary>
/// A piece of the team's own work: something a person has to do by hand (a setting in a vendor's
/// panel, a test on a phone, a credential) that a coding session could not. It lives on the team's
/// board and nowhere else — never in a product, a customer's view, the changelog or a webhook,
/// which is why it is not a <see cref="Ticket"/>.
/// </summary>
public class TeamTask
{
    public Guid Id { get; set; }
    /// <summary>The system it is about; null = the team's general work.</summary>
    public Guid? ProductId { get; set; }
    /// <summary><c>T-7K2QM</c>: never shaped like a ticket code, so a commit that cites it closes nothing.</summary>
    public string Code { get; set; } = null!;
    public string Title { get; set; } = null!;
    /// <summary>Markdown: why, the exact steps, and how to tell it worked.</summary>
    public string Body { get; set; } = "";
    public string Status { get; set; } = TeamTaskStatuses.Todo;
    /// <summary>Order inside the column, fractional so a move touches one row (see <c>TeamTaskPositions</c>).</summary>
    public double Position { get; set; }
    public string Priority { get; set; } = TeamTaskPriorities.Normal;
    public string[] Labels { get; set; } = [];
    public DateOnly? DueDate { get; set; }
    public Guid? AssigneeId { get; set; }
    /// <summary>claude | manual — from how the writer signed in, never from the request body.</summary>
    public string Source { get; set; } = TeamTaskSources.Manual;
    public string CreatedByRef { get; set; } = null!;
    public string CreatedByName { get; set; } = null!;
    /// <summary>What the person saw go wrong. Required to enter <c>blocked</c>, cleared on leaving it (the event keeps it).</summary>
    public string? BlockedNote { get; set; }
    public List<TeamTaskChecklistItem> Checklist { get; set; } = [];
    public List<TeamTaskLink> Links { get; set; } = [];
    /// <summary>Changes on every write, comments and moves included: the board's delta keys on it.</summary>
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DoneAt { get; set; }
    /// <summary>Off the board, still found by a search that asks for archived tasks.</summary>
    public DateTime? ArchivedAt { get; set; }

    public Product? Product { get; set; }
    public StaffUser? Assignee { get; set; }
    public ICollection<TeamTaskComment> Comments { get; set; } = [];
    public ICollection<TeamTaskEvent> Events { get; set; } = [];

    /// <summary>Changes the column and keeps <see cref="DoneAt"/> and <see cref="BlockedNote"/> true to it.</summary>
    public void ApplyStatus(string status, string? blockedNote, DateTime now)
    {
        if (status == TeamTaskStatuses.Done) DoneAt ??= now;
        else DoneAt = null;
        BlockedNote = status == TeamTaskStatuses.Blocked ? blockedNote : null;
        Status = status;
        UpdatedAt = now;
    }
}

public class TeamTaskChecklistItem
{
    public string Id { get; set; } = null!;
    public string Text { get; set; } = null!;
    public bool Done { get; set; }
}

public class TeamTaskLink
{
    public string Label { get; set; } = null!;
    public string Url { get; set; } = null!;
}

/// <summary>A note on a task, from a person or from Claude. Written once: never edited or removed.</summary>
public class TeamTaskComment
{
    public Guid Id { get; set; }
    public Guid TaskId { get; set; }
    public string AuthorRef { get; set; } = null!;
    public string AuthorName { get; set; } = null!;
    public string Source { get; set; } = TeamTaskSources.Manual;
    public string Body { get; set; } = null!;
    public DateTime CreatedAt { get; set; }

    public TeamTask Task { get; set; } = null!;
}

/// <summary>
/// What happened to a task, apart from what people wrote on it: "what changed since yesterday"
/// is a filter on these, not a parse of comments.
/// </summary>
public class TeamTaskEvent
{
    public Guid Id { get; set; }
    public Guid TaskId { get; set; }
    public string ActorRef { get; set; } = null!;
    public string ActorName { get; set; } = null!;
    public string Source { get; set; } = TeamTaskSources.Manual;
    public string Kind { get; set; } = null!;
    /// <summary>jsonb: <c>{from,to}</c> for moved, <c>{fields}</c> for updated, <c>{note}</c> for blocked.</summary>
    public string? Data { get; set; }
    public DateTime CreatedAt { get; set; }

    public TeamTask Task { get; set; } = null!;
}

public static class TeamTaskStatuses
{
    public const string Todo = "todo";
    public const string Doing = "doing";
    public const string Blocked = "blocked";
    public const string Done = "done";

    /// <summary>In board order.</summary>
    public static readonly string[] All = [Todo, Doing, Blocked, Done];
    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}

public static class TeamTaskPriorities
{
    public const string Low = "low";
    public const string Normal = "normal";
    public const string High = "high";

    public static readonly string[] All = [Low, Normal, High];
    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}

public static class TeamTaskSources
{
    public const string Claude = "claude";
    public const string Manual = "manual";

    public static readonly string[] All = [Claude, Manual];
    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}

public static class TeamTaskEventKinds
{
    public const string Created = "created";
    public const string Moved = "moved";
    public const string Updated = "updated";
    public const string Blocked = "blocked";
    public const string Archived = "archived";
    public const string Unarchived = "unarchived";
    public const string Commented = "commented";

    public static readonly string[] All = [Created, Moved, Updated, Blocked, Archived, Unarchived, Commented];
    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}
