using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas.Sync;

/// <summary>A fact about the repository itself: <c>language</c> = <c>C#</c>, <c>framework</c> = <c>Next.js 16.4.5</c>.</summary>
public sealed record StackFact(string Key, string Value);

/// <summary>
/// One thing the repository points at (a service, a host, a schedule, a credential). The reconciler turns
/// it into a node and a piece of evidence. <see cref="FromSignature"/> and <see cref="ToSignature"/> name
/// another finding of the same scan: an edge from it to this one, or from this one to it.
/// </summary>
public sealed record Finding(
    string Signature, string Name, string Kind, string Engine, string Relation, bool Shared,
    string Method, string Reference,
    string? Provider = null, string? ExternalRef = null,
    IReadOnlyDictionary<string, string>? Facts = null,
    string? FromSignature = null,
    bool TargetsRepo = false,
    string? ToSignature = null);

public sealed record ScanResult(IReadOnlyList<StackFact> Stack, IReadOnlyList<Finding> Findings);

/// <summary>
/// Reads the whitelisted files of a repository (contract 5.2 and 5.3) without any parser package: YAML and
/// TOML by lines and patterns, JSON with System.Text.Json, csproj with XDocument. Unknown shapes produce
/// nothing rather than a guess. Input is what <see cref="AtlasSanitizer.Transform"/> kept.
/// </summary>
public static class AtlasManifestParser
{
    private static readonly JsonDocumentOptions JsonOptions = new() { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip };

    /// <summary>Entries with content are read; entries without content only tell what the repository has.</summary>
    public static ScanResult Parse(IReadOnlyList<(string Path, string? Content)> files)
    {
        var items = files
            .Where(f => !string.IsNullOrWhiteSpace(f.Path))
            .Select(f => (Path: AtlasSanitizer.NormalizePath(f.Path), f.Content))
            .OrderBy(f => f.Path, StringComparer.Ordinal)
            .ToList();
        var scan = new Scan();
        var state = new State();

        foreach (var item in items) Presence(item.Path, state, scan);
        foreach (var item in items)
        {
            if (item.Content is null) continue;
            Content(item.Path, item.Content, state, scan);
        }

        // Node and package-manager facts that depend on several files at once.
        if (state.PackageJson)
            scan.Fact("language", state.TypeScript ? "TypeScript" : "JavaScript");
        var nodePackageManager = state.PackageManagerField ?? state.LockfileManager;
        if (state.PackageJson && nodePackageManager is not null) scan.Fact("package-manager", nodePackageManager);
        if (state.Workflows > 0) scan.Fact("ci", $"GitHub Actions ({state.Workflows} workflows)");
        if (state.Seo.Count > 0)
        {
            scan.Add(new Finding(
                "seo-files", "SEO: sitemap e robots", "seo", AtlasEngines.ForKind("seo"), "depends_on", false, "config", state.Seo[0],
                Facts: new Dictionary<string, string>
                {
                    ["robots"] = state.Seo.Any(p => p.EndsWith("robots.txt", StringComparison.Ordinal) || p.Contains("/robots.")) ? "sim" : "não",
                    ["sitemap"] = state.Seo.Any(p => p.Contains("sitemap")) ? "sim" : "não",
                }));
        }
        return new ScanResult(scan.Stack, scan.Findings);
    }

    // ---- Accumulators ------------------------------------------------------------------------

    private sealed class Scan
    {
        public readonly List<StackFact> Stack = [];
        private readonly HashSet<string> _stackSeen = [];
        public readonly List<Finding> Findings = [];
        private readonly HashSet<string> _findingSeen = [];

        public void Fact(string key, string value)
        {
            value = Cut(value, 300).Trim();
            if (value.Length == 0) return;
            if (_stackSeen.Add(key + "\0" + value)) Stack.Add(new StackFact(key, value));
        }

        /// <summary>The same thing found by the same method at the same place is one finding.</summary>
        public void Add(Finding f)
        {
            if (_findingSeen.Add($"{f.Signature}\0{f.Method}\0{f.Reference}")) Findings.Add(f);
        }
    }

    private sealed class State
    {
        public bool PackageJson;
        public bool TypeScript;
        public bool TsConfig;
        public string? PackageManagerField;
        public string? LockfileManager;
        public int Workflows;
        public readonly List<string> Seo = [];
    }

