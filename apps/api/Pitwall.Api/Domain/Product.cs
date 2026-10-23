namespace Pitwall.Domain;

/// <summary>
/// One of the systems the team supports (DataRunner, RH Flex, metrifree…). Everything else in
/// Pitwall — tickets, server errors, release notes, webhooks — belongs to exactly one product,
/// and a product's backend can only ever reach its own rows: its keys carry its id.
/// </summary>
public class Product
{
    public Guid Id { get; set; }
    /// <summary>URL-safe handle (<c>datarunner</c>), used by the public changelog and in key prefixes.</summary>
    public string Slug { get; set; } = null!;
    public string Name { get; set; } = null!;
    /// <summary>
    /// What the product is, in a sentence or two. The release-note writer reads it to know who
    /// the readers are; the console shows it under the name.
    /// </summary>
    public string? Description { get; set; }
    /// <summary>Where events go (<c>https://api.datarunner.app/api/v1/webhooks/pitwall</c>); null = no webhooks.</summary>
    public string? WebhookUrl { get; set; }
    /// <summary>The HMAC secret, sealed with the instance key — Pitwall has to sign with it, so it cannot be a hash.</summary>
    public string? WebhookSecretSealed { get; set; }
    public ProductSettings Settings { get; set; } = new();
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    /// <summary>A disabled product's keys stop working; its history stays readable to the team.</summary>
    public DateTime? DisabledAt { get; set; }

    public ICollection<ProductKey> Keys { get; set; } = [];
}

/// <summary>Per-product knobs. Stored as one jsonb column: they are read together and change rarely.</summary>
public class ProductSettings
{
    /// <summary>The name the customer sees on team replies. Defaults to the product name.</summary>
    public string? TeamName { get; set; }
    /// <summary>
    /// Stack-frame markers that identify the product's own code (<c>DataRunner.</c>,
    /// <c>/apps/api/src/</c>). The error signature keys on the first frame that matches, so a
    /// framework frame at the top of the stack does not split one bug into many.
    /// </summary>
    public List<string> OwnFramePrefixes { get; set; } = [];
    /// <summary>Publish release notes as soon as they are written (true) or keep them as drafts for review.</summary>
    public bool AutoPublishReleases { get; set; } = true;
    /// <summary>Languages release notes are written in. The first is the primary one.</summary>
    public List<string> Locales { get; set; } = ["pt", "en"];
    /// <summary>Whether the browser keeps the rolling DOM buffer by default (the person can still turn it off).</summary>
    public bool RetroactiveRecording { get; set; } = true;
    /// <summary>Base URL of the product's own ticket screen, for links in the team's e-mails ("{id}" is replaced).</summary>
    public string? CustomerTicketUrl { get; set; }
}

/// <summary>
/// A credential a product's backend or its CI uses to talk to Pitwall. Only the hash is kept;
/// the plaintext is shown once, at creation. Scopes keep a leaked CI secret from reading tickets.
/// </summary>
public class ProductKey
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string Name { get; set; } = null!;
    /// <summary>The first characters of the key (<c>pw_datarunner_3fK9</c>), so the team can tell keys apart.</summary>
    public string Prefix { get; set; } = null!;
    public string Hash { get; set; } = null!;
    /// <summary>support | errors | releases</summary>
    public string[] Scopes { get; set; } = [];
    public DateTime CreatedAt { get; set; }
    public DateTime? LastUsedAt { get; set; }
    public DateTime? RevokedAt { get; set; }

    public Product Product { get; set; } = null!;
}

public static class KeyScopes
{
    /// <summary>The ticket bridge: everything a customer does from inside the product.</summary>
    public const string Support = "support";
    /// <summary>Reporting the product's own unhandled server errors.</summary>
    public const string Errors = "errors";
    /// <summary>The CI pipeline handing over commits for a release note.</summary>
    public const string Releases = "releases";

    public static readonly string[] All = [Support, Errors, Releases];
}
