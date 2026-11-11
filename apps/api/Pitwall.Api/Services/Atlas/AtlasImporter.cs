using Pitwall.Data;

namespace Pitwall.Services.Atlas;

/// <summary>
/// Loads an installation's own map from a JSON file handed over at the moment (an upload in the
/// console, or <c>import-atlas &lt;path&gt;</c> on the command line). The file is never part of the
/// repository: the code ships empty, the data lives in the installation's database. Running it
/// again updates what is there instead of duplicating it. Format: docs/operacao/atlas.md.
/// </summary>
public sealed class AtlasImporter(PitwallDb db, AtlasWriter writer)
{
    public sealed record FileEnvironment(string? Slug, string? Name);
    public sealed record FileLink(string? To, string? Kind, bool? Planned, string? Label, string? Relation = null);
    public sealed record FileService(
        string? Name, string? Kind, string? Environment, string? Provider, string? ExternalRef, string? Url,
        string? Monitor, string? Notes, List<string>? Uses,
        string? Group = null, string? Condition = null, Dictionary<string, string>? Facts = null, List<string>? Items = null,
        string? Impact = null, string? Owner = null, string? Task = null, List<FileLink>? Links = null,
        string? Engine = null, string? Signature = null);
    public sealed record FileSystem(
        string? Slug, string? Name, string? Description, string? WebsiteUrl, string? Color,
        List<string>? Repos, List<FileService>? Services);
    public sealed record FileRoutine(string? Slug, string? Name, string? Frequency, string? System, string? Description, string? Prompt, bool? Enabled);
    public sealed record AtlasFile(
        List<FileEnvironment>? Environments, List<FileSystem>? Systems, List<FileService>? Shared, List<FileRoutine>? Routines,
        List<AtlasWriter.ProcessInput>? Processes = null);

    public sealed record Result(int Systems, int Services, int Links, int Repos, int Routines, List<string> Errors, int Processes = 0, int Steps = 0);

    private static AtlasWriter.ServiceInput Input(string? system, FileService s) => new(
        system, s.Environment, s.Name, s.Kind, s.Provider, s.ExternalRef, s.Url, s.Monitor, s.Notes,
        s.Group, s.Condition, s.Facts, s.Items, s.Impact, s.Owner, s.Task, Engine: s.Engine, Signature: s.Signature);

    private static IEnumerable<FileLink> LinksOf(FileService s) =>
        (s.Uses ?? []).Select(to => new FileLink(to, null, null, null)).Concat(s.Links ?? []);

    /// <summary>All or nothing: any line that does not fit comes back in <see cref="Result.Errors"/> and nothing is saved.</summary>
    public async Task<Result> RunAsync(AtlasFile file, bool dryRun, CancellationToken ct)
    {
        var errors = new List<string>();
        int systems = 0, services = 0, links = 0, repos = 0, routines = 0, processes = 0, steps = 0;
        var pending = new List<(string From, FileLink Link)>();

        foreach (var e in file.Environments ?? [])
            if ((await writer.UpsertEnvironmentAsync(e.Slug, e.Name, ct)).Error is { } error) errors.Add($"ambiente {e.Slug}: {error}");

        foreach (var s in file.Shared ?? [])
        {
            var (_, _, error) = await writer.UpsertServiceAsync(Input(null, s with { Environment = null }), ct);
            if (error is not null) errors.Add($"serviço compartilhado {s.Name}: {error}");
            else services++;
            pending.AddRange(LinksOf(s).Select(l => (s.Name!, l)));
        }

        foreach (var s in file.Systems ?? [])
        {
            var (system, _, error) = await writer.UpsertSystemAsync(new(s.Slug, s.Name, s.Description, s.WebsiteUrl, s.Color), ct);
            if (system is null) { errors.Add($"sistema {s.Slug}: {error}"); continue; }
            systems++;
            foreach (var repo in s.Repos ?? [])
            {
                if ((await writer.UpsertRepoAsync(repo, system.Slug, ct)).Error is { } repoError) errors.Add($"repositório {repo}: {repoError}");
                else repos++;
            }
            foreach (var svc in s.Services ?? [])
            {
                var (_, _, svcError) = await writer.UpsertServiceAsync(Input(system.Slug, svc), ct);
                if (svcError is not null) { errors.Add($"serviço {s.Slug}/{svc.Name}: {svcError}"); continue; }
                services++;
                var from = string.IsNullOrWhiteSpace(svc.Environment) ? $"{system.Slug}/{svc.Name}" : $"{system.Slug}/{svc.Environment}/{svc.Name}";
                pending.AddRange(LinksOf(svc).Select(l => (from, l)));
            }
        }

        // Links last: a service may lean on one declared further down the file.
        foreach (var (from, link) in pending)
        {
            if ((await writer.LinkAsync(from, link.To, link.Label, ct, link.Kind, link.Planned, link.Relation)).Error is { } error) errors.Add($"ligação {from} → {link.To}: {error}");
            else links++;
        }

        // Processes after the services: their steps point at them.
        foreach (var p in file.Processes ?? [])
        {
            var (_, _, error) = await writer.UpsertProcessAsync(p, ct);
            if (error is not null) { errors.Add($"processo {p.Slug}: {error}"); continue; }
            processes++;
            steps += p.Steps?.Count ?? 0;
        }

        foreach (var r in file.Routines ?? [])
        {
            var (_, _, error) = await writer.UpsertRoutineAsync(new(r.Slug, r.Name, r.Frequency, r.System, r.Description, r.Prompt, r.Enabled), ct);
            if (error is not null) errors.Add($"rotina {r.Slug}: {error}");
            else routines++;
        }

        if (errors.Count == 0 && !dryRun) await db.SaveChangesAsync(ct);
        return new Result(systems, services, links, repos, routines, errors, processes, steps);
    }
}
