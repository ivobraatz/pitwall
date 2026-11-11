using Pitwall.Domain;

namespace Pitwall.Tests;

/// <summary>The graph's vocabulary as pure rules: no database, no server.</summary>
public class AtlasVocabularyTests
{
    private static readonly DateTime Now = new(2026, 11, 11, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Every_kind_has_an_engine_and_the_engines_are_in_map_order()
    {
        var expected = new Dictionary<string, string>
        {
            ["package"] = "code",
            ["pipeline"] = "delivery", ["host"] = "delivery",
            ["domain"] = "infra", ["dns"] = "infra", ["cdn"] = "infra", ["edge"] = "infra", ["certificate"] = "infra", ["external"] = "infra",
            ["web"] = "app", ["app"] = "app", ["api"] = "app", ["worker"] = "app", ["database"] = "app", ["storage"] = "app",
            ["queue"] = "app", ["cache"] = "app", ["backup"] = "app", ["other"] = "app",
            ["agent"] = "automation", ["cron"] = "automation", ["webhook"] = "automation", ["integration"] = "automation",
            ["payment"] = "business", ["fiscal"] = "business",
            ["site"] = "marketing", ["seo"] = "marketing", ["analytics"] = "marketing",
            ["monitor"] = "monitoring", ["email"] = "monitoring",
            ["credential"] = "security", ["vault"] = "security",
        };
        Assert.Equal(expected.Count, AtlasServiceKinds.All.Length);
        foreach (var kind in AtlasServiceKinds.All)
            Assert.Equal(expected[kind], AtlasEngines.ForKind(kind));

        Assert.Equal(["code", "delivery", "infra", "app", "automation", "business", "marketing", "monitoring", "security"], AtlasEngines.All);
        Assert.Equal(0, AtlasEngines.Position("code"));
        Assert.Equal(8, AtlasEngines.Position("security"));
        Assert.Equal("app", AtlasEngines.ForKind("tipo-que-não-existe"));
        Assert.Equal("app", AtlasEngines.ForKind(null));
        Assert.Equal("Aplicação e dados", AtlasEngines.NamePt("app"));
        Assert.Equal("Application & data", AtlasEngines.NameEn("app"));
        Assert.True(AtlasEngines.IsValid("monitoring"));
        Assert.False(AtlasEngines.IsValid("Monitoring"));
    }

    [Fact]
    public void Every_relation_has_a_category_and_the_old_kinds_map_to_relations()
    {
        var categories = new Dictionary<string, string>
        {
            ["depends_on"] = "infra", ["hosted_on"] = "infra", ["deploys_to"] = "infra",
            ["resolves_dns"] = "infra", ["protected_by"] = "infra", ["backed_up_by"] = "infra",
            ["calls"] = "data", ["reads_from"] = "data", ["writes_to"] = "data",
            ["billed_through"] = "business", ["issues_invoice_via"] = "business", ["sends_email_via"] = "business",
            ["triggers"] = "trigger", ["schedules"] = "trigger",
            ["monitored_by"] = "operational", ["reports_to"] = "operational", ["tracked_by"] = "operational",
            ["indexed_by"] = "operational", ["owned_by"] = "operational",
            ["uses_credential_ref"] = "security",
        };
        Assert.Equal(categories.Count, AtlasRelations.All.Length);
        foreach (var relation in AtlasRelations.All)
            Assert.Equal(categories[relation], AtlasRelations.Category(relation));
        Assert.Equal(AtlasEdgeCategories.All.Length, AtlasEdgeCategories.All.Distinct().Count());

        var fromKinds = new (string? Kind, string Relation)[]
        {
            ("host", "hosted_on"), ("dns", "resolves_dns"), ("storage", "writes_to"), ("payment", "billed_through"),
            ("email", "sends_email_via"), ("ai", "calls"), ("login", "depends_on"), ("measure", "tracked_by"),
            ("monitor", "monitored_by"), ("support", "reports_to"), ("deploy", "deploys_to"), ("integration", "calls"),
            ("business", "depends_on"), (null, "depends_on"), ("kind-antigo", "depends_on"),
        };
        foreach (var (kind, relation) in fromKinds)
            Assert.Equal(relation, AtlasRelations.FromLinkKind(kind));
        Assert.True(AtlasRelations.IsValid("uses_credential_ref"));
        Assert.False(AtlasRelations.IsValid("uses"));
    }

    [Theory]
    [InlineData("observed", "declared", "observed")]
    [InlineData("declared", "discovered", "declared")]
    [InlineData("discovered", "reported", "discovered")]
    [InlineData("reported", "declared", "declared")]
    [InlineData("declared", "declared", "declared")]
    [InlineData("reported", "observed", "observed")]
    public void Origin_only_gets_stronger(string current, string incoming, string expected) =>
        Assert.Equal(expected, AtlasOrigins.Stronger(current, incoming));

    [Theory]
    [InlineData("runtime", "deployed", "runtime")]
    [InlineData("deployed", "pushed", "deployed")]
    [InlineData("pushed", "local", "pushed")]
    [InlineData("local", "pushed", "pushed")]
    [InlineData("pushed", "runtime", "runtime")]
    [InlineData("declared", "local", "local")]
    [InlineData("runtime", "declared", "runtime")]
    public void Scope_keeps_the_strongest_seen(string current, string incoming, string expected) =>
        Assert.Equal(expected, AtlasScopes.Stronger(current, incoming));

    [Fact]
    public void Verification_is_derived_by_the_seven_rules_in_order()
    {
        string Derive(DateTime? verifiedAt = null, DateTime? missingSince = null, DateTime? removal = null,
            string origin = AtlasOrigins.Declared, int live = 0, int any = 0) =>
            AtlasVerification.Derive(verifiedAt, missingSince, removal, origin, live, any, Now);

        // 1. Reported gone, or missing from the provider, is "not found", whatever else is true.
        Assert.Equal("not_found", Derive(verifiedAt: Now, removal: Now));
        Assert.Equal("not_found", Derive(verifiedAt: Now, missingSince: Now.AddDays(-1), live: 3));
        // 2. Confirmed within 48 hours is "verified".
        Assert.Equal("verified", Derive(verifiedAt: Now.AddHours(-47)));
        // 3. Confirmed longer ago is "stale".
        Assert.Equal("stale", Derive(verifiedAt: Now.AddHours(-49)));
        // 4. Code evidence still seen is "found in code".
        Assert.Equal("found_in_code", Derive(live: 1, any: 1, origin: AtlasOrigins.Discovered));
        // 5. Discovered from code, and all of that code evidence went away: "not found".
        Assert.Equal("not_found", Derive(origin: AtlasOrigins.Discovered, any: 2));
        // 6. Reported by an agent is "reported".
        Assert.Equal("reported", Derive(origin: AtlasOrigins.Reported));
        // 7. Anything else is "declared".
        Assert.Equal("declared", Derive());
        Assert.Equal("declared", Derive(origin: AtlasOrigins.Declared, any: 2));

        Assert.Equal("verificado", AtlasVerification.LabelPt("verified"));
        Assert.Equal("não encontrado", AtlasVerification.LabelPt("not_found"));
    }

    [Fact]
    public void Only_failure_is_red_among_the_attention_classes()
    {
        Assert.Equal(["failure", "security", "task", "improvement", "config", "unverified"], AtlasAttentionClasses.All);
        Assert.Single(AtlasAttentionClasses.All, AtlasAttentionClasses.IsRed);
        Assert.True(AtlasAttentionClasses.IsRed("failure"));
    }

    [Fact]
    public void Service_kinds_now_include_the_graph_kinds()
    {
        foreach (var kind in new[] { "pipeline", "host", "dns", "cdn", "edge", "queue", "cache", "agent", "cron", "webhook", "payment", "fiscal", "seo", "credential", "vault", "certificate" })
            Assert.True(AtlasServiceKinds.IsValid(kind), kind);
    }
}