    // ---- Presence: what the file names say, whether or not the content came ---------------------

    private static void Presence(string path, State st, Scan scan)
    {
        var name = AtlasSanitizer.FileName(path);
        var lower = name.ToLowerInvariant();
        if (name == "tsconfig.json") st.TsConfig = true;
        switch (lower)
        {
            case "package-lock.json": st.LockfileManager ??= "npm"; break;
            case "pnpm-lock.yaml": st.LockfileManager ??= "pnpm"; break;
            case "yarn.lock": st.LockfileManager ??= "yarn"; break;
            case "bun.lockb" or "bun.lock": st.LockfileManager ??= "bun"; break;
            case "go.mod": scan.Fact("language", "Go"); break;
            case "cargo.toml": scan.Fact("language", "Rust"); break;
            case "gemfile": scan.Fact("language", "Ruby"); break;
            case "composer.json": scan.Fact("language", "PHP"); break;
            case "pipfile": scan.Fact("language", "Python"); break;
            case "pyproject.toml": scan.Fact("language", "Python"); break;
            case "pnpm-workspace.yaml": scan.Fact("monorepo", "pnpm workspaces"); break;
            case "gitleaks.toml" or ".gitleaks.toml": scan.Fact("security:gitleaks", "presente"); break;
            case "security.md": scan.Fact("security:security-md", "presente"); break;
            case "codeowners": scan.Fact("security:codeowners", "presente"); break;
        }
        if (Regex.IsMatch(path, @"(^|/)requirements[^/]*\.txt$")) PythonPresence(scan, "pip");
        if (path == ".github/dependabot.yml") scan.Fact("security:dependabot", "presente");
        if (path == ".github/CODEOWNERS") scan.Fact("security:codeowners", "presente");
        if (Regex.IsMatch(path, @"^\.github/workflows/[^/]+\.ya?ml$")) st.Workflows++;
        if (Regex.IsMatch(path, @"(^|/)(robots\.txt|sitemap\.xml|next-sitemap\.config\.[^/]+|(src/)?app/(sitemap|robots)\.[^/]+)$")) st.Seo.Add(path);

        // Hosts the repository deploys to, by their own config file.
        if (lower == "vercel.json")
            scan.Add(SharedHost("vercel", "Vercel", "host", "deploys_to", path + "#presence"));
        if (lower is "railway.json" or "railway.toml")
            scan.Add(SharedHost("railway", "Railway", "host", "deploys_to", path + "#presence"));
    }

    private static void PythonPresence(Scan scan, string manager)
    {
        scan.Fact("language", "Python");
        scan.Fact("package-manager", manager);
    }

    // ---- Content ----------------------------------------------------------------------------

    private static void Content(string path, string content, State st, Scan scan)
    {
        var name = AtlasSanitizer.FileName(path);
        var lower = name.ToLowerInvariant();

        if (lower == "package.json") PackageJson(path, content, st, scan);
        else if (lower.EndsWith(".csproj", StringComparison.Ordinal) || lower == "directory.packages.props") Csproj(path, content, scan);
        else if (Regex.IsMatch(lower, @"^requirements[^/]*\.txt$")) Requirements(path, content, scan);
        else if (lower == "pyproject.toml") Pyproject(path, content, scan);
        else if (lower == "dockerfile" || lower.StartsWith("dockerfile.", StringComparison.Ordinal) || lower.EndsWith(".dockerfile", StringComparison.Ordinal))
            Dockerfile(path, content, scan);
        else if (Regex.IsMatch(lower, @"^(docker-)?compose[^/]*\.ya?ml$") && lower.Contains("prod")) Compose(path, content, scan);
        else if (Regex.IsMatch(path, @"(^|/)\.github/workflows/[^/]+\.ya?ml$")) Workflow(path, content, scan);
        else if (lower is "wrangler.toml") AddWrangler(path, WranglerToml(content), scan);
        else if (lower is "wrangler.json" or "wrangler.jsonc") AddWrangler(path, WranglerJson(content, path), scan);
        else if (lower == "vercel.json") VercelCrons(path, content, scan);
        else if (lower is "railway.json" or "railway.toml") RailwayConfig(path, content, scan);
        else if (lower == "schema.prisma") Prisma(path, content, scan);
        else if (lower is ".env.example" or ".env.sample" or ".env.template" or "example.env") EnvNames(path, content, scan);
    }

