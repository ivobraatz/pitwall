namespace Pitwall.Domain;

/// <summary>
/// A folder of the team's notes. Folders nest up to four levels; a note is in one folder or in the
/// entrance (no folder). Deleting a folder moves its notes and subfolders up first (see the endpoints).
/// </summary>
public class NoteFolder
{
    public Guid Id { get; set; }
    /// <summary>null = top level.</summary>
    public Guid? ParentId { get; set; }
    public string Name { get; set; } = null!;
    /// <summary>Order among its siblings, fractional like the board (see <c>TeamTaskPositions</c>).</summary>
    public double Position { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public NoteFolder? Parent { get; set; }
    public ICollection<NoteFolder> Children { get; set; } = [];
}

/// <summary>
/// A working draft of the team: an idea, a finding, an investigation, a procedure in the making.
/// Not a call and not a task; when it is structured it becomes a task on the board (<c>TaskId</c>).
/// </summary>
public class Note
{
    public Guid Id { get; set; }
    /// <summary><c>N-7K2QM</c>: a note's handle, what <c>[[N-7K2QM]]</c> links point at.</summary>
    public string Code { get; set; } = null!;
    public Guid? FolderId { get; set; }
    public Guid? ProductId { get; set; }
    public string Title { get; set; } = null!;
    /// <summary>Markdown. Free text: the steps and checklist are read only when the note is converted.</summary>
    public string Body { get; set; } = "";
    /// <summary>idea | shaping | ready | converted (see <see cref="NoteStages"/>).</summary>
    public string Stage { get; set; } = NoteStages.Idea;
    public string[] Labels { get; set; } = [];
    public bool Pinned { get; set; }
    /// <summary>claude | manual — from how the writer signed in, never from the request body.</summary>
    public string Source { get; set; } = TeamTaskSources.Manual;
    public string CreatedByRef { get; set; } = null!;
    public string CreatedByName { get; set; } = null!;
    public string UpdatedByName { get; set; } = null!;
    /// <summary>Where the last change came from; kept so the history can name it.</summary>
    public string UpdatedBySource { get; set; } = TeamTaskSources.Manual;
    /// <summary>The task created by the conversion; null until then. Cleared if that task is deleted.</summary>
    public Guid? TaskId { get; set; }
    public DateTime? ConvertedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    /// <summary>Off the list, still found by a search that asks for archived notes.</summary>
    public DateTime? ArchivedAt { get; set; }

    public NoteFolder? Folder { get; set; }
    public Product? Product { get; set; }
    public TeamTask? Task { get; set; }
    public ICollection<NoteRevision> Revisions { get; set; } = [];
}

/// <summary>What a note's title and body said before a change, so the history can bring it back.</summary>
public class NoteRevision
{
    public Guid Id { get; set; }
    public Guid NoteId { get; set; }
    public string Title { get; set; } = null!;
    public string Body { get; set; } = "";
    /// <summary>Who wrote the version kept here (the author before the change).</summary>
    public string AuthorName { get; set; } = null!;
    public string Source { get; set; } = TeamTaskSources.Manual;
    public DateTime CreatedAt { get; set; }

    public Note Note { get; set; } = null!;
}

public static class NoteStages
{
    /// <summary>A thought, not yet shaped.</summary>
    public const string Idea = "idea";
    /// <summary>Being structured: steps and verification are being written.</summary>
    public const string Shaping = "shaping";
    /// <summary>Structured enough to be converted into a task.</summary>
    public const string Ready = "ready";
    /// <summary>Became a task; set only by the conversion.</summary>
    public const string Converted = "converted";

    /// <summary>In pipeline order.</summary>
    public static readonly string[] All = [Idea, Shaping, Ready, Converted];
    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}
