namespace Pitwall.Domain;

/// <summary>
/// A support request a customer opened from inside one of the products, with the evidence the
/// product's browser SDK gathered for it: where they were, what the page logged, which requests
/// failed and with which trace ids. It belongs to the customer (the workspace, the company) —
/// everyone there sees it in the product — and is answered by the team in the Pitwall console.
///
/// Pitwall never holds the product's users: <see cref="CustomerRef"/> and
/// <see cref="OpenedByRef"/> are the product's own ids, and the names beside them are the
/// snapshot the product sent when the ticket was opened.
/// </summary>
public class Ticket
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    /// <summary>
    /// Human handle: the day it was opened plus four random characters (20260918-7K3Q). Reads as
    /// a date, does not count the tickets, and is what a customer quotes in an e-mail — or a
    /// developer in a commit message, which is how a release closes it.
    /// </summary>
    public string Code { get; set; } = null!;
    /// <summary>The product's id for the customer account (workspace, company, tenant).</summary>
    public string CustomerRef { get; set; } = null!;
    public string? CustomerName { get; set; }
    public string? OpenedByRef { get; set; }
    public string? OpenedByName { get; set; }
    /// <summary>Optional: only when the product chose to send it. Shown to the team, never to other customers.</summary>
    public string? OpenedByEmail { get; set; }
    public string Title { get; set; } = null!;
    public string Body { get; set; } = null!;
    public string Category { get; set; } = TicketCategories.Bug;
    public string Severity { get; set; } = TicketSeverities.Normal;
    public string Status { get; set; } = TicketStatuses.Open;
    public Guid? AssigneeId { get; set; }
    /// <summary>Screen the ticket was opened from (path + query, no host).</summary>
    public string? Route { get; set; }
    /// <summary>The bundle the browser attached at creation: context, log, requests, errors, events.</summary>
    public string? DiagnosticsJson { get; set; }
    public string[] TraceIds { get; set; } = [];
    /// <summary>
    /// Fingerprint of the first server error the trace ids resolved to — tickets sharing one are
    /// the same bug seen by different customers.
    /// </summary>
    public string? ErrorSignature { get; set; }
    /// <summary>The version, release or commit the fix shipped in.</summary>
    public string? FixedIn { get; set; }
    /// <summary>Team-only summary of the cause; never shown to the customer.</summary>
    public string? ResolutionNote { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? LastCustomerMessageAt { get; set; }
    public DateTime? LastTeamMessageAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public DateTime? ClosedAt { get; set; }

    public Product Product { get; set; } = null!;
    public StaffUser? Assignee { get; set; }
    public ICollection<TicketMessage> Messages { get; set; } = [];
    public ICollection<TicketAttachment> Attachments { get; set; } = [];

    /// <summary>Moves the ticket and keeps the resolved/closed stamps true to the status.</summary>
    public void ApplyStatus(string status, DateTime now)
    {
        Status = status;
        switch (status)
        {
            case TicketStatuses.Resolved:
                ResolvedAt ??= now;
                ClosedAt = null;
                break;
            case TicketStatuses.Closed:
                ResolvedAt ??= now;
                ClosedAt = now;
                break;
            default:
                ResolvedAt = null;
                ClosedAt = null;
                break;
        }
        UpdatedAt = now;
    }
}

/// <summary>One turn of the conversation. Internal messages are team notes the customer never sees.</summary>
public class TicketMessage
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public Guid ProductId { get; set; }
    /// <summary>True when written by the team from the console.</summary>
    public bool FromTeam { get; set; }
    public bool Internal { get; set; }
    /// <summary>The product's user id (customer side) or the staff id (team side).</summary>
    public string? AuthorRef { get; set; }
    public string? AuthorName { get; set; }
    public string Body { get; set; } = null!;
    public DateTime CreatedAt { get; set; }

    public Ticket Ticket { get; set; } = null!;
}

/// <summary>
/// A file on a ticket: an image, an arbitrary file, or a session recording. Bytes live in the
/// private blob store and are customer data: served only through the authenticated endpoints.
/// </summary>
public class TicketAttachment
{
    public Guid Id { get; set; }
    public Guid TicketId { get; set; }
    public Guid ProductId { get; set; }
    public Guid? MessageId { get; set; }
    public bool FromTeam { get; set; }
    public string? UploadedByRef { get; set; }
    /// <summary>image | file | recording</summary>
    public string Kind { get; set; } = AttachmentKinds.File;
    public string Name { get; set; } = null!;
    public string ContentType { get; set; } = "application/octet-stream";
    public long SizeBytes { get; set; }
    public string StorageKey { get; set; } = null!;
    /// <summary>Recording facts (duration, event count, masking, gzip) and its own diagnostics bundle.</summary>
    public string? MetaJson { get; set; }
    public DateTime CreatedAt { get; set; }

    public Ticket Ticket { get; set; } = null!;
}

public static class TicketStatuses
{
    public const string Open = "open";
    public const string InProgress = "in_progress";
    public const string WaitingCustomer = "waiting_customer";
    public const string FixedPendingDeploy = "fixed_pending_deploy";
    public const string Resolved = "resolved";
    public const string Closed = "closed";

    public static readonly string[] All = [Open, InProgress, WaitingCustomer, FixedPendingDeploy, Resolved, Closed];
    /// <summary>Statuses in which a ticket is still the team's work.</summary>
    public static readonly string[] Active = [Open, InProgress, WaitingCustomer, FixedPendingDeploy];

    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}

public static class TicketCategories
{
    public const string Bug = "bug";
    public static readonly string[] All = [Bug, "question", "feature", "billing", "other"];
    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}

public static class TicketSeverities
{
    public const string Normal = "normal";
    public static readonly string[] All = ["low", Normal, "high", "critical"];
    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}

public static class AttachmentKinds
{
    public const string Image = "image";
    public const string File = "file";
    public const string Recording = "recording";
    public static readonly string[] All = [Image, File, Recording];
}
