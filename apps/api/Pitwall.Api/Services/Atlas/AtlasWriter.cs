using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas;

/// <summary>
/// The one place the Atlas is written from: the console, the MCP tools and the importer all
/// register through here, so "the same service" means the same thing to the three of them.
/// Every method is an upsert on the natural key and returns either the row or a message for
/// whoever asked. Nothing is saved until the caller saves.
/// </summary>
public sealed class AtlasWriter(PitwallDb db)
{
    public sealed record SystemInput(string? Slug, string? Name, string? Description = null, string? WebsiteUrl = null, string? Color = null);
    public sealed record ServiceInput(
        string? System, string? Environment, string? Name, string? Kind = null, string? Provider = null,
        string? ExternalRef = null, string? Url = null, string? Monitor = null, string? Notes = null,
        string? Group = null, string? Condition = null, Dictionary<string, string>? Facts = null, List<string>? Items = null,
        string? Impact = null, string? Owner = null, string? Task = null);
    public sealed record StageInput(string? Key, string? Name, string? Description = null);
    public sealed record StepInput(
        string? Slug, string? Name, string? Status = null, string? System = null, string? Stage = null, string? Owner = null,
        string? Today = null, string? Ideal = null, string? Next = null, string? Task = null, string? Impact = null,
        List<string>? Services = null);
    public sealed record ProcessInput(
        string? Slug, string? Name, string? Description = null, string? System = null, List<StageInput>? Stages = null,
        List<StepInput>? Steps = null);
    public sealed record RoutineInput(
        string? Slug, string? Name, string? Frequency, string? System = null, string? Description = null,
        string? Prompt = null, bool? Enabled = null);

