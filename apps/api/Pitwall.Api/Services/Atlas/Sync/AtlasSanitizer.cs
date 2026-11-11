using System.Text.Json;
using System.Text.RegularExpressions;

namespace Pitwall.Services.Atlas.Sync;

/// <summary>
/// What may leave a repository, and what may be kept of it. The CLI applies the same rules before it
/// sends; the server applies them again, so a client that forgets one still cannot store a secret.
/// </summary>
public static class AtlasSanitizer
{
    public const string Mark = "[removido]";

    public enum PathKind { None, Content, Presence }

    /// <summary>Directories never read, at any depth.</summary>
    public static readonly string[] IgnoredDirectories =
        ["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", "coverage", "bin", "obj", "vendor",
         ".venv", "venv", "__pycache__", ".turbo", ".vercel", ".wrangler", "target"];

    /// <summary>Files whose content is kept (after <see cref="Transform"/>).</summary>
    private static readonly string[] ContentPatterns =
    [
        "package.json", "pnpm-workspace.yaml", "*.csproj", "Directory.Packages.props", "global.json", "requirements*.txt",
        "pyproject.toml", "Pipfile", "go.mod", "Cargo.toml", "Gemfile", "composer.json", "Dockerfile", "Dockerfile.*",
        "*.dockerfile", "docker-compose*.yml", "docker-compose*.yaml", "compose*.yml", "compose*.yaml",
        ".github/workflows/*.yml", ".github/workflows/*.yaml", ".github/dependabot.yml", "wrangler.toml", "wrangler.json",
        "wrangler.jsonc", "vercel.json", "railway.json", "railway.toml", "netlify.toml", "fly.toml", "render.yaml", "Procfile",
        "prisma/schema.prisma", "robots.txt", ".env.example", ".env.sample", ".env.template", "example.env", "appsettings*.json",
    ];

    /// <summary>Files only their presence is kept for: the name says what the repository has, not its content.</summary>
    private static readonly string[] PresencePatterns =
    [
        "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "tsconfig.json", "next.config.*",
        "nuxt.config.*", "vite.config.*", "astro.config.*", "svelte.config.*", "sitemap.xml", "next-sitemap.config.*",
        "app/sitemap.*", "app/robots.*", "src/app/sitemap.*", "src/app/robots.*", "drizzle.config.*", ".gitleaks.toml",
        "SECURITY.md", "CODEOWNERS", ".github/CODEOWNERS", "*.sln", "*.slnx", ".nvmrc", ".node-version",
    ];

    private static readonly (Regex Rx, string Replacement)[] Rules =
    [
        (new Regex(@"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----", RegexOptions.CultureInvariant), Mark),
        (new Regex(@"\bAKIA[0-9A-Z]{16}\b", RegexOptions.CultureInvariant), Mark),
        (new Regex(@"\b(?:sk_live|sk_test|rk_live)_\w+", RegexOptions.CultureInvariant), Mark),
        (new Regex(@"\bsk-ant-[\w-]+", RegexOptions.CultureInvariant), Mark),
        (new Regex(@"\bsk-[A-Za-z0-9]{20,}", RegexOptions.CultureInvariant), Mark),
        (new Regex(@"\b(?:ghp|gho|ghs)_\w+", RegexOptions.CultureInvariant), Mark),
        (new Regex(@"\bgithub_pat_\w+", RegexOptions.CultureInvariant), Mark),
        (new Regex(@"\bxox[abprs]-[\w-]+", RegexOptions.CultureInvariant), Mark),
        (new Regex(@"\bpwt_\w+", RegexOptions.CultureInvariant), Mark),
        (new Regex(@"\bpw_\w{16,}", RegexOptions.CultureInvariant), Mark),
        (new Regex(@"\beyJ[\w-]+\.[\w-]+\.[\w-]+", RegexOptions.CultureInvariant), Mark),
        // Credentials inside a URL keep the scheme and the host, lose the user and password.
        (new Regex(@"(\w+://)[^/\s:@]+:[^/\s@]+@", RegexOptions.CultureInvariant), "$1" + Mark + "@"),
        (new Regex(@"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*[""']?[^\s""',;]{6,}",
            RegexOptions.CultureInvariant), "$1=" + Mark),
        // Long hex or base64 right after "=" or ":" is a key or a digest in almost every case.
        (new Regex(@"(?<=[=:]\s*[""']?)(?!//)(?:[0-9a-fA-F]{40,}|[A-Za-z0-9+/]{40,}={0,2})(?!\w)", RegexOptions.CultureInvariant), Mark),
    ];

    private static readonly Dictionary<string, Regex> GlobCache = new();

    /// <summary>Replaces every known secret shape by <c>[removido]</c>. Ordinary text passes through unchanged.</summary>
    public static string Redact(string? text)
    {
        if (string.IsNullOrEmpty(text)) return text ?? "";
        foreach (var (rx, replacement) in Rules) text = rx.Replace(text, replacement);
        return text;
    }

    /// <summary>Forward slashes, no leading <c>./</c>, no surrounding spaces.</summary>
    public static string NormalizePath(string path)
    {
        var p = path.Trim().Replace('\\', '/');
        while (p.StartsWith("./", StringComparison.Ordinal)) p = p[2..];
        return p;
    }

    public static string FileName(string path)
    {
        var p = NormalizePath(path);
        var i = p.LastIndexOf('/');
        return i < 0 ? p : p[(i + 1)..];
    }

