using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Atlas;

namespace Pitwall.Endpoints.Staff;

/// <summary>
/// The Atlas: what the team runs, where, in what state, and what is happening to it right now.
/// Read by the console; written by the console, by the Pitwall MCP (a personal token with the
/// <c>atlas</c> scope) and by the collectors. It ships empty: an installation registers its own
/// systems, or loads them once from a file with the importer.
/// </summary>
public static class StaffAtlasEndpoints
{
    /// <summary>An activity or a run nobody closed stops counting as "now" after this long.</summary>
    public static readonly TimeSpan ActivityStaleAfter = TimeSpan.FromHours(12);
    public static readonly TimeSpan RunStaleAfter = TimeSpan.FromHours(6);
    private const int RunHistory = 30;

    public sealed record LinkRequest(string? From, string? To, string? Label);
    public sealed record RepoRequest(string? FullName, string? System);
    public sealed record EnvironmentRequest(string? Slug, string? Name);
    public sealed record ActivityRequest(string? System, string? Component, string? Description);
    public sealed record FinishRequest(string? Status, string? Result, List<RunLinkInput?>? Links);
    public sealed record RunLinkInput(string? Kind, string? Label, string? Url);
    public sealed record RegisterDiscoveryRequest(string? System, string? Environment, string? Name, string? Kind);

    public static IEndpointRouteBuilder MapStaffAtlasEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff/atlas").RequireAuthorization(Policies.Atlas).WithTags("Staff");
        group.MapGet("", Overview);
        group.MapGet("/flows", Flows);
        group.MapGet("/routines", Routines);
        group.MapGet("/routines/{routine}/runs", RoutineRuns);

