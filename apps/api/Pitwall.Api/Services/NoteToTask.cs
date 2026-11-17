using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Pitwall.Domain;

namespace Pitwall.Services;

/// <summary>
/// The draft a note turns into when it becomes a task, and how ready it is. Pure functions, so the
/// rules are tested without a database. The note's product must be loaded for <c>ProductSlug</c>.
/// </summary>
public static partial class NoteToTask
{
    public const int ReadyScore = 75;
    /// <summary>Below this a conversion is refused unless the person forces it.</summary>
    public const int ConvertScore = 50;
    public const int MaxChecklist = 50;
    public const int MaxChecklistText = 300;
    public const int MaxLinks = 20;
    public const int MaxBody = 20_000;
    private const int MaxLinkLabel = 80;
    private const int MaxLinkUrl = 500;

    public static TaskDraft Draft(Note note)
    {
        var lines = note.Body.ReplaceLineEndings("\n").Split('\n');
        var checklist = new List<string>();
        var done = new List<bool>();
        var kept = new List<string>();
        foreach (var line in lines)
        {
            var m = ChecklistLine().Match(line);
            if (m.Success && checklist.Count < MaxChecklist)
            {
                checklist.Add(Cut(m.Groups[2].Value, MaxChecklistText));
                done.Add(m.Groups[1].Value is "x" or "X");
            }
            else kept.Add(line);
        }
        var text = Blank3().Replace(string.Join('\n', kept), "\n\n").Trim();

        // The body keeps what the person wrote; the footer says where the task came from and is never cut.
        var footer = $"\n\n---\nOrigem: anotação {note.Code}";
        if (text.Length + footer.Length > MaxBody) text = text[..(MaxBody - footer.Length)].TrimEnd();
        var body = text.Length == 0 ? footer.TrimStart() : text + footer;

        var readiness = ReadinessOf(note, lines, text, checklist.Count);
        return new TaskDraft(
            note.Title, body, checklist.ToArray(), done.ToArray(), Links(note.Body), [.. note.Labels],
            note.Product?.Slug, readiness);
    }

    private static Readiness ReadinessOf(Note note, string[] lines, string text, int checklistItems)
    {
        var missing = new List<string>();
        var score = 0;

        if (Words(note.Title) >= 3) score += 25;
        else missing.Add("Título curto demais: diga a ação no imperativo.");

        if (Words(text) >= 40) score += 25;
        else missing.Add("Explique o porquê e o contexto no corpo.");

        var passos = lines.Any(l => Regex.IsMatch(l, @"^#{1,6}\s*passos\s*$", RegexOptions.IgnoreCase));
        if (checklistItems > 0 || passos) score += 25;
        else missing.Add("Liste os passos como checklist (- [ ] passo).");

        var verifica = lines.Select(l => Heading().Match(l)).Where(m => m.Success)
            .Select(m => Fold(m.Groups[1].Value))
            .Any(t => t.Contains("verificar") || t.Contains("como saber") || t.Contains("criterio"));
        if (verifica) score += 15;
        else missing.Add("Diga como verificar que deu certo (## Como verificar).");

        if (note.ProductId is not null) score += 10;
        else missing.Add("Escolha o sistema.");

        return new Readiness(score, score >= ReadyScore, missing.ToArray());
    }

    /// <summary>Markdown links first (their own label), then bare http(s) URLs; one entry per URL, at most 20.</summary>
    private static NoteLink[] Links(string body)
    {
        var links = new List<NoteLink>();
        void Add(string? label, string url)
        {
            if (links.Count >= MaxLinks || url.Length > MaxLinkUrl || links.Any(l => l.Url == url)) return;
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return;
            links.Add(new NoteLink(Clean.Cut(label, MaxLinkLabel) ?? uri.Host, url));
        }

        foreach (Match m in MarkdownLink().Matches(body)) Add(m.Groups[1].Value.Trim(), m.Groups[2].Value);
        // The markdown links are blanked first, so their URLs are not found a second time as bare ones.
        foreach (Match m in BareUrl().Matches(MarkdownLink().Replace(body, " ")))
            Add(null, m.Value.TrimEnd('.', ',', ';', ':', '!', '?'));
        return links.ToArray();
    }

    private static int Words(string s) => s.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;

    /// <summary>Lower case, no accents: "Critério" and "criterio" are the same heading.</summary>
    private static string Fold(string s) => new string(s.Normalize(NormalizationForm.FormD)
        .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray()).ToLowerInvariant();

    private static string Cut(string s, int max) => s.Length <= max ? s : s[..max];

    [GeneratedRegex(@"^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$")]
    private static partial Regex ChecklistLine();

    [GeneratedRegex(@"^#{1,6}\s+(.+?)\s*$")]
    private static partial Regex Heading();

    [GeneratedRegex(@"\[([^\]\n]*)\]\((https?://[^\s)]+)\)")]
    private static partial Regex MarkdownLink();

    [GeneratedRegex(@"https?://[^\s<>()\[\]""'`]+")]
    private static partial Regex BareUrl();

    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex Blank3();
}

/// <summary>What a conversion would create: the task's fields, as the board will hold them.</summary>
public sealed record TaskDraft(
    string Title,
    string Body,
    string[] Checklist,
    /// <summary>The done flags of <see cref="Checklist"/>, in the same order (<c>- [x]</c> lines).</summary>
    bool[] ChecklistDone,
    NoteLink[] Links,
    string[] Labels,
    string? ProductSlug,
    Readiness Readiness);

public sealed record NoteLink(string Label, string Url);

public sealed record Readiness(int Score, bool Ready, string[] Missing);
