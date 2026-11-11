using System.Globalization;
using System.Text;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas.Graph;

/// <summary>
/// The attention classes (contract 1.7). A linked task counts in exactly one class, so a task is
/// never two alarms. Only failure is red; the rest is work to look at.
/// </summary>
internal static class AtlasAttention
{
    /// <summary>The class of a linked task: security first, then blocked (config), then improvement, else plain task.</summary>
    public static string ClassifyTask(string? status, IEnumerable<string> labels)
    {
        var folded = labels.Select(Fold).ToList();
        if (folded.Any(l => l is "seguranca" or "security")) return AtlasAttentionClasses.Security;
        if (status == TeamTaskStatuses.Blocked) return AtlasAttentionClasses.Config;
        if (folded.Any(l => l is "melhoria" or "improvement")) return AtlasAttentionClasses.Improvement;
        return AtlasAttentionClasses.Task;
    }

    /// <summary>Lower case, no accents: "Segurança" and "seguranca" are the same label.</summary>
    public static string Fold(string s)
    {
        var decomposed = s.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var c in decomposed)
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        return sb.ToString().Normalize(NormalizationForm.FormC);
    }
}
