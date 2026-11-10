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
    public sealed record FileService(
        string? Name, string? Kind, string? Environment, string? Provider, string? ExternalRef, string? Url,
        string? Monitor, string? Notes, List<string>? Uses);
    public sealed record FileSystem(
        string? Slug, string? Name, string? Description, string? WebsiteUrl, string? Color,
        List<string>? Repos, List<FileService>? Services);
    public sealed record FileRoutine(string? Slug, string? Name, string? Frequency, string? System, string? Description, string? Prompt, bool? Enabled);
    public sealed record AtlasFile(
        List<FileEnvironment>? Environments, List<FileSystem>? Systems, List<FileService>? Shared, List<FileRoutine>? Routines);

    public sealed record Result(int Systems, int Services, int Links, int Repos, int Routines, List<string> Errors);

    /// <summary>All or nothing: any line that does not fit comes back in <see cref="Result.Errors"/> and nothing is saved.</summary>
    public async Task<Result> RunAsync(AtlasFile file, bool dryRun, CancellationToken ct)
    {
        var errors = new List<string>();
        int systems = 0, services = 0, links = 0, repos = 0, routines = 0;
        var pending = new List<(string From, string To)>();

        foreach (var e in file.Environments ?? [])
            if ((await writer.UpsertEnvironmentAsync(e.Slug, e.Name, ct)).Error is { } error) errors.Add($"ambiente {e.Slug}: {error}");

        foreach (var s in file.Shared ?? [])
        {
            var (_, _, error) = await writer.UpsertServiceAsync(
                new(null, null, s.Name, s.Kind, s.Provider, s.ExternalRef, s.Url, s.Monitor, s.Notes), ct);
            if (error is not null) errors.Add($"serviço compartilhado {s.Name}: {error}");
            else services++;
            pending.AddRange((s.Uses ?? []).Select(to => (s.Name!, to)));
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
                var (_, _, svcError) = await writer.UpsertServiceAsync(
                    new(system.Slug, svc.Environment, svc.Name, svc.Kind, svc.Provider, svc.ExternalRef, svc.Url, svc.Monitor, svc.Notes), ct);
                if (svcError is not null) { errors.Add($"serviço {s.Slug}/{svc.Name}: {svcError}"); continue; }
                services++;
                var from = string.IsNullOrWhiteSpace(svc.Environment) ? $"{system.Slug}/{svc.Name}" : $"{system.Slug}/{svc.Environment}/{svc.Name}";
                pending.AddRange((svc.Uses ?? []).Select(to => (from, to)));
            }
        }

        // Links last: a service may lean on one declared further down the file.
        foreach (var (from, to) in pending)
        {
            if ((await writer.LinkAsync(from, to, null, ct)).Error is { } error) errors.Add($"ligação {from} → {to}: {error}");
            else links++;
        }

        foreach (var r in file.Routines ?? [])
        {
            var (_, _, error) = await writer.UpsertRoutineAsync(new(r.Slug, r.Name, r.Frequency, r.System, r.Description, r.Prompt, r.Enabled), ct);
            if (error is not null) errors.Add($"rotina {r.Slug}: {error}");
            else routines++;
        }

        if (errors.Count == 0 && !dryRun) await db.SaveChangesAsync(ct);
        return new Result(systems, services, links, repos, routines, errors);
    }
}
