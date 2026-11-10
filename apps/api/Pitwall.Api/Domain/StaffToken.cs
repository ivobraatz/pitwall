namespace Pitwall.Domain;

/// <summary>
/// A personal token of someone on the team, for tools that act on their behalf (the Pitwall MCP in
/// a Claude Code session). Only the hash is kept; the plaintext is shown once, at creation. It is
/// worth exactly what its scopes say — today, the task board and nothing else — and it stops
/// working the moment its owner is disabled.
/// </summary>
public class StaffToken
{
    public Guid Id { get; set; }
    public Guid StaffUserId { get; set; }
    /// <summary>Where it is used ("Claude Code no notebook"), so its owner knows which one to revoke.</summary>
    public string Name { get; set; } = null!;
    /// <summary>The first 12 characters (<c>pwt_ab12cd34</c>), to tell tokens apart in the list.</summary>
    public string Prefix { get; set; } = null!;
    public string Hash { get; set; } = null!;
    public string[] Scopes { get; set; } = [];
    public DateTime CreatedAt { get; set; }
    public DateTime? LastUsedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }

    public StaffUser StaffUser { get; set; } = null!;
}

public static class StaffTokenScopes
{
    /// <summary>The team's task board: <c>/v1/staff/tasks/*</c>.</summary>
    public const string Tasks = "tasks";
    /// <summary>The Atlas: <c>/v1/staff/atlas/*</c> (register systems and services, report activity and routine runs).</summary>
    public const string Atlas = "atlas";

    /// <summary>Server errors, read only: <c>/v1/staff/errors/recent</c>.</summary>
    public const string Errors = "errors";

    public static readonly string[] All = [Tasks, Atlas, Errors];
    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}
