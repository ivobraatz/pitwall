using System.Text;
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;
using Pitwall.Domain;

namespace Pitwall.Services.Releases;

/// <summary>One commit as the release pipeline sends it: what changed, in the author's words.</summary>
public sealed record ReleaseCommit(string Sha, string Subject, string? Body);

/// <summary>A release note in one language: a title with the theme, a one-line summary, and the two lists.</summary>
public sealed record NoteText(string Title, string Summary, IReadOnlyList<string> New, IReadOnlyList<string> Improvements)
{
    public bool IsEmpty => New.Count == 0 && Improvements.Count == 0;
}

/// <param name="Publish">False when nothing in the commits is something a customer would notice.</param>
public sealed record NoteDraft(bool Publish, IReadOnlyDictionary<string, NoteText> Notes);

/// <summary>The model call, behind an interface so tests can stand in for it.</summary>
public interface IReleaseNoteModel
{
    /// <summary>Returns the model's JSON reply, or null when it declined or failed.</summary>
    Task<string?> CompleteAsync(string system, string user, IReadOnlyDictionary<string, JsonElement> schema, CancellationToken ct);
}

/// <summary>
/// Claude Haiku 5.5 through the official SDK. Structured outputs hold the reply to the schema,
/// so the parser below only has to enforce lengths, never recover broken JSON.
/// </summary>
public sealed class AnthropicReleaseNoteModel(IConfiguration config, ILogger<AnthropicReleaseNoteModel> logger) : IReleaseNoteModel
{
    public const string DefaultModel = "claude-haiku-5-5";

    public async Task<string?> CompleteAsync(string system, string user, IReadOnlyDictionary<string, JsonElement> schema, CancellationToken ct)
    {
        var apiKey = config["Anthropic:ApiKey"] ?? Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException("Anthropic:ApiKey (or ANTHROPIC_API_KEY) is not set; release notes need the model.");
        var model = string.IsNullOrWhiteSpace(config["ReleaseNotes:Model"]) ? DefaultModel : config["ReleaseNotes:Model"]!.Trim();

        AnthropicClient client = new() { ApiKey = apiKey };
        var response = await client.Messages.Create(new MessageCreateParams
        {
            Model = model,
            MaxTokens = 16000,
            System = system,
            // Medium is Haiku 5.5's own default; said out loud so a change of default upstream
            // does not quietly change what a release costs.
            OutputConfig = new OutputConfig
            {
                Effort = Effort.Medium,
                Format = new JsonOutputFormat { Schema = schema.ToDictionary(k => k.Key, v => v.Value) },
            },
            Messages = [new() { Role = Role.User, Content = user }],
        }, ct);

        if (response.StopReason == "refusal")
        {
            logger.LogWarning("The release note model declined the request.");
            return null;
        }
        if (response.StopReason == "max_tokens")
        {
            logger.LogWarning("The release note reply was cut off at the token limit.");
            return null;
        }
        var text = new StringBuilder();
        foreach (var block in response.Content)
            if (block.TryPickText(out TextBlock? t)) text.Append(t.Text);
        return text.Length == 0 ? null : text.ToString();
    }
}

/// <summary>
/// Release notes written by themselves. The pipeline sends the commits that went out since the
/// last note; the model turns them into what a customer reads, in every language the product
/// publishes in, from one call — so the languages always say the same thing.
///
/// Writing to a customer, not to a developer: what the person can now do and why it matters,
/// "new" and "improvements" only, no internal names, no confession of bugs, no promises. The
/// model gets the rules as instructions; the code enforces the shape (lists, lengths).
/// </summary>
public sealed class ReleaseWriter(IReleaseNoteModel model, ILogger<ReleaseWriter> logger)
{
    public const int MaxItems = 8;
    public const int MaxItemChars = 480;

    private static readonly Dictionary<string, string> LanguageNames = new()
    {
        ["pt"] = "Brazilian Portuguese",
        ["en"] = "English",
        ["es"] = "Spanish",
    };