    /// <summary>Secrets by name: <c>.env</c> and its variants, keys, certificates, credential files. Examples are not secrets.</summary>
    public static bool IsForbiddenPath(string path)
    {
        var name = FileName(path).ToLowerInvariant();
        if (name is ".env.example" or ".env.sample" or ".env.template" or "example.env") return false;
        if (name == ".env" || name.StartsWith(".env.", StringComparison.Ordinal) || name.EndsWith(".env", StringComparison.Ordinal)) return true;
        return name.EndsWith(".pem", StringComparison.Ordinal) || name.EndsWith(".key", StringComparison.Ordinal)
            || name.EndsWith(".pfx", StringComparison.Ordinal) || name.EndsWith(".p12", StringComparison.Ordinal)
            || name.StartsWith("id_rsa", StringComparison.Ordinal)
            || (name.StartsWith("credentials", StringComparison.Ordinal) && name.EndsWith(".json", StringComparison.Ordinal))
            || name.StartsWith("secrets.", StringComparison.Ordinal);
    }

    /// <summary>Whether the path is on the whitelist (contract 5.1): depth at most 4, no ignored folder, a known name.</summary>
    public static bool IsAllowedPath(string path) => Category(path) != PathKind.None;

    /// <summary>What kind of file the path is on the whitelist: content kept, presence only, or not on the list at all.</summary>
    public static PathKind Category(string path)
    {
        var p = NormalizePath(path);
        if (p.Length == 0 || p.StartsWith('/') || p.Contains(':') || p.Split('/').Length > 4) return PathKind.None;
        var segments = p.Split('/');
        if (segments.Any(s => s == "..")) return PathKind.None;
        if (segments[..^1].Any(s => IgnoredDirectories.Contains(s))) return PathKind.None;
        if (IsForbiddenPath(p)) return PathKind.None;
        if (ContentPatterns.Any(pattern => Matches(pattern, p))) return PathKind.Content;
        if (PresencePatterns.Any(pattern => Matches(pattern, p))) return PathKind.Presence;
        return PathKind.None;
    }

    /// <summary>
    /// What to keep of a file's content. <see cref="Sanitized.Content"/> is null for presence-only files;
    /// <see cref="Sanitized.Dropped"/> is true when the file was on the list but its content cannot be kept
    /// (JSON that does not parse), which makes the scan partial.
    /// </summary>
    public static Sanitized Transform(string path, string? content)
    {
        var kind = Category(path);
        if (kind != PathKind.Content || content is null) return new Sanitized(null, false);
        var name = FileName(path).ToLowerInvariant();

        if (name is ".env.example" or ".env.sample" or ".env.template" or "example.env")
            return new Sanitized(Redact(KeepVariableNames(content)), false);

        if (name.EndsWith(".json", StringComparison.Ordinal) || name.EndsWith(".jsonc", StringComparison.Ordinal))
        {
            try
            {
                using var doc = JsonDocument.Parse(content, new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip });
                if (name.StartsWith("appsettings", StringComparison.Ordinal))
                    return new Sanitized(Redact(BlankLeaves(doc.RootElement)), false);
                return new Sanitized(Redact(content), false);
            }
            catch (JsonException)
            {
                return new Sanitized(null, true);
            }
        }
        return new Sanitized(Redact(content), false);
    }

    public sealed record Sanitized(string? Content, bool Dropped);

    /// <summary>Only the names of an example file: <c>NAME=</c> per variable, and its comments. Values never leave.</summary>
    private static string KeepVariableNames(string content)
    {
        var lines = new List<string>();
        foreach (var raw in content.Replace("\r", "").Split('\n'))
        {
            var line = raw.TrimStart();
            if (line.StartsWith('#')) { lines.Add(line); continue; }
            var m = Regex.Match(line, @"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=");
            if (m.Success) lines.Add(m.Groups[1].Value + "=");
        }
        return string.Join('\n', lines);
    }

    /// <summary>The same JSON shape with every leaf value emptied: keys and nesting stay, values go.</summary>
    private static string BlankLeaves(JsonElement root)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true }))
        {
            WriteBlank(root, writer);
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static void WriteBlank(JsonElement e, Utf8JsonWriter w)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.Object:
                w.WriteStartObject();
                foreach (var p in e.EnumerateObject())
                {
                    w.WritePropertyName(p.Name);
                    WriteBlank(p.Value, w);
                }
                w.WriteEndObject();
                break;
            case JsonValueKind.Array:
                w.WriteStartArray();
                foreach (var item in e.EnumerateArray()) WriteBlank(item, w);
                w.WriteEndArray();
                break;
            default:
                w.WriteStringValue("");
                break;
        }
    }

    /// <summary>A pattern from the list, as a regex over the whole path. A pattern without a slash matches the name at any depth.</summary>
    private static bool Matches(string pattern, string path)
    {
        Regex rx;
        lock (GlobCache)
        {
            if (!GlobCache.TryGetValue(pattern, out rx!))
            {
                var body = Regex.Escape(pattern).Replace(@"\*", "[^/]*").Replace(@"\?", "[^/]");
                rx = new Regex("(^|/)" + body + "$", RegexOptions.CultureInvariant);
                GlobCache[pattern] = rx;
            }
        }
        return rx.IsMatch(path);
    }
}
