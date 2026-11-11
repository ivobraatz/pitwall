namespace Pitwall.Domain;

/*
 * The graph's vocabulary: the engines (columns of the map), the relations between nodes and
 * their categories, where a fact came from and how strong the evidence for it is. The same
 * values are spelled out in the console (apps/console/lib/atlas-graph.ts) and in the SQL of the
 * migration, so changing one means changing all three.
 */

public static class AtlasEngines
{
    public const string Code = "code";
    public const string Delivery = "delivery";
    public const string Infra = "infra";
    public const string App = "app";
    public const string Automation = "automation";
    public const string Business = "business";
    public const string Marketing = "marketing";
    public const string Monitoring = "monitoring";
    public const string Security = "security";

    /// <summary>In map order: the left column first.</summary>
    public static readonly string[] All =
        [Code, Delivery, Infra, App, Automation, Business, Marketing, Monitoring, Security];

    private static readonly Dictionary<string, (string Pt, string En)> Names = new()
    {
        [Code] = ("Código", "Code"),
        [Delivery] = ("Entrega", "Delivery"),
        [Infra] = ("Infraestrutura", "Infrastructure"),
        [App] = ("Aplicação e dados", "Application & data"),
        [Automation] = ("Automações e agentes", "Automation & agents"),
        [Business] = ("Financeiro", "Business"),
        [Marketing] = ("Marketing", "Marketing"),
        [Monitoring] = ("Monitoramento e suporte", "Monitoring & support"),
        [Security] = ("Segurança", "Security"),
    };

    /// <summary>The kind's default engine (the table in the contract, 1.2). An unknown kind reads as an application.</summary>
    private static readonly Dictionary<string, string> ByKind = new()
    {
        ["package"] = Code,
        ["pipeline"] = Delivery, ["host"] = Delivery,
        ["domain"] = Infra, ["dns"] = Infra, ["cdn"] = Infra, ["edge"] = Infra, ["certificate"] = Infra, ["external"] = Infra,
        ["web"] = App, ["app"] = App, ["api"] = App, ["worker"] = App, ["database"] = App, ["storage"] = App,
        ["queue"] = App, ["cache"] = App, ["backup"] = App, ["other"] = App,
        ["agent"] = Automation, ["cron"] = Automation, ["webhook"] = Automation, ["integration"] = Automation,
        ["payment"] = Business, ["fiscal"] = Business,
        ["site"] = Marketing, ["seo"] = Marketing, ["analytics"] = Marketing,
        ["monitor"] = Monitoring, ["email"] = Monitoring,
        ["credential"] = Security, ["vault"] = Security,
    };

    public static bool IsValid(string? s) => s is not null && All.Contains(s);

    public static string NamePt(string engine) => Names.TryGetValue(engine, out var n) ? n.Pt : engine;

    public static string NameEn(string engine) => Names.TryGetValue(engine, out var n) ? n.En : engine;

    /// <summary>Position of the engine's column, from the left.</summary>
    public static int Position(string engine) => Array.IndexOf(All, engine);

    public static string ForKind(string? kind) => kind is not null && ByKind.TryGetValue(kind, out var engine) ? engine : App;
}

public static class AtlasRelations
{
    public const string DependsOn = "depends_on";
    public const string HostedOn = "hosted_on";

    /// <summary>All relations, in the order of the contract (1.3).</summary>
    public static readonly string[] All =
    [
        "depends_on", "hosted_on", "deploys_to", "resolves_dns", "protected_by", "backed_up_by",
        "calls", "reads_from", "writes_to",
        "billed_through", "issues_invoice_via", "sends_email_via",
        "triggers", "schedules",
        "monitored_by", "reports_to", "tracked_by", "indexed_by", "owned_by",
        "uses_credential_ref",
    ];

    private static readonly Dictionary<string, string> Categories = new()
    {
        ["depends_on"] = AtlasEdgeCategories.Infra, ["hosted_on"] = AtlasEdgeCategories.Infra, ["deploys_to"] = AtlasEdgeCategories.Infra,
        ["resolves_dns"] = AtlasEdgeCategories.Infra, ["protected_by"] = AtlasEdgeCategories.Infra, ["backed_up_by"] = AtlasEdgeCategories.Infra,
        ["calls"] = AtlasEdgeCategories.Data, ["reads_from"] = AtlasEdgeCategories.Data, ["writes_to"] = AtlasEdgeCategories.Data,
        ["billed_through"] = AtlasEdgeCategories.Business, ["issues_invoice_via"] = AtlasEdgeCategories.Business, ["sends_email_via"] = AtlasEdgeCategories.Business,
        ["triggers"] = AtlasEdgeCategories.Trigger, ["schedules"] = AtlasEdgeCategories.Trigger,
        ["monitored_by"] = AtlasEdgeCategories.Operational, ["reports_to"] = AtlasEdgeCategories.Operational, ["tracked_by"] = AtlasEdgeCategories.Operational,
        ["indexed_by"] = AtlasEdgeCategories.Operational, ["owned_by"] = AtlasEdgeCategories.Operational,
        ["uses_credential_ref"] = AtlasEdgeCategories.Security,
    };

    /// <summary>The old link kinds, read as relations (the migration and the requests that send only a kind).</summary>
    private static readonly Dictionary<string, string> FromKinds = new()
    {
        ["host"] = "hosted_on", ["dns"] = "resolves_dns", ["storage"] = "writes_to", ["payment"] = "billed_through",
        ["email"] = "sends_email_via", ["ai"] = "calls", ["login"] = "depends_on", ["measure"] = "tracked_by",
        ["monitor"] = "monitored_by", ["support"] = "reports_to", ["deploy"] = "deploys_to", ["integration"] = "calls",
        ["business"] = "depends_on",
    };

