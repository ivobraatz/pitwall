using System.Security.Cryptography;
using System.Text;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas.Graph;

/// <summary>
/// Rules that read the map and say what to look at. Deterministic: no model, same map, same
/// insights. An insight's id is stable (rule and node ids), so a person's dismissal can outlive a refresh.
/// </summary>
internal static class AtlasInsights
{
    private static readonly string[] MonitoredKinds = ["api", "web", "site", "worker", "queue", "cron", "edge"];

    public static List<InsightDto> Build(AtlasGraphData data, Guid? systemId)
    {
        var now = data.Now;
        var nodes = data.ActiveNodes.ToList();
        var edges = data.ActiveEdges.ToList();
        var outgoing = edges.GroupBy(e => e.From).ToDictionary(g => g.Key, g => g.Select(e => e.Relation).ToHashSet());
        bool Has(GNode n, string relation) => outgoing.TryGetValue(n.Id, out var set) && set.Contains(relation);

        var found = new List<(string Rule, string Severity, GNode Node, string Title, string Detail)>();
        foreach (var n in nodes)
        {
            if (!n.IsRepo)
            {
                var s = n.Service!;
                if (MonitoredKinds.Contains(n.Kind) && s.MonitorRef is null && !Has(n, "monitored_by"))
                    found.Add(("no-monitoring", "check", n, $"{n.Name} sem monitoramento",
                        "Nenhum monitor acompanha este serviço: se ele parar, ninguém é avisado. Vincule um monitor ou uma ligação monitored_by."));
                if (n.Kind == "database" && !Has(n, "backed_up_by"))
                    found.Add(("no-backup", "check", n, $"{n.Name} sem backup",
                        "Nenhum backup está ligado a este banco de dados. Ligue o backup (backed_up_by) ou registre por que não há."));
                if (n.Kind == "credential" && !Has(n, "protected_by") && !s.Facts.Any(f => string.Equals(f.Key, "vaultRef", StringComparison.OrdinalIgnoreCase)))
                    found.Add(("credential-no-vault", "suggestion", n, $"{n.Name} fora de um cofre",
                        "Esta credencial não aponta para um cofre. Guarde-a num cofre e ligue com protected_by."));
                if ((n.Verification is AtlasVerification.Reported or AtlasVerification.FoundInCode) && n.CreatedAt < now.AddDays(-7))
                    found.Add(("unverified-old", "suggestion", n, $"{n.Name} ainda não verificado",
                        "Foi declarado ou visto só no código há mais de 7 dias e ninguém confirmou. Confirme ou retire."));
                if (n.RemovalReportedAt is not null)
                    found.Add(("removal-reported", "check", n, $"{n.Name} relatado como removido",
                        "Alguém ou algo relatou que este serviço sumiu. Confirme a remoção ou descarte o aviso."));
                if (n.MissingSince is not null)
                    found.Add(("missing-at-provider", "check", n, $"{n.Name} não encontrado no provedor",
                        "O coletor leu o provedor e não achou este serviço. Confira se foi removido ou renomeado."));
                if (n.LiveCodeEvidence == 0 && n.AnyCodeEvidence > 0 && n.Origin == AtlasOrigins.Discovered)
                    found.Add(("gone-from-code", "check", n, $"{n.Name} sumiu do código",
                        "Todas as evidências do código deste serviço sumiram. Confirme se ele ainda existe."));
            }
            else
            {
                var r = n.Repo!;
                if (r.LastSyncAt is null || r.LastSyncAt < now.AddDays(-14))
                    found.Add(("repo-not-synced", "check", n, $"{n.Name} sem sincronia recente",
                        "Este repositório não sincronizou nos últimos 14 dias. Rode o sync ou confira a integração."));
                if ((r.OpenAlerts ?? 0) > 0)
                    found.Add(("security-alerts", "check", n, $"{n.Name} com alertas de segurança",
                        $"{r.OpenAlerts} alerta(s) de dependência aberto(s) neste repositório."));
            }
        }

        var result = new List<InsightDto>();
        foreach (var f in found)
        {
            if (systemId is { } sid && f.Node.ProductId != sid) continue;
            result.Add(new InsightDto(StableId(f.Rule, f.Node.Id), f.Rule, f.Severity, f.Title, f.Detail,
                [f.Node.Id.ToString()], data.SystemOf(f.Node.ProductId)));
        }
        return result;
    }

    /// <summary>sha1 of the rule and the node id, in hex, first 16 characters.</summary>
    private static string StableId(string rule, Guid nodeId)
    {
        var hash = SHA1.HashData(Encoding.UTF8.GetBytes(rule + "|" + nodeId.ToString("D")));
        return Convert.ToHexString(hash).ToLowerInvariant()[..16];
    }
}