    public async Task<NoteDraft?> WriteAsync(
        Product product, string version, IReadOnlyList<ReleaseCommit> commits,
        IReadOnlyList<string> recentTitles, string? context, CancellationToken ct)
    {
        var locales = product.Settings.Locales.Count > 0 ? product.Settings.Locales : ["pt", "en"];
        var system = SystemPrompt(product, locales);
        var user = UserPrompt(version, commits, recentTitles, context);
        string? reply;
        try
        {
            reply = await model.CompleteAsync(system, user, Schema(locales), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "The release note model call failed for {Product} {Version}", product.Slug, version);
            return null;
        }
        if (reply is null) return null;
        var draft = Parse(reply, locales);
        if (draft is null)
            logger.LogWarning("Release note {Product} {Version}: unusable reply ({Length} chars)", product.Slug, version, reply.Length);
        return draft;
    }

    public static string SystemPrompt(Product product, IReadOnlyList<string> locales)
    {
        var languages = string.Join(" and ", locales.Select(l => LanguageNames.GetValueOrDefault(l, l)));
        var about = string.IsNullOrWhiteSpace(product.Description) ? "a SaaS product" : product.Description.Trim();
        return $"""
            You write the release notes of {product.Name}: {about}
            The readers are customers deciding whether the product keeps getting better. You get the
            commits of one release, written by developers. Write what a customer gains, in {languages},
            in the JSON shape you are given: "publish", then one object per language code
            ({string.Join(", ", locales)}).

            Rules:
            - title: the theme of the release in a few words (not the version number), sentence case,
              at most 70 characters, no trailing period.
            - summary: one sentence on what the person can do now.
            - new: things a customer could not do before. improvements: things that work better.
              Each item starts with the feature name in **bold**, then one or two short sentences
              (under 300 characters in all) on what it does for the person and where to find it.
              Merge commits about the same feature into one item, and keep every other change a
              customer can see or use: a commit that adds several features gives several items.
              Read every line of the commit bodies: each one describing something a person can now
              do is an item. At most 8 items per list.
            - Leave out anything a customer would not see: refactors, tests, CI, docs, dependencies,
              internal tooling, admin or back-office areas, environment variables, file or class
              names, endpoints, database details, ticket codes. No backticks, no code.
            - Never describe a bug or say something was broken, fixed or corrected. A fix worth
              mentioning becomes an improvement written positively ("Exports now include …").
              Security fixes are not mentioned. Wording that reveals a past problem counts as
              describing a bug: never "no longer", "anymore", "twice", "não … mais", "duas vezes",
              "deixou de". Leave such an item out.
            - No promises about the future, no superlatives, no emojis.
            - Every language says the same things in the same order.
            - If nothing in the commits is visible to a customer, set "publish" to false and leave
              every list empty.
            """;
    }

    public static string UserPrompt(string version, IReadOnlyList<ReleaseCommit> commits, IReadOnlyList<string> recentTitles, string? context)
    {
        var user = new StringBuilder();
        user.Append("Version: ").Append(version).Append("\n\n");
        if (recentTitles.Count > 0)
            user.Append("Titles of the last notes (do not repeat them): ").Append(string.Join(" | ", recentTitles)).Append("\n\n");
        if (!string.IsNullOrWhiteSpace(context))
            user.Append("From the team, overriding the commits where they disagree:\n").Append(context.Trim()).Append("\n\n");
        user.Append("Commits shipped in this release:\n");
        // Every subject, and less of each body the bigger the release: a backfilled release of
        // two hundred commits still fits in one call and still shows the model every change.
        var perBody = Math.Clamp(60_000 / Math.Max(1, commits.Count), 150, 1200);
        foreach (var c in commits.Take(400))
        {
            user.Append("- ").Append(c.Subject.Trim()).Append('\n');
            if (string.IsNullOrWhiteSpace(c.Body)) continue;
            var body = c.Body.Trim();
            if (body.Length > perBody) body = body[..perBody];
            user.Append("  ").Append(body.Replace("\n", "\n  ")).Append('\n');
        }
        return user.ToString();
    }