    public static bool IsValid(string? s) => s is not null && All.Contains(s);

    /// <summary>The category of the edge. An unknown relation reads as <c>depends_on</c>.</summary>
    public static string Category(string? relation) =>
        relation is not null && Categories.TryGetValue(relation, out var c) ? c : AtlasEdgeCategories.Infra;

    /// <summary>The relation a link of the old kind means. No kind, or one not known, means <c>depends_on</c>.</summary>
    public static string FromLinkKind(string? kind) =>
        kind is not null && FromKinds.TryGetValue(kind, out var relation) ? relation : DependsOn;
}

public static class AtlasEdgeCategories
{
    public const string Infra = "infra";
    public const string Data = "data";
    public const string Business = "business";
    public const string Trigger = "trigger";
    public const string Operational = "operational";
    public const string Security = "security";
    public static readonly string[] All = [Infra, Data, Business, Trigger, Operational, Security];
}

/// <summary>Who affirmed that a node or an edge exists. A later source can make it stronger, never weaker.</summary>
public static class AtlasOrigins
{
    public const string Declared = "declared";
    public const string Discovered = "discovered";
    public const string Reported = "reported";
    public const string Observed = "observed";
    public static readonly string[] All = [Declared, Discovered, Reported, Observed];

    public static bool IsValid(string? s) => s is not null && All.Contains(s);

    /// <summary>observed &gt; declared &gt; discovered &gt; reported. Unknown is the weakest.</summary>
    public static int Rank(string? origin) => origin switch
    {
        Observed => 4,
        Declared => 3,
        Discovered => 2,
        Reported => 1,
        _ => 0,
    };

    /// <summary>The stronger of the two. On a tie, the current one stays.</summary>
    public static string Stronger(string current, string incoming) => Rank(incoming) > Rank(current) ? incoming : current;
}

/// <summary>How far the evidence reaches: on this machine, on the remote, deployed, seen by the provider, or said by a person.</summary>
public static class AtlasScopes
{
    public const string Local = "local";
    public const string Pushed = "pushed";
    public const string Deployed = "deployed";
    public const string Runtime = "runtime";
    public const string Declared = "declared";
    public static readonly string[] All = [Local, Pushed, Deployed, Runtime, Declared];

    public static bool IsValid(string? s) => s is not null && All.Contains(s);

    /// <summary>runtime &gt; deployed &gt; pushed &gt; local. Declared stands apart: any measured scope beats it.</summary>
    public static int Rank(string? scope) => scope switch
    {
        Runtime => 4,
        Deployed => 3,
        Pushed => 2,
        Local => 1,
        _ => 0,
    };

    /// <summary>The stronger of the two. On a tie, the current one stays.</summary>
    public static string Stronger(string current, string incoming) => Rank(incoming) > Rank(current) ? incoming : current;
}

/// <summary>
/// Verification is never stored: it is read from the timestamps, the origin and the code evidence
/// on each request, so it can never say "verified" after the proof went away.
/// </summary>
public static class AtlasVerification
{
    public const string Verified = "verified";
    public const string Stale = "stale";
    public const string FoundInCode = "found_in_code";
    public const string NotFound = "not_found";
    public const string Reported = "reported";
    public const string Declared = "declared";

    public static readonly TimeSpan Fresh = TimeSpan.FromHours(48);

    /// <param name="verifiedAt">The last confirmation by a provider's collector.</param>
    /// <param name="missingSince">The collector listed the provider and did not find it.</param>
    /// <param name="removalReportedAt">Someone or something reported it gone; waiting for a person.</param>
    /// <param name="liveCodeEvidence">Code evidence (repo:*) that is still seen.</param>
    /// <param name="anyCodeEvidence">All code evidence, including the ones that went away.</param>
    public static string Derive(
        DateTime? verifiedAt, DateTime? missingSince, DateTime? removalReportedAt, string origin,
        int liveCodeEvidence, int anyCodeEvidence, DateTime now)
    {
        if (removalReportedAt is not null || missingSince is not null) return NotFound;
        if (verifiedAt is { } at && at >= now - Fresh) return Verified;
        if (verifiedAt is not null) return Stale;
        if (liveCodeEvidence > 0) return FoundInCode;
        if (anyCodeEvidence > 0 && origin == AtlasOrigins.Discovered) return NotFound;
        if (origin == AtlasOrigins.Reported) return Reported;
        return Declared;
    }

    public static string LabelPt(string verification) => verification switch
    {
        Verified => "verificado",
        Stale => "verificação antiga",
        FoundInCode => "encontrado no código",
        NotFound => "não encontrado",
        Reported => "relatado por agente",
        _ => "declarado",
    };
}

/// <summary>What needs attention on a node, by class (contract 1.7). Only failure is red.</summary>
public static class AtlasAttentionClasses
{
    public const string Failure = "failure";
    public const string Security = "security";
    public const string Task = "task";
    public const string Improvement = "improvement";
    public const string Config = "config";
    public const string Unverified = "unverified";
    public static readonly string[] All = [Failure, Security, Task, Improvement, Config, Unverified];

    public static bool IsRed(string attentionClass) => attentionClass == Failure;
}

/// <summary>What a node can be linked to outside the graph: a task, a ticket or an error (AtlasRef).</summary>
public static class AtlasRefKinds
{
    public const string Task = "task";
    public const string Ticket = "ticket";
    public const string Error = "error";
    public static readonly string[] All = [Task, Ticket, Error];

    public static bool IsValid(string? s) => s is not null && All.Contains(s);
}