        var writes = group.MapGroup("").RequireRateLimiting("tasks-writes");
        writes.MapPost("/systems", async (AtlasWriter.SystemInput req, AtlasWriter writer, PitwallDb db, CancellationToken ct) =>
        {
            var (system, created, error) = await writer.UpsertSystemAsync(req, ct);
            if (system is null) return Bad(error!);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { system.Id, system.Slug, system.Name, created });
        });
        writes.MapPost("/environments", async (EnvironmentRequest req, AtlasWriter writer, PitwallDb db, CancellationToken ct) =>
        {
            var (env, error) = await writer.UpsertEnvironmentAsync(req.Slug, req.Name, ct);
            if (env is null) return Bad(error!);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { env.Id, env.Slug, env.Name, env.Position });
        });
        writes.MapDelete("/environments/{id:guid}", async (Guid id, PitwallDb db, CancellationToken ct) =>
        {
            if (await db.AtlasServices.AnyAsync(s => s.EnvironmentId == id, ct)) return Results.Conflict(new { message = "Ainda há serviços nesse ambiente." });
            await db.AtlasEnvironments.Where(e => e.Id == id).ExecuteDeleteAsync(ct);
            return Results.NoContent();
        });
        writes.MapPost("/services", async (AtlasWriter.ServiceInput req, AtlasWriter writer, PitwallDb db, CancellationToken ct) =>
        {
            var (service, created, error) = await writer.UpsertServiceAsync(req, ct);
            if (service is null) return Bad(error!);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { service.Id, service.Name, created });
        });
        writes.MapDelete("/services/{id:guid}", async (Guid id, PitwallDb db, CancellationToken ct) =>
        {
            await db.AtlasServices.Where(s => s.Id == id).ExecuteDeleteAsync(ct);
            return Results.NoContent();
        });
        writes.MapPost("/links", async (LinkRequest req, AtlasWriter writer, PitwallDb db, CancellationToken ct) =>
        {
            var (link, error) = await writer.LinkAsync(req.From, req.To, req.Label, ct);
            if (link is null) return Bad(error!);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { link.Id, from = link.FromServiceId, to = link.ToServiceId, link.Label });
        });
        writes.MapDelete("/links/{id:guid}", async (Guid id, PitwallDb db, CancellationToken ct) =>
        {
            await db.AtlasLinks.Where(l => l.Id == id).ExecuteDeleteAsync(ct);
            return Results.NoContent();
        });
        writes.MapPost("/repos", async (RepoRequest req, AtlasWriter writer, PitwallDb db, CancellationToken ct) =>
        {
            var (repo, error) = await writer.UpsertRepoAsync(req.FullName, req.System, ct);
            if (repo is null) return Bad(error!);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { repo.Id, repo.FullName });
        });
        writes.MapDelete("/repos/{id:guid}", async (Guid id, PitwallDb db, CancellationToken ct) =>
        {
            await db.AtlasRepos.Where(r => r.Id == id).ExecuteDeleteAsync(ct);
            return Results.NoContent();
        });

        writes.MapPost("/routines", async (AtlasWriter.RoutineInput req, AtlasWriter writer, PitwallDb db, CancellationToken ct) =>
        {
            var (routine, created, error) = await writer.UpsertRoutineAsync(req, ct);
            if (routine is null) return Bad(error!);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { routine.Id, routine.Slug, routine.Name, routine.Frequency, routine.Enabled, created });
        });
        writes.MapDelete("/routines/{id:guid}", async (Guid id, PitwallDb db, CancellationToken ct) =>
        {
            await db.AtlasRoutines.Where(r => r.Id == id).ExecuteDeleteAsync(ct);
            return Results.NoContent();
        });
        writes.MapPost("/routines/{routine}/runs", StartRun);
        writes.MapPost("/runs/{id:guid}/finish", FinishRun);

        writes.MapPost("/activities", StartActivity);
        writes.MapPost("/activities/{id:guid}/finish", FinishActivity);

        writes.MapPost("/discoveries/{id:guid}/register", RegisterDiscovery);
        writes.MapPost("/discoveries/{id:guid}/dismiss", async (Guid id, PitwallDb db, CancellationToken ct) =>
        {
            await db.AtlasDiscoveries.Where(d => d.Id == id).ExecuteUpdateAsync(s => s.SetProperty(d => d.DismissedAt, DateTime.UtcNow), ct);
            return Results.NoContent();
        });
        writes.MapPost("/collect", async (AtlasCollectorRunner runner, CancellationToken ct) =>
        {
            await runner.RunAllAsync(ct);
            return Results.NoContent();
        });

        // Loading a whole map at once is an admin's call, from the console only.
        app.MapPost("/v1/staff/atlas/import", async (AtlasImporter.AtlasFile file, AtlasImporter importer, CancellationToken ct, [FromQuery] bool dryRun = false) =>
        {
            var result = await importer.RunAsync(file, dryRun, ct);
            return result.Errors.Count == 0 ? Results.Ok(result) : Results.BadRequest(new { message = "O arquivo tem linhas inválidas. Nada foi gravado.", result.Errors });
        }).RequireAuthorization(Policies.StaffAdmin).WithTags("Staff");
        return app;
    }

    // ---- Reads -------------------------------------------------------------------------------

    private static async Task<IResult> Overview(PitwallDb db, AtlasCollectorRunner runner, AtlasCollectorStatus status, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var products = await db.Products.AsNoTracking().Where(p => p.DisabledAt == null).OrderBy(p => p.Name).ToListAsync(ct);
        var environments = await db.AtlasEnvironments.AsNoTracking().OrderBy(e => e.Position).ThenBy(e => e.Slug).ToListAsync(ct);
        var services = await db.AtlasServices.AsNoTracking().OrderBy(s => s.Name).ToListAsync(ct);
        var links = await db.AtlasLinks.AsNoTracking().ToListAsync(ct);
        var repos = await db.AtlasRepos.AsNoTracking().OrderBy(r => r.FullName).ToListAsync(ct);
        var discoveries = await db.AtlasDiscoveries.AsNoTracking().Where(d => d.DismissedAt == null).OrderBy(d => d.Source).ThenBy(d => d.Name).ToListAsync(ct);

        var tasks = await db.TeamTasks.AsNoTracking().Where(t => t.ArchivedAt == null && t.Status != TeamTaskStatuses.Done && t.ProductId != null)
            .GroupBy(t => t.ProductId!.Value).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        string[] openStatuses = [TicketStatuses.Open, TicketStatuses.InProgress];
        var tickets = await db.Tickets.AsNoTracking().Where(t => openStatuses.Contains(t.Status))
            .GroupBy(t => t.ProductId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var dayAgo = now.AddDays(-1);
        var errors = await db.ServerErrors.AsNoTracking().Where(e => e.OccurredAt >= dayAgo)
            .GroupBy(e => e.ProductId).Select(g => new { g.Key, Count = g.Select(e => e.Signature).Distinct().Count() })
            .ToDictionaryAsync(g => g.Key, g => g.Count, ct);

        var systems = products.Select(p =>
        {
            var own = services.Where(s => s.ProductId == p.Id).ToList();
            return new
            {
                p.Id, p.Slug, p.Name, p.Color, p.Description, p.WebsiteUrl,
                health = new
                {
                    total = own.Count,
                    up = own.Count(s => s.State == AtlasStates.Up),
                    down = own.Count(s => s.State == AtlasStates.Down),
                    degraded = own.Count(s => s.State == AtlasStates.Degraded),
                    deploying = own.Count(s => s.State == AtlasStates.Deploying),
                    unknown = own.Count(s => s.State == AtlasStates.Unknown),
                },
                pending = new
                {
                    tasks = tasks.GetValueOrDefault(p.Id),
                    tickets = tickets.GetValueOrDefault(p.Id),
                    errors = errors.GetValueOrDefault(p.Id),
                    // Null when no repository of the system could be read for alerts.
                    alerts = repos.Where(r => r.ProductId == p.Id && r.OpenAlerts != null).Select(r => r.OpenAlerts).DefaultIfEmpty().Sum(),
                },
            };
        });

        return Results.Ok(new
        {
            serverTime = now,
            systems,
            environments = environments.Select(e => new { e.Id, e.Slug, e.Name }),
            services = services.Select(s => new
            {
                s.Id, s.ProductId, s.EnvironmentId, s.Name, s.Kind, s.Provider, s.ExternalRef, s.Url, monitor = s.MonitorRef, s.Notes,
                s.State, s.MonitorStatus, s.DeployStatus, s.LastDeployAt, s.CommitSha, s.CheckedAt,
            }),
            links = links.Select(l => new { l.Id, from = l.FromServiceId, to = l.ToServiceId, l.Label }),
            repos = repos.Select(r => new
            {
                r.Id, r.ProductId, r.FullName, r.LastRunName, r.LastRunStatus, r.LastRunAt, r.LastRunUrl, r.LastRunSha,
                r.Commits7d, r.Runs7d, r.FailedRuns7d, r.OpenAlerts, r.CheckedAt,
            }),
            collectors = runner.Collectors.Select(c => new
            {
                c.Name, connected = c.Configured, lastRunAt = status.Last(c.Name)?.At, error = status.Last(c.Name)?.Error,
            }),
            now = await NowAsync(db, services, now, ct),
            discoveries = discoveries.Select(d => new { d.Id, d.Source, d.Kind, d.ExternalRef, d.Name, d.Environment, d.Url, d.FirstSeenAt }),
        });
    }

    public sealed record NowItem(string Kind, string Id, Guid? ProductId, Guid? ServiceId, string Title, string? Detail, string? Actor, DateTime? Since);

    /// <summary>What is going on at this moment: open activities, routines mid-run, deploys under way, services down.</summary>
    private static async Task<List<NowItem>> NowAsync(PitwallDb db, List<AtlasService> services, DateTime now, CancellationToken ct)
    {
        var items = new List<NowItem>();
        items.AddRange(services.Where(s => s.State == AtlasStates.Down)
            .Select(s => new NowItem("down", s.Id.ToString(), s.ProductId, s.Id, s.Name, s.MonitorRef, null, s.CheckedAt)));
        items.AddRange(services.Where(s => s.State == AtlasStates.Deploying)
            .Select(s => new NowItem("deploy", s.Id.ToString(), s.ProductId, s.Id, s.Name, s.Provider, null, s.LastDeployAt)));

        var activityCutoff = now - ActivityStaleAfter;
        var activities = await db.AtlasActivities.AsNoTracking()
            .Where(a => a.Status == AtlasRunStatuses.Running && a.StartedAt >= activityCutoff).OrderBy(a => a.StartedAt).ToListAsync(ct);
        items.AddRange(activities.Select(a => new NowItem("activity", a.Id.ToString(), a.ProductId, a.ServiceId, a.Description, a.Component, a.ActorName, a.StartedAt)));

        var runCutoff = now - RunStaleAfter;
        var runs = await db.AtlasRoutineRuns.AsNoTracking().Include(r => r.Routine)
            .Where(r => r.Status == AtlasRunStatuses.Running && r.StartedAt >= runCutoff).OrderBy(r => r.StartedAt).ToListAsync(ct);
        items.AddRange(runs.Select(r => new NowItem("routine", r.Id.ToString(), r.Routine.ProductId, null, r.Routine.Name, r.Routine.Frequency, r.ActorName, r.StartedAt)));
        return items;
    }

    public sealed record FlowStep(string Key, int? Value, string? Detail = null);

    /// <summary>
    /// Each system's flows, left to right, with the number of each step over the last 7 days (30
    /// for content). A step with no number is a gap: no data yet, or no process behind it.
    /// </summary>
    private static async Task<IResult> Flows(PitwallDb db, CancellationToken ct, [FromQuery] string? system = null)
    {
        var now = DateTime.UtcNow;
        var week = now.AddDays(-7);
        var month = now.AddDays(-30);
        var products = await db.Products.AsNoTracking().Where(p => p.DisabledAt == null).OrderBy(p => p.Name).ToListAsync(ct);
        if (!string.IsNullOrWhiteSpace(system))
        {
            var s = system.Trim().ToLowerInvariant();
            products = products.Where(p => p.Slug == s || p.Id.ToString() == s).ToList();
        }
        var ids = products.Select(p => p.Id).ToList();
        var repos = await db.AtlasRepos.AsNoTracking().Where(r => r.ProductId != null && ids.Contains(r.ProductId.Value)).ToListAsync(ct);
        var services = await db.AtlasServices.AsNoTracking().Where(s => s.ProductId != null && ids.Contains(s.ProductId.Value)).ToListAsync(ct);

        async Task<Dictionary<Guid, int>> Count<T>(IQueryable<T> q, System.Linq.Expressions.Expression<Func<T, Guid>> key) where T : class =>
            await q.GroupBy(key).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);

        var errorGroups = await db.ServerErrors.AsNoTracking().Where(e => e.OccurredAt >= week && ids.Contains(e.ProductId))
            .GroupBy(e => e.ProductId).Select(g => new { g.Key, Count = g.Select(e => e.Signature).Distinct().Count() })
            .ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var errorTickets = await Count(db.Tickets.AsNoTracking().Where(t => t.CreatedAt >= week && t.ErrorSignature != null && ids.Contains(t.ProductId)), t => t.ProductId);
        var tasksCreated = await Count(db.TeamTasks.AsNoTracking().Where(t => t.CreatedAt >= week && t.ProductId != null && ids.Contains(t.ProductId.Value)), t => t.ProductId!.Value);
        var tasksDone = await Count(db.TeamTasks.AsNoTracking().Where(t => t.DoneAt >= week && t.ProductId != null && ids.Contains(t.ProductId.Value)), t => t.ProductId!.Value);
        var ticketsFixed = await Count(db.Tickets.AsNoTracking().Where(t => t.ResolvedAt >= week && ids.Contains(t.ProductId)), t => t.ProductId);
        var releases = await Count(db.Releases.AsNoTracking().Where(r => r.CreatedAt >= month && ids.Contains(r.ProductId)), r => r.ProductId);
        var drafts = await Count(db.Releases.AsNoTracking().Where(r => r.Status == ReleaseStatuses.Draft && ids.Contains(r.ProductId)), r => r.ProductId);
        var published = await Count(db.Releases.AsNoTracking().Where(r => r.PublishedAt >= month && ids.Contains(r.ProductId)), r => r.ProductId);

        return Results.Ok(products.Select(p =>
        {
            var ownRepos = repos.Where(r => r.ProductId == p.Id).ToList();
            var own = services.Where(s => s.ProductId == p.Id).ToList();
            var read = ownRepos.Where(r => r.CheckedAt != null).ToList();
            var runs = read.Sum(r => r.Runs7d ?? 0);
            var failed = read.Sum(r => r.FailedRuns7d ?? 0);
            var deployed = own.Where(s => s.LastDeployAt != null).ToList();
            int? N(Dictionary<Guid, int> d) => d.GetValueOrDefault(p.Id);
            return new
            {
                system = new { p.Id, p.Slug, p.Name, p.Color },
                flows = new object[]
                {
                    new { key = "code", steps = new[]
                    {
                        new FlowStep("commit", read.Count == 0 ? null : read.Sum(r => r.Commits7d ?? 0)),
                        new FlowStep("ci", read.Count == 0 ? null : runs, failed > 0 ? $"{failed}" : null),
                        new FlowStep("deploy", deployed.Count == 0 ? null : deployed.Count(s => s.LastDeployAt >= week)),
                        new FlowStep("production", own.Count == 0 ? null : own.Count(s => s.State == AtlasStates.Up), own.Count == 0 ? null : $"{own.Count}"),
                    } },
                    new { key = "errors", steps = new[]
                    {
                        new FlowStep("error", N(errorGroups)),
                        new FlowStep("ticket", N(errorTickets)),
                        new FlowStep("task", N(tasksCreated)),
                        new FlowStep("fix", N(ticketsFixed) + N(tasksDone)),
                    } },
                    new { key = "content", steps = new[]
                    {
                        new FlowStep("release", N(releases)),
                        new FlowStep("draft", N(drafts)),
                        new FlowStep("published", N(published)),
                        // Nothing in Pitwall posts to a social network: the step is a gap until a process exists.
                        new FlowStep("social", null),
                    } },
                },
            };
        }));
    }

    private static async Task<IResult> Routines(PitwallDb db, CancellationToken ct, [FromQuery] string? frequency = null, [FromQuery] bool? enabled = null)
    {
        var q = db.AtlasRoutines.AsNoTracking().Include(r => r.Product).AsQueryable();
        if (!string.IsNullOrWhiteSpace(frequency))
        {
            var f = frequency.Trim().ToLowerInvariant();
            if (!AtlasFrequencies.IsValid(f)) return Bad($"Frequência inválida. Use {string.Join(", ", AtlasFrequencies.All)}.");
            q = q.Where(r => r.Frequency == f);
        }
        if (enabled is { } on) q = q.Where(r => r.Enabled == on);
        var routines = await q.OrderBy(r => r.Frequency).ThenBy(r => r.Name).ToListAsync(ct);
        var ids = routines.Select(r => r.Id).ToList();
        var last = (await db.AtlasRoutineRuns.AsNoTracking().Where(r => ids.Contains(r.RoutineId))
                .GroupBy(r => r.RoutineId).Select(g => g.OrderByDescending(r => r.StartedAt).First()).ToListAsync(ct))
            .ToDictionary(r => r.RoutineId);
        return Results.Ok(routines.Select(r => new
        {
            r.Id, r.Slug, r.Name, r.Frequency, r.Description, r.Prompt, r.Enabled, r.UpdatedAt,
            system = r.Product is { } p ? new { p.Id, p.Slug, p.Name, p.Color } : null,
            lastRun = last.GetValueOrDefault(r.Id) is { } run ? RunDto(run) : null,
        }));
    }

    private static async Task<IResult> RoutineRuns(string routine, PitwallDb db, CancellationToken ct)
    {
        if (await FindRoutine(db, routine, ct) is not { } r) return NotFound("Rotina não encontrada.");
        var runs = await db.AtlasRoutineRuns.AsNoTracking().Where(x => x.RoutineId == r.Id)
            .OrderByDescending(x => x.StartedAt).Take(RunHistory).ToListAsync(ct);
        return Results.Ok(runs.Select(RunDto));
    }

    // ---- Activity and runs -------------------------------------------------------------------

    private static async Task<IResult> StartRun(string routine, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        if (await FindRoutine(db, routine, ct) is not { } r) return NotFound("Rotina não encontrada. Use list_routines para ver os identificadores.");
        var run = new AtlasRoutineRun { Id = Guid.NewGuid(), RoutineId = r.Id, StartedAt = DateTime.UtcNow, ActorName = Who(http).Name };
        db.AtlasRoutineRuns.Add(run);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/v1/staff/atlas/runs/{run.Id}", RunDto(run));
    }

    private static async Task<IResult> FinishRun(Guid id, FinishRequest req, PitwallDb db, CancellationToken ct)
    {
        var run = await db.AtlasRoutineRuns.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (run is null) return NotFound("Execução não encontrada.");
        var status = req.Status?.Trim().ToLowerInvariant() ?? AtlasRunStatuses.Ok;
        if (!AtlasRunStatuses.IsFinal(status)) return Bad("O resultado é ok ou failed.");
        var links = new List<AtlasRunLink>();
        foreach (var l in (req.Links ?? []).Take(30))
        {
            var label = Clean.Cut(l?.Label, 200) ?? Clean.Cut(l?.Url, 200);
            if (label is null) continue;
            var url = Clean.Cut(l!.Url, 500);
            if (url is not null && !(Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps)))
                return Bad("Os links precisam ser endereços http(s).");
            var kind = l.Kind?.Trim().ToLowerInvariant();
            links.Add(new AtlasRunLink { Kind = kind is "pr" or "task" or "alert" ? kind : "other", Label = label, Url = url });
        }
        // The first result stands: a runner that closes a run its agent already closed changes nothing.
        if (run.Status == AtlasRunStatuses.Running)
        {
            run.Status = status;
            run.FinishedAt = DateTime.UtcNow;
            run.Summary = Clean.Cut(req.Result, 4000);
            run.Links = links;
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(RunDto(run));
    }

    private static async Task<IResult> StartActivity(ActivityRequest req, HttpContext http, AtlasWriter writer, PitwallDb db, CancellationToken ct)
    {
        var description = Clean.Cut(req.Description?.ReplaceLineEndings(" "), 500);
        if (description is null) return Bad("Descreva a atividade em uma frase (até 500 caracteres).");
        Product? system = null;
        if (!string.IsNullOrWhiteSpace(req.System) && (system = await writer.FindSystemAsync(req.System, ct)) is null)
            return NotFound("Sistema não encontrado. Use list_products para ver os slugs.");
        var component = Clean.Cut(req.Component, 120);
        // The component names the node that pulses on the map, when it is one of the system's services.
        Guid? serviceId = null;
        if (system is not null && component is not null)
            serviceId = (await db.AtlasServices.AsNoTracking().Where(s => s.ProductId == system.Id).ToListAsync(ct))
                .FirstOrDefault(s => AtlasCollect.Same(s.Name, component))?.Id;
        var who = Who(http);
        var activity = new AtlasActivity
        {
            Id = Guid.NewGuid(), ProductId = system?.Id, ServiceId = serviceId, Component = component, Description = description,
            ActorName = who.Name, Source = who.Source, StartedAt = DateTime.UtcNow,
        };
        db.AtlasActivities.Add(activity);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/v1/staff/atlas/activities/{activity.Id}", new { activity.Id, activity.Status, activity.StartedAt });
    }

    private static async Task<IResult> FinishActivity(Guid id, FinishRequest req, PitwallDb db, CancellationToken ct)
    {
        var activity = await db.AtlasActivities.FirstOrDefaultAsync(a => a.Id == id, ct);
        if (activity is null) return NotFound("Atividade não encontrada.");
        var status = req.Status?.Trim().ToLowerInvariant() ?? AtlasRunStatuses.Ok;
        if (!AtlasRunStatuses.IsFinal(status)) return Bad("O resultado é ok ou failed.");
        if (activity.Status == AtlasRunStatuses.Running)
        {
            activity.Status = status;
            activity.FinishedAt = DateTime.UtcNow;
            activity.Result = Clean.Cut(req.Result, 2000);
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(new { activity.Id, activity.Status, activity.StartedAt, activity.FinishedAt });
    }

    /// <summary>Turns something a collector found into a registered service or repository, already pointing at where it was found.</summary>
    private static async Task<IResult> RegisterDiscovery(Guid id, RegisterDiscoveryRequest req, AtlasWriter writer, PitwallDb db, CancellationToken ct)
    {
        var found = await db.AtlasDiscoveries.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (found is null) return NotFound("Esse item não está mais na lista.");
        if (found.Kind == "repo")
        {
            var (repo, error) = await writer.UpsertRepoAsync(found.ExternalRef, req.System, ct);
            if (repo is null) return Bad(error!);
        }
        else
        {
            if (string.IsNullOrWhiteSpace(req.System)) return Bad("Escolha o sistema a que isso pertence.");
            var monitor = found.Kind == "monitor";
            var environment = req.Environment ?? (found.Environment is { } e ? AtlasCollect.EnvSlug(e) : null);
            if (string.IsNullOrWhiteSpace(environment)) return Bad("Escolha o ambiente.");
            var (service, _, error) = await writer.UpsertServiceAsync(new(
                req.System, environment, req.Name ?? found.Name.Split('/').Last(), req.Kind,
                Provider: monitor ? null : found.Source, ExternalRef: monitor ? null : found.Name,
                Url: found.Url, Monitor: monitor ? found.ExternalRef : null), ct);
            if (service is null) return Bad(error!);
        }
        db.AtlasDiscoveries.Remove(found);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ---- Helpers -----------------------------------------------------------------------------

    private static object RunDto(AtlasRoutineRun r) => new
    {
        r.Id, r.Status, r.StartedAt, r.FinishedAt, r.Summary, r.ActorName,
        links = (r.Links ?? []).Select(l => new { l.Kind, l.Label, l.Url }),
        // Still "running" long after it started: the runner died before closing it.
        stale = r.Status == AtlasRunStatuses.Running && r.StartedAt < DateTime.UtcNow - RunStaleAfter,
    };

    private static async Task<AtlasRoutine?> FindRoutine(PitwallDb db, string? slugOrId, CancellationToken ct)
    {
        var s = slugOrId?.Trim().ToLowerInvariant() ?? "";
        if (Guid.TryParse(s, out var id)) return await db.AtlasRoutines.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct);
        return await db.AtlasRoutines.AsNoTracking().FirstOrDefaultAsync(r => r.Slug == s, ct);
    }

    private static (string Name, string Source) Who(HttpContext http)
    {
        var token = http.IsToken();
        var name = http.StaffName();
        return (Clean.Cut(token ? $"{name} (Claude)" : name, 120) ?? "Equipe", token ? TeamTaskSources.Claude : TeamTaskSources.Manual);
    }

    private static IResult Bad(string message) => Results.BadRequest(new { message });
    private static IResult NotFound(string message) => Results.NotFound(new { message });
}