    public static IReadOnlyDictionary<string, JsonElement> Schema(IReadOnlyList<string> locales)
    {
        var note = new Dictionary<string, object>
        {
            ["type"] = "object",
            ["additionalProperties"] = false,
            ["required"] = new[] { "title", "summary", "new", "improvements" },
            ["properties"] = new Dictionary<string, object>
            {
                ["title"] = new { type = "string" },
                ["summary"] = new { type = "string" },
                ["new"] = new { type = "array", items = new { type = "string" } },
                ["improvements"] = new { type = "array", items = new { type = "string" } },
            },
        };
        var properties = new Dictionary<string, object> { ["publish"] = new { type = "boolean" } };
        foreach (var l in locales) properties[l] = note;
        return new Dictionary<string, JsonElement>
        {
            ["type"] = JsonSerializer.SerializeToElement("object"),
            ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
            ["required"] = JsonSerializer.SerializeToElement(new[] { "publish" }.Concat(locales).ToArray()),
            ["properties"] = JsonSerializer.SerializeToElement(properties),
        };
    }

    /// <summary>The model's JSON, held to the shape: short lists, trimmed items, no code marks.</summary>
    public static NoteDraft? Parse(string reply, IReadOnlyList<string> locales)
    {
        var s = (reply ?? "").Trim();
        var open = s.IndexOf('{');
        var close = s.LastIndexOf('}');
        if (open < 0 || close <= open) return null;
        try
        {
            using var doc = JsonDocument.Parse(s[open..(close + 1)]);
            var root = doc.RootElement;
            var publish = root.TryGetProperty("publish", out var p) && p.ValueKind == JsonValueKind.True;
            var notes = new Dictionary<string, NoteText>();
            foreach (var locale in locales)
            {
                var text = Lang(root, locale);
                if (text is null) return publish ? null : new NoteDraft(false, new Dictionary<string, NoteText>());
                notes[locale] = text;
            }
            return new NoteDraft(publish, notes);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static NoteText? Lang(JsonElement root, string key)
    {
        if (!root.TryGetProperty(key, out var o) || o.ValueKind != JsonValueKind.Object) return null;
        string Text(string name, int max)
        {
            var v = o.TryGetProperty(name, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString()!.Trim() : "";
            v = v.Replace("`", "");
            return v.Length > max ? v[..max].TrimEnd() : v;
        }
        List<string> Items(string name) => o.TryGetProperty(name, out var e) && e.ValueKind == JsonValueKind.Array
            ? e.EnumerateArray()
                .Where(x => x.ValueKind == JsonValueKind.String)
                .Select(x => x.GetString()!.Replace("`", "").Replace("\n", " ").Trim().TrimStart('-', ' '))
                .Where(x => x.Length > 0)
                .Select(x => x.Length > MaxItemChars ? x[..MaxItemChars].TrimEnd() + "…" : x)
                .Take(MaxItems)
                .ToList()
            : [];
        var title = Text("title", 80).TrimEnd('.');
        var text = new NoteText(title, Text("summary", 240), Items("new"), Items("improvements"));
        return title.Length == 0 && !text.IsEmpty ? null : text;
    }

    /// <summary>The body, laid out by us so every note looks the same whatever the model wrote.</summary>
    public static string Markdown(NoteText text, string locale)
    {
        var (newHeading, improvedHeading) = locale switch
        {
            "pt" => ("Novo", "Melhorias"),
            "es" => ("Nuevo", "Mejoras"),
            _ => ("New", "Improvements"),
        };
        var sb = new StringBuilder();
        void Section(string heading, IReadOnlyList<string> items)
        {
            if (items.Count == 0) return;
            if (sb.Length > 0) sb.Append('\n');
            sb.Append("### ").Append(heading).Append("\n\n");
            foreach (var item in items) sb.Append("- ").Append(item).Append('\n');
        }
        Section(newHeading, text.New);
        Section(improvedHeading, text.Improvements);
        return sb.ToString();
    }
}
