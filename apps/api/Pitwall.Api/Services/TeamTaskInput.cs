using Pitwall.Domain;

namespace Pitwall.Services;

/// <summary>
/// The shape a team task's lists must have before they are stored. Pure functions, so the rules
/// are tested without a database: each returns the cleaned value or the message the API answers
/// with (in Portuguese, like every message the team reads).
/// </summary>
public static class TeamTaskInput
{
    public const int MaxLabels = 10;
    public const int MaxLabelLength = 32;
    public const int MaxChecklistItems = 50;
    public const int MaxChecklistText = 300;
    public const int MaxLinks = 20;
    public const int MaxLinkLabel = 80;
    public const int MaxLinkUrl = 500;

    public sealed record ChecklistInput(string? Id, string? Text, bool? Done);
    public sealed record LinkInput(string? Label, string? Url);

    /// <summary>Lower case, spaces as hyphens, duplicates dropped; only <c>[a-z0-9-]</c>, at most 10 of up to 32.</summary>
    public static (string[] Labels, string? Error) Labels(IEnumerable<string?>? input)
    {
        var labels = new List<string>();
        foreach (var raw in input ?? [])
        {
            var label = string.Join('-', (raw ?? "").Trim().ToLowerInvariant()
                .Split([' ', '\t', '_'], StringSplitOptions.RemoveEmptyEntries));
            if (label.Length == 0) continue;
            if (label.Length > MaxLabelLength || !label.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '-'))
                return ([], $"Etiqueta inválida: \"{Clean.Cut(raw, 40)}\". Use letras minúsculas sem acento, números e hífen (até {MaxLabelLength}).");
            if (!labels.Contains(label)) labels.Add(label);
        }
        if (labels.Count > MaxLabels) return ([], $"Use no máximo {MaxLabels} etiquetas.");
        return (labels.ToArray(), null);
    }

    /// <summary>
    /// The whole checklist, as the caller wants it to be. Items keep the id they came with (when it
    /// is well formed and not repeated); new items get the next free <c>cN</c>.
    /// </summary>
    public static (List<TeamTaskChecklistItem> Items, string? Error) Checklist(IEnumerable<ChecklistInput?>? input)
    {
        var given = (input ?? []).Where(i => i is not null).Select(i => i!).ToList();
        if (given.Count > MaxChecklistItems) return ([], $"Use no máximo {MaxChecklistItems} itens na checklist.");

        var items = new List<TeamTaskChecklistItem>();
        var used = new HashSet<string>(StringComparer.Ordinal);
        foreach (var i in given)
        {
            var text = Clean.Cut(i.Text?.ReplaceLineEndings(" "), MaxChecklistText);
            if (text is null) return ([], "Um item da checklist está vazio.");
            var id = i.Id?.Trim();
            var keep = id is { Length: > 0 and <= 16 } && id.All(char.IsAsciiLetterOrDigit) && used.Add(id);
            items.Add(new TeamTaskChecklistItem { Id = keep ? id! : "", Text = text, Done = i.Done == true });
        }
        var next = used.Select(u => u.StartsWith('c') && int.TryParse(u[1..], out var n) ? n : 0).DefaultIfEmpty(0).Max() + 1;
        foreach (var item in items.Where(x => x.Id.Length == 0))
        {
            while (!used.Add($"c{next}")) next++;
            item.Id = $"c{next++}";
        }
        return (items, null);
    }

    /// <summary>At most 20 links, each an absolute <c>http</c>/<c>https</c> URL. The label defaults to the host.</summary>
    public static (List<TeamTaskLink> Links, string? Error) Links(IEnumerable<LinkInput?>? input)
    {
        var given = (input ?? []).Where(i => i is not null).Select(i => i!).ToList();
        if (given.Count > MaxLinks) return ([], $"Use no máximo {MaxLinks} links.");
        var links = new List<TeamTaskLink>();
        foreach (var l in given)
        {
            var url = l.Url?.Trim() ?? "";
            if (url.Length is 0 or > MaxLinkUrl || !Uri.TryCreate(url, UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                return ([], $"Link inválido: use um endereço http ou https completo (até {MaxLinkUrl} caracteres).");
            links.Add(new TeamTaskLink { Label = Clean.Cut(l.Label, MaxLinkLabel) ?? uri.Host, Url = url });
        }
        return (links, null);
    }
}