    // package.json: frameworks, runtime, package manager, npm dependencies.
    private static readonly (string Dep, string Label, bool WithVersion)[] NodeFrameworks =
    [
        ("next", "Next.js", true), ("react", "React", false), ("vue", "Vue", false), ("nuxt", "Nuxt", false),
        ("@sveltejs/kit", "SvelteKit", false), ("astro", "Astro", false), ("express", "Express", false),
        ("fastify", "Fastify", false), ("@nestjs/core", "NestJS", false), ("hono", "Hono", false),
    ];

    private static void PackageJson(string path, string content, State st, Scan scan)
    {
        JsonDocument doc;
        try { doc = JsonDocument.Parse(content, JsonOptions); }
        catch (JsonException) { return; }
        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            st.PackageJson = true;

            var deps = new Dictionary<string, (string Section, string Version)>(StringComparer.Ordinal);
            foreach (var section in new[] { "dependencies", "devDependencies" })
            {
                if (!root.TryGetProperty(section, out var block) || block.ValueKind != JsonValueKind.Object) continue;
                foreach (var dep in block.EnumerateObject())
                {
                    var version = dep.Value.ValueKind == JsonValueKind.String ? dep.Value.GetString() ?? "" : "";
                    deps.TryAdd(dep.Name, (section, version));
                }
            }
            if (deps.ContainsKey("typescript")) st.TypeScript = true;
            if (st.TsConfig) st.TypeScript = true;

            foreach (var (dep, label, withVersion) in NodeFrameworks)
            {
                if (!deps.TryGetValue(dep, out var found)) continue;
                var version = withVersion ? Version(found.Version) : null;
                scan.Fact("framework", version is null ? label : $"{label} {version}");
            }

            if (root.TryGetProperty("engines", out var engines) && engines.ValueKind == JsonValueKind.Object
                && engines.TryGetProperty("node", out var node) && node.ValueKind == JsonValueKind.String)
                scan.Fact("runtime", $"Node {node.GetString()}");

            if (root.TryGetProperty("packageManager", out var pm) && pm.ValueKind == JsonValueKind.String)
            {
                var manager = (pm.GetString() ?? "").Split('@')[0];
                if (manager.Length > 0) st.PackageManagerField = manager;
            }

            foreach (var entry in AtlasCatalog.All)
            {
                foreach (var npm in entry.Npm)
                {
                    if (!deps.TryGetValue(npm, out var found)) continue;
                    scan.Add(FromCatalog(entry, "manifest", $"{path}#{found.Section}.{npm}"));
                    break;
                }
            }
        }
    }

    // csproj and Directory.Packages.props: target framework, NuGet references.
    private static void Csproj(string path, string content, Scan scan)
    {
        XDocument doc;
        try { doc = XDocument.Parse(content); }
        catch (System.Xml.XmlException) { return; }
        var root = doc.Root;
        if (root is null) return;

        scan.Fact("language", "C#");
        scan.Fact("package-manager", "NuGet");
        var sdk = root.Attribute("Sdk")?.Value ?? "";
        var tfm = root.Descendants().FirstOrDefault(e => e.Name.LocalName == "TargetFramework")?.Value.Trim();
        if (string.IsNullOrEmpty(tfm))
            tfm = root.Descendants().FirstOrDefault(e => e.Name.LocalName == "TargetFrameworks")?.Value.Split(';')[0].Trim();
        if (!string.IsNullOrEmpty(tfm))
        {
            scan.Fact("runtime", $".NET {tfm}");
            if (sdk == "Microsoft.NET.Sdk.Web") scan.Fact("framework", $"ASP.NET Core {tfm}");
        }

        foreach (var reference in root.Descendants().Where(e => e.Name.LocalName is "PackageReference" or "PackageVersion"))
        {
            var include = reference.Attribute("Include")?.Value;
            if (string.IsNullOrWhiteSpace(include)) continue;
            foreach (var entry in AtlasCatalog.All)
            {
                if (entry.NuGet.Any(n => string.Equals(n, include, StringComparison.OrdinalIgnoreCase)))
                    scan.Add(FromCatalog(entry, "manifest", $"{path}#PackageReference.{include}"));
            }
        }
    }

    // requirements*.txt: one package per line.
    private static void Requirements(string path, string content, Scan scan)
    {
        var names = new List<string>();
        foreach (var raw in Lines(content))
        {
            var line = raw.Split('#')[0].Trim();
            if (line.Length == 0 || line.StartsWith('-')) continue;
            var m = Regex.Match(line, @"^([A-Za-z0-9][A-Za-z0-9._-]*)");
            if (m.Success) names.Add(m.Groups[1].Value);
        }
        PythonPackages(path, names, scan);
    }

    // pyproject.toml: PEP 621 strings and Poetry's "name = version" lines.
    private static void Pyproject(string path, string content, Scan scan)
    {
        var poetry = content.Contains("[tool.poetry]", StringComparison.Ordinal);
        if (poetry) scan.Fact("package-manager", "poetry");
        var names = new List<string>();
        foreach (Match m in Regex.Matches(content, @"""([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]""]*\])?\s*(?:[<>=!~;][^""]*)?"""))
            names.Add(m.Groups[1].Value);
        foreach (Match m in Regex.Matches(content, @"(?m)^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*"))
            names.Add(m.Groups[1].Value);
        PythonPackages(path, names, scan);
    }

    private static void PythonPackages(string path, IEnumerable<string> names, Scan scan)
    {
        var normalized = names.Select(Norm).Distinct().ToList();
        foreach (var entry in AtlasCatalog.All)
        {
            var hit = normalized.FirstOrDefault(n => entry.Pip.Any(p => Norm(p) == n));
            if (hit is not null) scan.Add(FromCatalog(entry, "manifest", $"{path}#{hit}"));
        }
        foreach (var (pip, label) in new[] { ("django", "Django"), ("flask", "Flask"), ("fastapi", "FastAPI") })
            if (normalized.Contains(pip)) scan.Fact("framework", label);
    }

    private static string Norm(string name) => Regex.Replace(name.ToLowerInvariant(), "[-_.]+", "-");

    // Dockerfile: base images, and the runtime when the base is node or python.
    private static void Dockerfile(string path, string content, Scan scan)
    {
        foreach (var line in Lines(content))
        {
            var m = Regex.Match(line, @"^\s*FROM\s+(.+)$", RegexOptions.IgnoreCase);
            if (!m.Success) continue;
            var image = m.Groups[1].Value.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .FirstOrDefault(t => !t.StartsWith("--", StringComparison.Ordinal));
            if (image is null || image.Equals("scratch", StringComparison.OrdinalIgnoreCase)) continue;
            scan.Fact("container", image);
            foreach (var (prefix, label) in new[] { ("node:", "Node"), ("python:", "Python") })
            {
                if (!image.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
                var tag = image[prefix.Length..];
                tag = tag.Split('-', '@')[0];
                if (tag.Length > 0) scan.Fact("runtime", $"{label} {tag}");
            }
        }
    }

    // docker-compose files of production: each service becomes a node, by the kind its image suggests.
    private static void Compose(string path, string content, Scan scan)
    {
        var services = new List<(string Name, string? Image)>();
        var inServices = false;
        string? current = null;
        string? image = null;
        void Flush()
        {
            if (current is not null) services.Add((current, image));
            current = null;
            image = null;
        }

        foreach (var line in Lines(content))
        {
            if (Regex.IsMatch(line, @"^services:\s*$"))
            {
                inServices = true;
                continue;
            }
            if (inServices && line.Length > 0 && !char.IsWhiteSpace(line[0]) && !line.StartsWith('#'))
            {
                Flush();
                inServices = false;
            }
            if (!inServices) continue;
            var service = Regex.Match(line, @"^  ([A-Za-z0-9_.-]+):\s*$");
            if (service.Success)
            {
                Flush();
                current = service.Groups[1].Value;
                continue;
            }
            var img = Regex.Match(line, @"^\s+image:\s*['""]?([^'""\s#]+)");
            if (img.Success && current is not null) image = img.Groups[1].Value;
        }
        Flush();

        foreach (var (name, img) in services)
        {
            var baseName = (img ?? "").Split('/').Last().Split(':')[0].ToLowerInvariant();
            var kind = baseName switch
            {
                "postgres" or "postgresql" => "database",
                "redis" => "cache",
                "caddy" or "nginx" or "traefik" => "cdn",
                "seaweedfs" or "minio" => "storage",
                _ => "worker",
            };
            scan.Add(new Finding(
                Sig($"compose:{name}"), Cut(name, 120), kind, AtlasEngines.ForKind(kind), "depends_on", false, "manifest",
                $"{path}#services.{name}",
                Facts: img is null ? null : new Dictionary<string, string> { ["Imagem"] = img }));
        }
    }

    // GitHub workflow: a pipeline, its triggers, its schedules and the hosts it deploys to.
    private static readonly (string Pattern, string Signature, string Name, string Kind)[] DeployTargets =
    [
        (@"railway\s+up|railwayapp", "railway", "Railway", "host"),
        (@"vercel\s+(?:deploy|--prod)|amondnet/vercel-action", "vercel", "Vercel", "host"),
        (@"wrangler\s+deploy|cloudflare/wrangler-action", "cloudflare", "Cloudflare", "host"),
        (@"flyctl\s+deploy|superfly/flyctl-actions", "fly", "Fly.io", "host"),
        (@"npm\s+publish|pnpm\s+publish", "npm", "npm", "package"),
    ];

    private static void Workflow(string path, string content, Scan scan)
    {
        var lines = Lines(content);
        var file = AtlasSanitizer.FileName(path);
        var name = lines.Select(l => Regex.Match(l, @"^name:\s*(.+?)\s*$")).FirstOrDefault(m => m.Success)?.Groups[1].Value.Trim('\'', '"');
        if (string.IsNullOrWhiteSpace(name)) name = file;

        var triggers = Triggers(lines);
        var pipelineSignature = Sig("gh-workflow:" + file);
        var facts = new Dictionary<string, string> { ["Arquivo"] = path };
        if (triggers.Count > 0) facts["Gatilhos"] = string.Join(", ", triggers);
        scan.Add(new Finding(
            pipelineSignature, Cut($"CI: {name}", 120), "pipeline", AtlasEngines.ForKind("pipeline"), "triggers", false,
            "workflow", $"{path}#name", Facts: facts));

        var index = 0;
        foreach (var line in lines)
        {
            var cron = Regex.Match(line, @"^\s*-?\s*cron:\s*['""]?([^'""#]+?)['""]?\s*(?:#.*)?$");
            if (cron.Success)
            {
                var expression = cron.Groups[1].Value.Trim();
                scan.Add(new Finding(
                    Sig($"gh-cron:{file}:{index}"), Cut($"Agendamento: {expression}", 120), "cron", AtlasEngines.ForKind("cron"),
                    "schedules", false, "workflow", $"{path}#on.schedule",
                    Facts: new Dictionary<string, string> { ["Expressão"] = expression }, ToSignature: pipelineSignature));
                index++;
            }
        }

        foreach (var (pattern, signature, hostName, kind) in DeployTargets)
        {
            if (!Regex.IsMatch(content, pattern, RegexOptions.IgnoreCase)) continue;
            scan.Add(new Finding(
                signature, hostName, kind, AtlasEngines.ForKind(kind), "deploys_to", true, "workflow", $"{path}#run",
                FromSignature: pipelineSignature));
        }
    }

    /// <summary>The keys under <c>on:</c>, or the list after it. Only what the file says; nothing guessed.</summary>
    private static List<string> Triggers(IReadOnlyList<string> lines)
    {
        var result = new List<string>();
        for (var i = 0; i < lines.Count; i++)
        {
            var m = Regex.Match(lines[i], @"^on:\s*(.*?)\s*$");
            if (!m.Success) continue;
            var rest = m.Groups[1].Value;
            if (rest.StartsWith('['))
                result.AddRange(rest.Trim('[', ']').Split(',').Select(s => s.Trim().Trim('\'', '"')).Where(s => s.Length > 0));
            else if (rest.Length > 0 && !rest.StartsWith('#'))
                result.Add(rest.Trim('\'', '"'));
            else
            {
                for (var j = i + 1; j < lines.Count; j++)
                {
                    var line = lines[j];
                    if (line.Length > 0 && !char.IsWhiteSpace(line[0]) && !line.StartsWith('#')) break;
                    var key = Regex.Match(line, @"^  ([A-Za-z_][\w-]*):\s*$");
                    if (key.Success) result.Add(key.Groups[1].Value);
                }
            }
            break;
        }
        return result;
    }

    // ---- Cloudflare Worker config ----------------------------------------------------------

    private sealed class Wrangler
    {
        public string? Name;
        public readonly List<string> Crons = [];
        public readonly List<string> Routes = [];
        public readonly List<string> R2 = [];
        public readonly List<string> D1 = [];
        public readonly List<string> Kv = [];
        public readonly List<string> Queues = [];
    }

    private static Wrangler WranglerToml(string content)
    {
        var w = new Wrangler();
        var section = "";
        foreach (var raw in Lines(content))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            var header = Regex.Match(line, @"^\[\[?\s*([^\]]+?)\s*\]\]?$");
            if (header.Success)
            {
                section = header.Groups[1].Value;
                continue;
            }
            var kv = Regex.Match(line, @"^([A-Za-z_][\w.-]*)\s*=\s*(.+)$");
            if (!kv.Success) continue;
            var key = kv.Groups[1].Value;
            var value = Unquote(kv.Groups[2].Value);
            switch (section)
            {
                case "" when key == "name": w.Name ??= value; break;
                case "" when key == "route": w.Routes.Add(value); break;
                case "r2_buckets" when key == "bucket_name": w.R2.Add(value); break;
                case "d1_databases" when key == "database_name": w.D1.Add(value); break;
                case "kv_namespaces" when key == "binding": w.Kv.Add(value); break;
                case "queues.producers" when key == "queue": w.Queues.Add(value); break;
            }
        }

        var triggers = Regex.Match(content, @"(?ms)^\[triggers\](.*?)(?=^\[|\z)");
        if (triggers.Success)
        {
            var crons = Regex.Match(triggers.Groups[1].Value, @"crons\s*=\s*\[([^\]]*)\]");
            if (crons.Success) w.Crons.AddRange(Quoted(crons.Groups[1].Value));
        }
        var routes = Regex.Match(content, @"(?ms)^routes\s*=\s*\[([^\]]*)\]");
        if (routes.Success) w.Routes.AddRange(Quoted(routes.Groups[1].Value));
        return w;
    }

    private static Wrangler WranglerJson(string content, string path)
    {
        var w = new Wrangler();
        JsonDocument doc;
        try { doc = JsonDocument.Parse(content, JsonOptions); }
        catch (JsonException) { return w; }
        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return w;
            w.Name = Str(root, "name");
            if (root.TryGetProperty("triggers", out var triggers) && triggers.TryGetProperty("crons", out var crons)) w.Crons.AddRange(Strings(crons));
            if (root.TryGetProperty("routes", out var routes)) w.Routes.AddRange(Strings(routes));
            if (Str(root, "route") is { } route) w.Routes.Add(route);
            w.R2.AddRange(Field(root, "r2_buckets", "bucket_name"));
            w.D1.AddRange(Field(root, "d1_databases", "database_name"));
            w.Kv.AddRange(Field(root, "kv_namespaces", "binding"));
            if (root.TryGetProperty("queues", out var queues) && queues.ValueKind == JsonValueKind.Object && queues.TryGetProperty("producers", out var producers))
                w.Queues.AddRange(Field(producers, null, "queue"));
        }
        return w;
    }

    private static void AddWrangler(string path, Wrangler w, Scan scan)
    {
        string? workerSignature = null;
        if (!string.IsNullOrWhiteSpace(w.Name))
        {
            var name = Cut(w.Name, 100);
            var facts = w.Routes.Count > 0 ? new Dictionary<string, string> { ["Rotas"] = string.Join(", ", w.Routes) } : null;
            scan.Add(new Finding(
                "cloudflare-worker", Cut($"Worker {name}", 120), "edge", AtlasEngines.ForKind("edge"), "deploys_to", false, "config",
                $"{path}#name", Provider: "cloudflare", ExternalRef: $"worker:{name}", Facts: facts));
            workerSignature = "cloudflare-worker";
        }

        var file = AtlasSanitizer.FileName(path);
        for (var i = 0; i < w.Crons.Count; i++)
        {
            scan.Add(new Finding(
                Sig($"cf-cron:{file}:{i}"), Cut($"Agendamento: {w.Crons[i]}", 120), "cron", AtlasEngines.ForKind("cron"), "schedules", false,
                "config", $"{path}#triggers.crons", Facts: new Dictionary<string, string> { ["Expressão"] = w.Crons[i] },
                ToSignature: workerSignature));
        }
        foreach (var bucket in w.R2)
            scan.Add(Bound("r2", $"R2 {bucket}", "storage", $"r2:{bucket}", path, "r2_buckets", bucket, workerSignature));
        foreach (var db in w.D1)
            scan.Add(Bound("d1", $"D1 {db}", "database", $"d1:{db}", path, "d1_databases", db, workerSignature));
        foreach (var kv in w.Kv)
            scan.Add(Bound("kv", $"KV {kv}", "storage", $"kv:{kv}", path, "kv_namespaces", kv, workerSignature));
        foreach (var queue in w.Queues)
            scan.Add(Bound("cf-queue", $"Fila {queue}", "queue", $"queue:{queue}", path, "queues.producers", queue, workerSignature));
    }

    private static Finding Bound(string signature, string name, string kind, string externalRef, string path, string section, string value, string? from) =>
        new(Sig(signature), Cut(name, 120), kind, AtlasEngines.ForKind(kind), "writes_to", false, "config", $"{path}#{section}.{value}",
            Provider: "cloudflare", ExternalRef: externalRef, FromSignature: from);

    // ---- Other hosts' config ----------------------------------------------------------------

    private static void VercelCrons(string path, string content, Scan scan)
    {
        JsonDocument doc;
        try { doc = JsonDocument.Parse(content, JsonOptions); }
        catch (JsonException) { return; }
        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object || !doc.RootElement.TryGetProperty("crons", out var crons)
                || crons.ValueKind != JsonValueKind.Array) return;
            var index = 0;
            foreach (var cron in crons.EnumerateArray())
            {
                var target = Str(cron, "path") ?? "";
                var schedule = Str(cron, "schedule") ?? "";
                scan.Add(new Finding(
                    Sig($"vercel-cron:{index}"), Cut($"Agendamento {target}", 120), "cron", AtlasEngines.ForKind("cron"), "schedules", false,
                    "config", $"{path}#crons", Facts: new Dictionary<string, string> { ["Expressão"] = schedule }, TargetsRepo: true));
                index++;
            }
        }
    }

    private static void RailwayConfig(string path, string content, Scan scan)
    {
        var index = 0;
        foreach (Match m in Regex.Matches(content, "\"?cronSchedule\"?\\s*[:=]\\s*\"([^\"]+)\""))
        {
            var expression = m.Groups[1].Value;
            scan.Add(new Finding(
                Sig($"railway-cron:{index}"), Cut($"Agendamento Railway: {expression}", 120), "cron", AtlasEngines.ForKind("cron"), "schedules",
                false, "config", $"{path}#deploy.cronSchedule", Facts: new Dictionary<string, string> { ["Expressão"] = expression }, TargetsRepo: true));
            index++;
        }
        var health = Regex.Match(content, "\"?healthcheckPath\"?\\s*[:=]\\s*\"([^\"]+)\"");
        if (health.Success) scan.Fact("railway:healthcheck", health.Groups[1].Value);
        var start = Regex.Match(content, "\"?startCommand\"?\\s*[:=]\\s*\"([^\"]+)\"");
        if (start.Success) scan.Fact("railway:start", start.Groups[1].Value);
    }

    private static void Prisma(string path, string content, Scan scan)
    {
        scan.Fact("orm", "Prisma");
        var provider = Regex.Match(content, @"provider\s*=\s*""(postgresql|mysql|mongodb)""");
        if (!provider.Success) return;
        var signature = provider.Groups[1].Value == "postgresql" ? "postgres" : provider.Groups[1].Value;
        var entry = AtlasCatalog.BySignature(signature);
        if (entry is not null) scan.Add(FromCatalog(entry, "manifest", $"{path}#datasource.provider"));
    }

    // ---- Example env files: names only ----------------------------------------------------

    private static readonly System.Text.RegularExpressions.Regex CredentialName =
        new("KEY|SECRET|TOKEN|PASSWORD|PASS|PRIVATE|DSN|CREDENTIAL", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static void EnvNames(string path, string content, Scan scan)
    {
        var names = new List<string>();
        foreach (var line in Lines(content))
        {
            if (line.TrimStart().StartsWith('#')) continue;
            var m = Regex.Match(line, @"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=");
            if (m.Success) names.Add(m.Groups[1].Value);
        }

        foreach (var name in names.Distinct(StringComparer.Ordinal))
        {
            string? matched = null;
            foreach (var entry in AtlasCatalog.All)
            {
                if (!entry.EnvPrefixes.Any(p => name.StartsWith(p, StringComparison.Ordinal))) continue;
                scan.Add(FromCatalog(entry, "env-example", $"{path}#{name}"));
                matched ??= entry.Signature;
            }

            if (name.Contains("WEBHOOK", StringComparison.Ordinal))
            {
                var prefix = name[..name.IndexOf("WEBHOOK", StringComparison.Ordinal)].Trim('_');
                scan.Add(new Finding(
                    Sig($"webhook:{name}"), Cut(prefix.Length == 0 ? "Webhook" : $"Webhook {prefix}", 120), "webhook",
                    AtlasEngines.ForKind("webhook"), "triggers", false, "env-example", $"{path}#{name}", FromSignature: matched));
            }

            if (CredentialName.IsMatch(name))
            {
                // The value is never kept: the node says so, and a vault is never linked by itself.
                scan.Add(new Finding(
                    Sig($"env:{name}"), Cut(name, 120), "credential", AtlasEngines.ForKind("credential"), "uses_credential_ref", false,
                    "env-example", $"{path}#{name}", Facts: new Dictionary<string, string> { ["Valor"] = "nunca guardado no Atlas" },
                    FromSignature: matched));
            }
        }
    }

    // ---- Helpers ----------------------------------------------------------------------------

    private static Finding FromCatalog(CatalogEntry entry, string method, string reference) =>
        new(entry.Signature, entry.Name, entry.Kind, AtlasEngines.ForKind(entry.Kind), entry.Relation, entry.Shared, method, reference);

    private static Finding SharedHost(string signature, string name, string kind, string relation, string reference) =>
        new(signature, name, kind, AtlasEngines.ForKind(kind), relation, true, "config", reference);

    private static string? Version(string range)
    {
        var m = Regex.Match(range, @"\d+(?:\.\d+)*");
        return m.Success ? m.Value : null;
    }

    private static string[] Lines(string content) => content.Replace("\r", "").Split('\n');

    private static IEnumerable<string> Quoted(string text) =>
        Regex.Matches(text, "\"([^\"]+)\"|'([^']+)'").Select(m => m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value);

    private static string Unquote(string value)
    {
        var v = value.Trim();
        var hash = v.IndexOf(" #", StringComparison.Ordinal);
        if (hash > 0) v = v[..hash].TrimEnd();
        return v.Trim('"', '\'');
    }

    private static string? Str(JsonElement e, string property) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(property, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static IEnumerable<string> Strings(JsonElement array)
    {
        if (array.ValueKind == JsonValueKind.String) return [array.GetString() ?? ""];
        if (array.ValueKind != JsonValueKind.Array) return [];
        return array.EnumerateArray().Where(v => v.ValueKind == JsonValueKind.String).Select(v => v.GetString() ?? "").ToList();
    }

    /// <summary>The <paramref name="property"/> of every item of <paramref name="blockName"/> (or of the array itself when null).</summary>
    private static IEnumerable<string> Field(JsonElement root, string? blockName, string property)
    {
        var block = root;
        if (blockName is not null && !root.TryGetProperty(blockName, out block)) return [];
        if (block.ValueKind != JsonValueKind.Array) return [];
        return block.EnumerateArray().Select(item => Str(item, property)).OfType<string>().ToList();
    }

    private static string Sig(string s) => s.Length <= 60 ? s : s[..60];

    private static string Cut(string s, int max) => s.Length <= max ? s : s[..max];
}
