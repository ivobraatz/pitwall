namespace Pitwall.Domain;

/// <summary>
/// One unhandled 5xx as a product's backend saw it, kept for a while so a ticket that carries
/// the trace id can show the team the stack trace beside the customer's recording, and so the
/// errors screen can group the same bug across customers.
/// </summary>
public class ServerError
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string TraceId { get; set; } = null!;
    public string? CustomerRef { get; set; }
    public string? UserRef { get; set; }
    public string Method { get; set; } = null!;
    public string Path { get; set; } = null!;
    /// <summary>The matched route template (<c>/api/v1/campaigns/{id}/send</c>), when the product knows it.</summary>
    public string? RouteTemplate { get; set; }
    public int StatusCode { get; set; }
    public string ExceptionType { get; set; } = null!;
    /// <summary>Sanitized by the product before it left — Pitwall never asks for raw driver messages.</summary>
    public string Message { get; set; } = null!;
    public string? StackTrace { get; set; }
    /// <summary>Hash of type + route + first own frame. Same bug, same signature.</summary>
    public string Signature { get; set; } = null!;
    public string? Release { get; set; }
    public string? Environment { get; set; }
    public DateTime OccurredAt { get; set; }
    public DateTime ReceivedAt { get; set; }
}

/// <summary>
/// One release of one product: the commits that went out together, and — once written — its
/// note in each language. The note is what customers read in the product's "what's new" and on
/// the public changelog.
/// </summary>
public class Release
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string Version { get; set; } = null!;
    /// <summary>draft | published</summary>
    public string Status { get; set; } = ReleaseStatuses.Draft;
    /// <summary>feature | improvement</summary>
    public string ChangeKind { get; set; } = "improvement";
    public string[] CommitShas { get; set; } = [];
    /// <summary>Ticket codes the commits mentioned: publishing the release resolves them.</summary>
    public string[] TicketCodes { get; set; } = [];
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? PublishedAt { get; set; }
    /// <summary>False for a backfilled release: history, not news for the bell.</summary>
    public bool Announce { get; set; } = true;

    public Product Product { get; set; } = null!;
    public ICollection<ReleaseNote> Notes { get; set; } = [];
}

public class ReleaseNote
{
    public Guid Id { get; set; }
    public Guid ReleaseId { get; set; }
    public string Locale { get; set; } = null!;
    public string Slug { get; set; } = null!;
    public string Title { get; set; } = null!;
    public string Summary { get; set; } = "";
    public string[] NewItems { get; set; } = [];
    public string[] Improvements { get; set; } = [];
    public string BodyMarkdown { get; set; } = "";

    public Release Release { get; set; } = null!;
}

public static class ReleaseStatuses
{
    public const string Draft = "draft";
    public const string Published = "published";
}

/// <summary>Someone on the team: answers tickets, reads errors, manages products.</summary>
public class StaffUser
{
    public Guid Id { get; set; }
    public string Email { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string PasswordHash { get; set; } = null!;
    /// <summary>admin | agent. Admins manage products, keys and the team.</summary>
    public string Role { get; set; } = StaffRoles.Agent;
    /// <summary>TOTP secret sealed with the instance key; null until the person enrolls.</summary>
    public string? TotpSecretSealed { get; set; }
    public bool TotpEnabled { get; set; }
    public bool MustChangePassword { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public DateTime? DisabledAt { get; set; }
}

public static class StaffRoles
{
    public const string Admin = "admin";
    public const string Agent = "agent";
}

/// <summary>A signed-in console session. Only the hash of the cookie value is stored.</summary>
public class StaffSession
{
    public Guid Id { get; set; }
    public Guid StaffId { get; set; }
    public string TokenHash { get; set; } = null!;
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }

    public StaffUser Staff { get; set; } = null!;
}

/// <summary>
/// An event on its way to a product's backend. Written in the same transaction as the change it
/// announces (an outbox), sent by the dispatcher with retries, kept for the delivery log.
/// </summary>
public class WebhookDelivery
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string Event { get; set; } = null!;
    public string PayloadJson { get; set; } = null!;
    /// <summary>pending | delivered | failed</summary>
    public string Status { get; set; } = WebhookStatuses.Pending;
    public int Attempts { get; set; }
    public DateTime NextAttemptAt { get; set; }
    public int? LastStatusCode { get; set; }
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? DeliveredAt { get; set; }
}

public static class WebhookStatuses
{
    public const string Pending = "pending";
    public const string Delivered = "delivered";
    public const string Failed = "failed";
}
