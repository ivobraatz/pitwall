using Pitwall.Domain;

namespace Pitwall.Services.Atlas.Graph;

/// <summary>
/// How much of the picture is in place: each check says whether it applies here, and the percent
/// counts only the checks that apply. A check that does not apply is never a failure.
/// </summary>
internal static class AtlasCoverage
{
    public static CoverageDto Compute(IReadOnlyCollection<GNode> nodes, IReadOnlyCollection<GEdge> edges, DateTime now)
    {
        var services = nodes.Where(n => !n.IsRepo).ToList();
        var repos = nodes.Where(n => n.IsRepo).ToList();
        var nodeIds = nodes.Select(n => n.Id).ToHashSet();
        var monitored = edges.Where(e => e.Relation == "monitored_by" && nodeIds.Contains(e.From)).Select(e => e.From).ToHashSet();
        var backedUp = edges.Where(e => e.Relation == "backed_up_by" && nodeIds.Contains(e.From)).Select(e => e.From).ToHashSet();
        var databases = services.Where(s => s.Kind == "database").ToList();

        var checks = new List<CoverageCheckDto>
        {
            new("repo_linked", repos.Count > 0, true, "Repositório vinculado"),
            new("repo_synced", repos.Any(r => r.Repo!.LastSyncAt is { } s && s >= now.AddDays(-14)), true, "Repositório sincronizado"),
            new("hosting_verified", services.Any(s => s.Verification == AtlasVerification.Verified), true, "Hospedagem verificada"),
            new("monitoring", services.Any(s => s.Service!.MonitorRef is not null || monitored.Contains(s.Id)), true, "Monitoramento"),
            new("backup", databases.Count > 0 && databases.All(d => backedUp.Contains(d.Id)), databases.Count > 0, "Backup"),
            new("domain", nodes.Any(n => n.Kind is "domain" or "dns"), true, "Domínio"),
            new("engines", nodes.Select(n => n.Engine).Distinct().Count() >= 5, true, "Motores"),
        };
        var applicable = checks.Count(c => c.Applicable);
        var ok = checks.Count(c => c.Applicable && c.Ok);
        var percent = applicable == 0 ? 0 : (int)Math.Round(ok * 100.0 / applicable, MidpointRounding.AwayFromZero);
        return new CoverageDto(percent, checks);
    }
}