    public static string? Slugify(string? s)
    {
        var slug = s?.Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(slug) || slug.Length > 60 || !slug.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '-')
            ? null : slug;
    }

    public async Task<Product?> FindSystemAsync(string? slugOrId, CancellationToken ct)
    {
        var s = slugOrId?.Trim() ?? "";
        if (s.Length == 0) return null;
        if (Guid.TryParse(s, out var id)) return await db.Products.FirstOrDefaultAsync(p => p.Id == id, ct);
        var slug = s.ToLowerInvariant();
        return db.Products.Local.FirstOrDefault(p => p.Slug == slug) ?? await db.Products.FirstOrDefaultAsync(p => p.Slug == slug, ct);
    }

    /// <summary>A system is a product: registering one that exists updates what was sent and keeps the rest.</summary>
    public async Task<(Product? System, bool Created, string? Error)> UpsertSystemAsync(SystemInput input, CancellationToken ct)
    {
        var slug = Slugify(input.Slug);
        if (slug is null || slug.Length > 40) return (null, false, "O identificador do sistema usa só letras minúsculas, números e hífen (até 40).");
        if (input.Color is { Length: > 0 } color && !System.Text.RegularExpressions.Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$"))
            return (null, false, "A cor usa o formato #rrggbb.");
        if (input.WebsiteUrl is { Length: > 0 } site && !IsHttpUrl(site)) return (null, false, "O site precisa ser um endereço http(s).");

        var now = DateTime.UtcNow;
        var system = await FindSystemAsync(slug, ct);
        var created = system is null;
        if (system is null)
        {
            var name = Clean.Cut(input.Name, 80);
            if (name is null) return (null, false, "Dê um nome ao sistema (até 80 caracteres).");
            system = new Product { Id = Guid.NewGuid(), Slug = slug, Name = name, CreatedAt = now, UpdatedAt = now };
            db.Products.Add(system);
        }
        else if (Clean.Cut(input.Name, 80) is { } name) system.Name = name;
        if (input.Description is not null) system.Description = Clean.Cut(input.Description, 1000);
        if (input.WebsiteUrl is not null) system.WebsiteUrl = Clean.Cut(input.WebsiteUrl, 300);
        if (input.Color is not null) system.Color = Clean.Cut(input.Color, 7)?.ToLowerInvariant();
        system.UpdatedAt = now;
        return (system, created, null);
    }

    public async Task<(AtlasEnvironment? Environment, string? Error)> UpsertEnvironmentAsync(string? slugOrName, string? name, CancellationToken ct)
    {
        var slug = Slugify(slugOrName?.Trim().Replace(' ', '-'));
        if (slug is null || slug.Length > 40) return (null, "O ambiente usa só letras minúsculas, números e hífen (até 40), como staging ou production.");
        var env = db.AtlasEnvironments.Local.FirstOrDefault(e => e.Slug == slug) ?? await db.AtlasEnvironments.FirstOrDefaultAsync(e => e.Slug == slug, ct);
        if (env is null)
        {
            var known = await db.AtlasEnvironments.CountAsync(ct) + db.AtlasEnvironments.Local.Count(e => db.Entry(e).State == EntityState.Added);
            env = new AtlasEnvironment
            {
                Id = Guid.NewGuid(), Slug = slug, Name = Clean.Cut(name, 80) ?? slug, Position = known, CreatedAt = DateTime.UtcNow,
            };
            db.AtlasEnvironments.Add(env);
        }
        else if (Clean.Cut(name, 80) is { } n) env.Name = n;
        return (env, null);
    }

    /// <summary>
    /// A service, found by system + environment + name. No system = an outside service shared by the
    /// operation, which has no environment either.
    /// </summary>
    public async Task<(AtlasService? Service, bool Created, string? Error)> UpsertServiceAsync(ServiceInput input, CancellationToken ct)
    {
        var name = Clean.Cut(input.Name, 120);
        if (name is null) return (null, false, "Dê um nome ao serviço (até 120 caracteres).");
        Product? system = null;
        if (!string.IsNullOrWhiteSpace(input.System) && (system = await FindSystemAsync(input.System, ct)) is null)
            return (null, false, "Sistema não encontrado. Cadastre-o antes (register_system).");
        AtlasEnvironment? env = null;
        if (system is not null && !string.IsNullOrWhiteSpace(input.Environment))
        {
            (env, var envError) = await UpsertEnvironmentAsync(input.Environment, null, ct);
            if (envError is not null) return (null, false, envError);
        }
        var kind = input.Kind?.Trim().ToLowerInvariant();
        if (kind is { Length: > 0 } && !AtlasServiceKinds.IsValid(kind))
            return (null, false, $"Tipo inválido. Use {string.Join(", ", AtlasServiceKinds.All)}.");
        if (input.Url is { Length: > 0 } url && !IsHttpUrl(url)) return (null, false, "O endereço do serviço precisa ser http(s).");
        if (Declared(input.Condition, input.Impact, input.Owner, input.Task) is { } declaredError) return (null, false, declaredError);
        if (input.Facts is { Count: > 40 }) return (null, false, "No máximo 40 detalhes por serviço.");
        if (input.Items is { Count: > 200 }) return (null, false, "No máximo 200 itens por serviço.");

        Guid? productId = system?.Id, envId = env?.Id;
        var service = db.AtlasServices.Local.FirstOrDefault(s => s.ProductId == productId && s.EnvironmentId == envId && s.Name == name)
            ?? await db.AtlasServices.FirstOrDefaultAsync(s => s.ProductId == productId && s.EnvironmentId == envId && s.Name == name, ct);
        var now = DateTime.UtcNow;
        var created = service is null;
        if (service is null)
        {
            var initialKind = kind is { Length: > 0 } ? kind : system is null ? AtlasServiceKinds.External : AtlasServiceKinds.Other;
            service = new AtlasService
            {
                Id = Guid.NewGuid(), ProductId = productId, EnvironmentId = envId, Name = name, CreatedAt = now,
                Kind = initialKind, Engine = AtlasEngines.ForKind(initialKind),
                Key = await NewKeyAsync(system, env, name, ct),
            };
            db.AtlasServices.Add(service);
        }
        // The map column follows the kind only while nobody chose one by hand.
        else if (kind is { Length: > 0 } && kind != service.Kind)
        {
            if (service.Engine == AtlasEngines.ForKind(service.Kind)) service.Engine = AtlasEngines.ForKind(kind);
            service.Kind = kind;
        }
        if (input.Provider is not null) service.Provider = Clean.Cut(input.Provider, 40)?.ToLowerInvariant();
        if (input.ExternalRef is not null) service.ExternalRef = Clean.Cut(input.ExternalRef, 300);
        if (input.Url is not null) service.Url = Clean.Cut(input.Url, 500);
        if (input.Monitor is not null) service.MonitorRef = Clean.Cut(input.Monitor, 200);
        if (input.Notes is not null) service.Notes = Clean.Cut(input.Notes, 2000);
        if (input.Group is not null) service.Group = Clean.Cut(input.Group, 60);
        if (Lower(input.Condition) is { Length: > 0 } condition) service.Condition = condition;
        if (input.Impact is not null) service.Impact = Lower(input.Impact) is { Length: > 0 } i ? i : null;
        if (input.Owner is not null) service.Owner = Lower(input.Owner) is { Length: > 0 } o ? o : null;
        if (input.Task is not null) service.TaskCode = Clean.Cut(input.Task, 20)?.ToUpperInvariant();
        if (input.Facts is not null)
            service.Facts = input.Facts
                .Select(f => (Key: Clean.Cut(f.Key, 60), Value: Clean.Cut(f.Value, 500)))
                .Where(f => f.Key is not null && f.Value is not null)
                .Select(f => new AtlasFact { Key = f.Key!, Value = f.Value! }).ToList();
        if (input.Items is not null)
            service.Items = input.Items.Select(i => Clean.Cut(i, 120)).OfType<string>().Distinct().ToList();
        service.UpdatedAt = now;
        return (service, created, null);
    }

    /// <summary>The checks shared by what a service and a step declare about themselves.</summary>
    private static string? Declared(string? condition, string? impact, string? owner, string? task, bool step = false)
    {
        var c = Lower(condition);
        if (c is { Length: > 0 } && !(step ? AtlasStepStatuses.IsValid(c) : AtlasConditions.IsValid(c)))
            return step
                ? $"Situação inválida. Use {string.Join(", ", AtlasStepStatuses.All)}."
                : $"Condição inválida. Use {string.Join(", ", AtlasConditions.All)}.";
        if (Lower(impact) is { Length: > 0 } i && !AtlasImpacts.IsValid(i)) return $"Impacto inválido. Use {string.Join(", ", AtlasImpacts.All)}.";
        if (Lower(owner) is { Length: > 0 } o && !AtlasOwners.IsValid(o)) return $"Responsável inválido. Use {string.Join(", ", AtlasOwners.All)}.";
        if (task is { Length: > 20 }) return "O código da tarefa tem até 20 caracteres.";
        return null;
    }

    private static string? Lower(string? s) => s?.Trim().ToLowerInvariant();

    /// <summary>
    /// The stable key of a new service: <c>{system or shared}:{environment or any}:{name slug}</c>.
    /// A taken key gets <c>-2</c>, <c>-3</c>… so two services with the same name stay two nodes.
    /// </summary>
    public async Task<string> NewKeyAsync(Product? system, AtlasEnvironment? env, string name, CancellationToken ct)
    {
        var baseKey = $"{system?.Slug ?? "shared"}:{env?.Slug ?? "any"}:{NameSlug(name)}";
        var key = baseKey;
        for (var n = 2; ; n++)
        {
            var taken = db.AtlasServices.Local.Any(s => s.Key == key)
                || await db.AtlasServices.AnyAsync(s => s.Key == key, ct);
            if (!taken) return key;
            key = $"{baseKey}-{n}";
        }
    }

    /// <summary>A name as a key part: no accents, lower case, anything but a-z and 0-9 becomes a dash, at most 60.</summary>
    public static string NameSlug(string name)
    {
        var decomposed = name.Normalize(System.Text.NormalizationForm.FormD);
        var plain = new string(decomposed.Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark).ToArray());
        var dashed = System.Text.RegularExpressions.Regex.Replace(plain.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        if (dashed.Length > 60) dashed = dashed[..60].TrimEnd('-');
        return dashed.Length == 0 ? "servico" : dashed;
    }

    /// <summary>
    /// A service by id, or by name: <c>Name</c> for an outside service, <c>system/Name</c> or
    /// <c>system/environment/Name</c> for one of a system's.
    /// </summary>
    public async Task<AtlasService?> FindServiceAsync(string? reference, CancellationToken ct)
    {
        var r = reference?.Trim() ?? "";
        if (r.Length == 0) return null;
        if (Guid.TryParse(r, out var id)) return await db.AtlasServices.FirstOrDefaultAsync(s => s.Id == id, ct);
        var parts = r.Split('/', 3, StringSplitOptions.TrimEntries);
        var all = db.AtlasServices.Local.ToList();
        var stored = await db.AtlasServices.Include(s => s.Product).Include(s => s.Environment).ToListAsync(ct);
        all.AddRange(stored.Where(s => all.All(a => a.Id != s.Id)));
        bool Same(string? a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        if (parts.Length == 1) return all.FirstOrDefault(s => s.ProductId is null && Same(s.Name, parts[0])) ?? all.FirstOrDefault(s => Same(s.Name, parts[0]));
        var system = await FindSystemAsync(parts[0], ct);
        if (system is null) return null;
        var own = all.Where(s => s.ProductId == system.Id);
        if (parts.Length == 2) return own.FirstOrDefault(s => Same(s.Name, parts[1]));
        return own.FirstOrDefault(s => Same(s.Name, parts[2]) && s.EnvironmentId is { } e
            && Same((db.AtlasEnvironments.Local.FirstOrDefault(x => x.Id == e) ?? s.Environment)?.Slug, parts[1]));
    }

    public async Task<(AtlasLink? Link, string? Error)> LinkAsync(
        string? from, string? to, string? label, CancellationToken ct, string? kind = null, bool? planned = null)
    {
        var a = await FindServiceAsync(from, ct);
        var b = await FindServiceAsync(to, ct);
        if (a is null) return (null, $"Serviço de origem não encontrado: {Clean.Cut(from, 120)}.");
        if (b is null) return (null, $"Serviço de destino não encontrado: {Clean.Cut(to, 120)}.");
        if (a.Id == b.Id) return (null, "Um serviço não se liga a si mesmo.");
        var k = Lower(kind);
        if (k is { Length: > 0 } && !AtlasLinkKinds.IsValid(k)) return (null, $"Tipo de ligação inválido. Use {string.Join(", ", AtlasLinkKinds.All)}.");
        var link = db.AtlasLinks.Local.FirstOrDefault(l => l.FromServiceId == a.Id && l.ToServiceId == b.Id)
            ?? await db.AtlasLinks.FirstOrDefaultAsync(l => l.FromServiceId == a.Id && l.ToServiceId == b.Id, ct);
        if (link is null)
        {
            link = new AtlasLink
            {
                Id = Guid.NewGuid(), FromServiceId = a.Id, ToServiceId = b.Id, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            };
            db.AtlasLinks.Add(link);
        }
        if (label is not null) link.Label = Clean.Cut(label, 80);
        if (k is { Length: > 0 }) link.Kind = k;
        if (planned is { } p) link.Planned = p;
        return (link, null);
    }

    public async Task<AtlasProcess?> FindProcessAsync(string? slugOrId, CancellationToken ct)
    {
        var s = slugOrId?.Trim().ToLowerInvariant() ?? "";
        if (s.Length == 0) return null;
        if (Guid.TryParse(s, out var id))
            return db.AtlasProcesses.Local.FirstOrDefault(p => p.Id == id) ?? await db.AtlasProcesses.Include(p => p.Steps).FirstOrDefaultAsync(p => p.Id == id, ct);
        return db.AtlasProcesses.Local.FirstOrDefault(p => p.Slug == s) ?? await db.AtlasProcesses.Include(p => p.Steps).FirstOrDefaultAsync(p => p.Slug == s, ct);
    }

    /// <summary>
    /// A process, by slug. Sending <c>Steps</c> sends the whole process: steps matched by slug are
    /// updated, new ones added, the ones left out removed. Without <c>Steps</c> they stay as they are.
    /// </summary>
    public async Task<(AtlasProcess? Process, bool Created, string? Error)> UpsertProcessAsync(ProcessInput input, CancellationToken ct)
    {
        var slug = Slugify(input.Slug);
        if (slug is null) return (null, false, "O identificador do processo usa só letras minúsculas, números e hífen (até 60).");
        Guid? productId = null;
        if (!string.IsNullOrWhiteSpace(input.System))
        {
            if (await FindSystemAsync(input.System, ct) is { } p) productId = p.Id;
            else return (null, false, "Sistema não encontrado. Cadastre-o antes (register_system).");
        }
        var stages = new List<AtlasStage>();
        foreach (var st in input.Stages ?? [])
        {
            var key = Slugify(st.Key);
            var stageName = Clean.Cut(st.Name, 80);
            if (key is null || stageName is null) return (null, false, "Cada estágio tem um identificador (letras minúsculas, números e hífen) e um nome.");
            if (stages.Any(x => x.Key == key)) return (null, false, $"Estágio repetido: {key}.");
            stages.Add(new AtlasStage { Key = key, Name = stageName, Description = Clean.Cut(st.Description, 300) });
        }

        var process = await FindProcessAsync(slug, ct);
        var now = DateTime.UtcNow;
        var created = process is null;
        if (process is null)
        {
            var name = Clean.Cut(input.Name, 120);
            if (name is null) return (null, false, "Dê um nome ao processo (até 120 caracteres).");
            var position = await db.AtlasProcesses.CountAsync(ct) + db.AtlasProcesses.Local.Count(p => db.Entry(p).State == EntityState.Added);
            process = new AtlasProcess { Id = Guid.NewGuid(), Slug = slug, Name = name, Position = position, CreatedAt = now };
            db.AtlasProcesses.Add(process);
        }
        else if (Clean.Cut(input.Name, 120) is { } name) process.Name = name;
        if (input.Description is not null) process.Description = Clean.Cut(input.Description, 1000);
        if (input.System is not null) process.ProductId = productId;
        if (input.Stages is not null) process.Stages = stages;
        process.UpdatedAt = now;

        if (input.Steps is not null)
        {
            var seen = new HashSet<string>();
            for (var i = 0; i < input.Steps.Count; i++)
            {
                var (step, error) = await UpsertStepAsync(process, input.Steps[i], ct, position: i);
                if (step is null) return (null, false, $"Etapa {input.Steps[i].Slug ?? input.Steps[i].Name}: {error}");
                if (!seen.Add(step.Slug)) return (null, false, $"Etapa repetida: {step.Slug}.");
            }
            foreach (var gone in process.Steps.Where(s => !seen.Contains(s.Slug)).ToList())
            {
                process.Steps.Remove(gone);
                db.AtlasSteps.Remove(gone);
            }
        }
        return (process, created, null);
    }

    /// <summary>One step of a process, by slug: what is sent changes, the rest stays.</summary>
    public async Task<(AtlasStep? Step, string? Error)> UpsertStepAsync(AtlasProcess process, StepInput input, CancellationToken ct, int? position = null)
    {
        var slug = Slugify(input.Slug);
        if (slug is null) return (null, "O identificador da etapa usa só letras minúsculas, números e hífen (até 60).");
        if (Declared(input.Status, input.Impact, input.Owner, input.Task, step: true) is { } error) return (null, error);
        var stage = Lower(input.Stage);
        if (stage is { Length: > 0 } && process.Stages.All(s => s.Key != stage))
            return (null, process.Stages.Count == 0 ? "Este processo não tem estágios." : $"Estágio desconhecido. Use {string.Join(", ", process.Stages.Select(s => s.Key))}.");
        Guid? productId = null;
        if (!string.IsNullOrWhiteSpace(input.System))
        {
            if (await FindSystemAsync(input.System, ct) is { } p) productId = p.Id;
            else return (null, "Sistema não encontrado. Cadastre-o antes (register_system).");
        }
        List<Guid>? serviceIds = null;
        if (input.Services is not null)
        {
            serviceIds = [];
            foreach (var reference in input.Services.Take(30))
            {
                if (await FindServiceAsync(reference, ct) is not { } svc) return (null, $"Serviço não encontrado: {Clean.Cut(reference, 120)}.");
                if (!serviceIds.Contains(svc.Id)) serviceIds.Add(svc.Id);
            }
        }

        var step = process.Steps.FirstOrDefault(s => s.Slug == slug);
        if (step is null)
        {
            var name = Clean.Cut(input.Name, 120);
            if (name is null) return (null, "Dê um nome à etapa (até 120 caracteres).");
            step = new AtlasStep { Id = Guid.NewGuid(), ProcessId = process.Id, Slug = slug, Name = name, Position = position ?? process.Steps.Count };
            process.Steps.Add(step);
            db.AtlasSteps.Add(step);
        }
        else if (Clean.Cut(input.Name, 120) is { } name) step.Name = name;
        if (position is { } pos) step.Position = pos;
        if (Lower(input.Status) is { Length: > 0 } status) step.Status = status;
        if (input.System is not null) step.ProductId = productId;
        if (input.Stage is not null) step.Stage = stage is { Length: > 0 } ? stage : null;
        if (input.Owner is not null) step.Owner = Lower(input.Owner) is { Length: > 0 } o ? o : null;
        if (input.Impact is not null) step.Impact = Lower(input.Impact) is { Length: > 0 } i ? i : null;
        if (input.Today is not null) step.Today = Clean.Cut(input.Today, 2000);
        if (input.Ideal is not null) step.Ideal = Clean.Cut(input.Ideal, 2000);
        if (input.Next is not null) step.Next = Clean.Cut(input.Next, 1000);
        if (input.Task is not null) step.TaskCode = Clean.Cut(input.Task, 20)?.ToUpperInvariant();
        if (serviceIds is not null) step.ServiceIds = serviceIds;
        step.UpdatedAt = DateTime.UtcNow;
        return (step, null);
    }

    public async Task<(AtlasRepo? Repo, string? Error)> UpsertRepoAsync(string? fullName, string? system, CancellationToken ct)
    {
        var name = fullName?.Trim().ToLowerInvariant() ?? "";
        var parts = name.Split('/');
        if (name.Length > 200 || parts.Length != 2 || parts.Any(p => p.Length == 0 || !p.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.')))
            return (null, "O repositório usa o formato dono/nome.");
        Product? product = null;
        if (!string.IsNullOrWhiteSpace(system) && (product = await FindSystemAsync(system, ct)) is null)
            return (null, "Sistema não encontrado. Cadastre-o antes (register_system).");
        var repo = db.AtlasRepos.Local.FirstOrDefault(r => r.FullName == name) ?? await db.AtlasRepos.FirstOrDefaultAsync(r => r.FullName == name, ct);
        if (repo is null)
        {
            repo = new AtlasRepo { Id = Guid.NewGuid(), FullName = name, CreatedAt = DateTime.UtcNow };
            db.AtlasRepos.Add(repo);
        }
        if (product is not null) repo.ProductId = product.Id;
        return (repo, null);
    }

    public async Task<(AtlasRoutine? Routine, bool Created, string? Error)> UpsertRoutineAsync(RoutineInput input, CancellationToken ct)
    {
        var slug = Slugify(input.Slug);
        if (slug is null) return (null, false, "O identificador da rotina usa só letras minúsculas, números e hífen (até 60).");
        var routine = db.AtlasRoutines.Local.FirstOrDefault(r => r.Slug == slug) ?? await db.AtlasRoutines.FirstOrDefaultAsync(r => r.Slug == slug, ct);
        var frequency = input.Frequency?.Trim().ToLowerInvariant();
        if (frequency is { Length: > 0 } && !AtlasFrequencies.IsValid(frequency))
            return (null, false, $"Frequência inválida. Use {string.Join(", ", AtlasFrequencies.All)}.");
        Guid? productId = routine?.ProductId;
        if (input.System is not null)
        {
            if (input.System.Trim().Length == 0) productId = null;
            else if (await FindSystemAsync(input.System, ct) is { } p) productId = p.Id;
            else return (null, false, "Sistema não encontrado. Cadastre-o antes (register_system).");
        }
        var now = DateTime.UtcNow;
        var created = routine is null;
        if (routine is null)
        {
            var name = Clean.Cut(input.Name, 120);
            if (name is null) return (null, false, "Dê um nome à rotina (até 120 caracteres).");
            if (frequency is not { Length: > 0 }) return (null, false, "Diga a frequência: daily, weekly ou monthly.");
            routine = new AtlasRoutine { Id = Guid.NewGuid(), Slug = slug, Name = name, CreatedAt = now };
            db.AtlasRoutines.Add(routine);
        }
        else if (Clean.Cut(input.Name, 120) is { } name) routine.Name = name;
        if (frequency is { Length: > 0 }) routine.Frequency = frequency;
        routine.ProductId = productId;
        if (input.Description is not null) routine.Description = Clean.Cut(input.Description, 1000);
        if (input.Prompt is not null) routine.Prompt = Clean.Cut(input.Prompt, 20_000) ?? "";
        if (input.Enabled is { } enabled) routine.Enabled = enabled;
        routine.UpdatedAt = now;
        return (routine, created, null);
    }

    private static bool IsHttpUrl(string s) =>
        Uri.TryCreate(s.Trim(), UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps);
}
