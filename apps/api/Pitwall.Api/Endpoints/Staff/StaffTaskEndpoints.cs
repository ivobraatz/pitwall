using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services;

namespace Pitwall.Endpoints.Staff;

/// <summary>
/// The team's task board: the manual work a coding session leaves behind ("set the callback in
/// the vendor's panel", "test the login on a phone"), moved across four columns by the team and
/// read back by Claude through the Pitwall MCP. Reached by a console session or by a personal
/// token with the <c>tasks</c> scope — and by nothing a product or a customer holds.
/// </summary>
public static class StaffTaskEndpoints
{
    public const long MaxBodyBytes = 256 * 1024;
    /// <summary>The done column shows the most recent ones; the rest are a search away.</summary>
    public const int DoneOnBoard = 50;
    private const int HistoryLimit = 100;
    /// <summary>
    /// A delta also returns what changed just before the time the client sends back: a write whose
    /// clock read came before that time but whose commit landed after the previous poll is not lost.
    /// </summary>
    private static readonly TimeSpan DeltaOverlap = TimeSpan.FromSeconds(1);
    private static readonly JsonSerializerOptions EventJson = new(JsonSerializerDefaults.Web);

    // ---- Contract ----------------------------------------------------------------------------

    public sealed record ProductRef(Guid Id, string Slug, string Name, string? Color);
    public sealed record StaffRef(Guid Id, string Name);
    public sealed record CreatorRef(string Ref, string Name);
    public sealed record ChecklistItemDto(string Id, string Text, bool Done);
    public sealed record LinkDto(string Label, string Url);

    /// <summary>
    /// One task, the same shape everywhere. Lists and the board leave out <see cref="Body"/>,
    /// <see cref="Checklist"/> and <see cref="Links"/> (the counters stay), so polling stays light.
    /// </summary>
    public sealed record TaskDto(
        Guid Id, string Code, ProductRef? Product, string Title,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Body,
        string Status, double Position, string Priority, string[] Labels, DateOnly? DueDate, StaffRef? Assignee,
        string Source, CreatorRef CreatedBy, string? BlockedNote,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<ChecklistItemDto>? Checklist,
        int ChecklistDone, int ChecklistTotal,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<LinkDto>? Links,
        int CommentCount, bool Overdue, DateTime CreatedAt, DateTime UpdatedAt, DateTime? DoneAt, DateTime? ArchivedAt);

    public sealed record CommentDto(Guid Id, string AuthorRef, string AuthorName, string Source, string Body, DateTime CreatedAt);
    public sealed record EventDto(Guid Id, string ActorRef, string ActorName, string Source, string Kind, JsonElement? Data, DateTime CreatedAt);

    public sealed record CreateTaskRequest(
        string? Title, string? Body, string? Product, string? Status, string? Priority, string[]? Labels, string? DueDate,
        string? AssigneeId, List<TeamTaskInput.ChecklistInput?>? Checklist, List<TeamTaskInput.LinkInput?>? Links, string? BlockedNote);

    /// <remarks>
    /// Only the fields sent change. Product, dueDate and assigneeId take <c>null</c> to clear, so
    /// they are read as raw JSON: left out is <see cref="JsonValueKind.Undefined"/>, null is
    /// <see cref="JsonValueKind.Null"/>. (A <c>JsonElement?</c> would not do — System.Text.Json
    /// reads a JSON null into it as "no value", the same as left out.)
    /// </remarks>
    public sealed record PatchTaskRequest(
        string? Title, string? Body, JsonElement Product, string? Priority, string[]? Labels, JsonElement DueDate,
        JsonElement AssigneeId, List<TeamTaskInput.ChecklistInput?>? Checklist, List<TeamTaskInput.LinkInput?>? Links,
        string? BlockedNote, string? Status, DateTimeOffset? IfUpdatedAt);

    /// <param name="BeforeId">The card that ends up just above this one.</param>
    /// <param name="AfterId">The card that ends up just below it. Both left out = top of the column.</param>
    public sealed record MoveTaskRequest(string? Status, string? BeforeId, string? AfterId, string? BlockedNote);

    public sealed record CommentRequest(string? Body);
    public sealed record ArchiveDoneRequest(string? Product, int? OlderThanDays);

    public static IEndpointRouteBuilder MapStaffTaskEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff/tasks").RequireAuthorization(Policies.Tasks).WithTags("Staff");
        group.MapGet("", List);
        group.MapGet("/board", Board);
        group.MapGet("/meta", Meta);
        group.MapGet("/{task}", Get);

        var writes = group.MapGroup("").RequireRateLimiting("tasks-writes");
        writes.MapPost("", Create);
        writes.MapPost("/archive-done", ArchiveDone);
        writes.MapPatch("/{task}", Patch);
        writes.MapPost("/{task}/move", Move);
        writes.MapPost("/{task}/comments", PostComment);
        writes.MapPost("/{task}/archive", Archive);
        writes.MapPost("/{task}/unarchive", Unarchive);
        return app;
    }

    // ---- Reads -------------------------------------------------------------------------------

    private static async Task<IResult> List(
        HttpContext http, PitwallDb db, CancellationToken ct,
        [FromQuery] string? status = null, [FromQuery] string? product = null, [FromQuery] string? assignee = null,
        [FromQuery] string? label = null, [FromQuery] string? q = null, [FromQuery] string? updatedSince = null,
        [FromQuery] bool? includeArchived = null, [FromQuery] int? limit = null, [FromQuery] string? cursor = null)
    {
        var serverTime = Now();
        var tasks = db.TeamTasks.AsNoTracking();
        if (includeArchived != true) tasks = tasks.Where(t => t.ArchivedAt == null);

        if (!string.IsNullOrWhiteSpace(status))
        {
            var statuses = status.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => s.ToLowerInvariant()).Distinct().ToArray();
            if (!statuses.All(TeamTaskStatuses.IsValid))
                return Bad($"Status inválido. Use {string.Join(", ", TeamTaskStatuses.All)}.");
            tasks = tasks.Where(t => statuses.Contains(t.Status));
        }
        var (filtered, error) = await Filter(tasks, http, db, product, assignee, label, q, ct);
        if (error is not null) return error;
        tasks = filtered!;
        if (!string.IsNullOrWhiteSpace(updatedSince))
        {
            if (ParseInstant(updatedSince) is not { } since) return Bad("updatedSince precisa ser uma data ISO 8601.");
            tasks = tasks.Where(t => t.UpdatedAt > since);
        }
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            if (DecodeCursor(cursor) is not var (at, id)) return Bad("Cursor inválido.");
            tasks = tasks.Where(t => EF.Functions.LessThan(ValueTuple.Create(t.UpdatedAt, t.Id), ValueTuple.Create(at, id)));
        }

        var size = Math.Clamp(limit ?? 100, 1, 200);
        var page = await tasks.Include(t => t.Product).Include(t => t.Assignee)
            .OrderByDescending(t => t.UpdatedAt).ThenByDescending(t => t.Id)
            .Take(size + 1).ToListAsync(ct);
        var more = page.Count > size;
        if (more) page.RemoveAt(size);
        var items = await Dtos(db, page, full: false, ct);
        return Results.Ok(new
        {
            items,
            nextCursor = more ? EncodeCursor(page[^1].UpdatedAt, page[^1].Id) : null,
            serverTime,
        });
    }

    private static async Task<IResult> Board(
        HttpContext http, PitwallDb db, CancellationToken ct,
        [FromQuery] string? product = null, [FromQuery] string? assignee = null, [FromQuery] string? label = null,
        [FromQuery] string? q = null, [FromQuery] string? updatedSince = null)
    {
        var serverTime = Now();
        var (filtered, error) = await Filter(db.TeamTasks.AsNoTracking().Where(t => t.ArchivedAt == null), http, db, product, assignee, label, q, ct);
        if (error is not null) return error;
        var onBoard = filtered!;

        DateTime? since = null;
        if (!string.IsNullOrWhiteSpace(updatedSince))
        {
            if (ParseInstant(updatedSince) is not { } s) return Bad("updatedSince precisa ser uma data ISO 8601.");
            since = s - DeltaOverlap;
        }

        List<TeamTask> rows;
        List<Guid>? removedIds = null;
        if (since is { } from)
        {
            rows = await onBoard.Include(t => t.Product).Include(t => t.Assignee).Where(t => t.UpdatedAt > from).ToListAsync(ct);
            // Whatever changed and is no longer on this board — archived, or moved out of the
            // filter (another product, another assignee) — the client drops.
            var kept = rows.Select(t => t.Id).ToHashSet();
            removedIds = (await db.TeamTasks.AsNoTracking().Where(t => t.UpdatedAt > from).Select(t => t.Id).ToListAsync(ct))
                .Where(id => !kept.Contains(id)).ToList();
        }
        else
        {
            var open = await onBoard.Include(t => t.Product).Include(t => t.Assignee)
                .Where(t => t.Status != TeamTaskStatuses.Done).ToListAsync(ct);
            var done = await onBoard.Include(t => t.Product).Include(t => t.Assignee)
                .Where(t => t.Status == TeamTaskStatuses.Done)
                .OrderByDescending(t => t.DoneAt).ThenByDescending(t => t.UpdatedAt).Take(DoneOnBoard).ToListAsync(ct);
            rows = [.. open, .. done];
        }

        var dtos = await Dtos(db, rows, full: false, ct);
        var columns = TeamTaskStatuses.All.ToDictionary(s => s, s => dtos.Where(d => d.Status == s)
            .OrderBy(d => d.Position).ThenBy(d => d.CreatedAt).ToList());

        var today = Today();
        var byStatus = await onBoard.GroupBy(t => t.Status).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var overdue = await onBoard.CountAsync(t => t.DueDate != null && t.DueDate < today && t.Status != TeamTaskStatuses.Done, ct);
        var counts = new
        {
            todo = byStatus.GetValueOrDefault(TeamTaskStatuses.Todo),
            doing = byStatus.GetValueOrDefault(TeamTaskStatuses.Doing),
            blocked = byStatus.GetValueOrDefault(TeamTaskStatuses.Blocked),
            done = byStatus.GetValueOrDefault(TeamTaskStatuses.Done),
            overdue,
        };

        return removedIds is null
            ? Results.Ok(new { columns, counts, serverTime })
            : Results.Ok(new { columns, counts, removedIds, serverTime });
    }

    private static async Task<IResult> Meta(PitwallDb db, CancellationToken ct)
    {
        var products = await db.Products.AsNoTracking().Where(p => p.DisabledAt == null).OrderBy(p => p.Name)
            .Select(p => new ProductRef(p.Id, p.Slug, p.Name, p.Color)).ToListAsync(ct);
        var staff = await db.Staff.AsNoTracking().Where(s => s.DisabledAt == null).OrderBy(s => s.Name)
            .Select(s => new StaffRef(s.Id, s.Name)).ToListAsync(ct);
        // Counted in memory: a team's board holds hundreds of tasks, not millions.
        var labels = (await db.TeamTasks.AsNoTracking().Where(t => t.ArchivedAt == null).Select(t => t.Labels).ToListAsync(ct))
            .SelectMany(l => l).GroupBy(l => l)
            .Select(g => new { name = g.Key, count = g.Count() })
            .OrderByDescending(l => l.count).ThenBy(l => l.name).Take(200).ToList();
        return Results.Ok(new { products, staff, labels });
    }

    private static async Task<IResult> Get(string task, PitwallDb db, CancellationToken ct)
    {
        var t = await ByRef(db.TeamTasks.AsNoTracking(), task).Include(x => x.Product).Include(x => x.Assignee).FirstOrDefaultAsync(ct);
        if (t is null) return NotFound();
        var dto = (await Dtos(db, [t], full: true, ct))[0];
        var comments = (await db.TeamTaskComments.AsNoTracking().Where(c => c.TaskId == t.Id)
                .OrderByDescending(c => c.CreatedAt).Take(HistoryLimit).ToListAsync(ct))
            .OrderBy(c => c.CreatedAt)
            .Select(c => new CommentDto(c.Id, c.AuthorRef, c.AuthorName, c.Source, c.Body, c.CreatedAt));
        var events = (await db.TeamTaskEvents.AsNoTracking().Where(e => e.TaskId == t.Id)
                .OrderByDescending(e => e.CreatedAt).Take(HistoryLimit).ToListAsync(ct))
            .OrderBy(e => e.CreatedAt)
            .Select(e => new EventDto(e.Id, e.ActorRef, e.ActorName, e.Source, e.Kind, Clean.ParseJson(e.Data), e.CreatedAt));
        // The task's own fields, with its history beside them.
        var detail = JsonSerializer.SerializeToNode(dto, EventJson)!.AsObject();
        detail["comments"] = JsonSerializer.SerializeToNode(comments, EventJson);
        detail["events"] = JsonSerializer.SerializeToNode(events, EventJson);
        return Results.Ok(detail);
    }

    // ---- Writes ------------------------------------------------------------------------------

    private static async Task<IResult> Create(CreateTaskRequest req, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var title = Clean.Cut(req.Title?.ReplaceLineEndings(" "), 200);
        if (title is null) return Bad("Dê um título à tarefa (até 200 caracteres).");
        var status = req.Status?.Trim().ToLowerInvariant() ?? TeamTaskStatuses.Todo;
        if (!TeamTaskStatuses.IsValid(status)) return Bad($"Status inválido. Use {string.Join(", ", TeamTaskStatuses.All)}.");
        var priority = req.Priority?.Trim().ToLowerInvariant() ?? TeamTaskPriorities.Normal;
        if (!TeamTaskPriorities.IsValid(priority)) return Bad("Prioridade inválida. Use low, normal ou high.");
        string? note = null;
        if (status == TeamTaskStatuses.Blocked && (note = Clean.Cut(req.BlockedNote, 2000)) is null)
            return Bad("Uma tarefa bloqueada precisa da nota de bloqueio (o que deu errado).");

        var (labels, labelError) = TeamTaskInput.Labels(req.Labels);
        if (labelError is not null) return Bad(labelError);
        var (checklist, checklistError) = TeamTaskInput.Checklist(req.Checklist);
        if (checklistError is not null) return Bad(checklistError);
        var (links, linkError) = TeamTaskInput.Links(req.Links);
        if (linkError is not null) return Bad(linkError);
        DateOnly? due = null;
        if (!string.IsNullOrWhiteSpace(req.DueDate))
        {
            if (!DateOnly.TryParseExact(req.DueDate.Trim(), "yyyy-MM-dd", out var d)) return Bad("O prazo usa o formato AAAA-MM-DD.");
            due = d;
        }

        Guid? productId = null;
        if (!string.IsNullOrWhiteSpace(req.Product))
        {
            if (await FindProduct(db, req.Product, ct) is not { } p) return NotFound("Sistema não encontrado. Use list_products para ver os slugs.");
            productId = p.Id;
        }
        Guid? assigneeId = null;
        if (!string.IsNullOrWhiteSpace(req.AssigneeId))
        {
            if (await FindStaff(db, req.AssigneeId, ct) is not { } s) return NotFound("Responsável não encontrado.");
            assigneeId = s;
        }

        var who = Who(http);
        var now = Now();
        var top = await db.TeamTasks.Where(t => t.Status == status && t.ArchivedAt == null).MinAsync(t => (double?)t.Position, ct);
        var task = new TeamTask
        {
            Id = Guid.NewGuid(), ProductId = productId, Code = TeamTaskCodes.New(), Title = title,
            Body = Clean.Cut(req.Body, 20_000) ?? "", Status = status, Position = TeamTaskPositions.Top(top),
            Priority = priority, Labels = labels, DueDate = due, AssigneeId = assigneeId,
            Source = who.Source, CreatedByRef = who.Ref, CreatedByName = who.Name, BlockedNote = note,
            Checklist = checklist, Links = links, CreatedAt = now, UpdatedAt = now,
            DoneAt = status == TeamTaskStatuses.Done ? now : null,
        };
        db.TeamTasks.Add(task);
        Log(db, task, who, TeamTaskEventKinds.Created, null, now);
        if (note is not null) Log(db, task, who, TeamTaskEventKinds.Blocked, new { note }, now);

        // 32^5 codes: a collision is rare, and when it happens a fresh draw almost surely clears it.
        for (var attempt = 1; ; attempt++)
        {
            try { await db.SaveChangesAsync(ct); break; }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                if (attempt == 3) return Results.Conflict(new { message = "Não consegui gerar um código livre para a tarefa. Tente de novo." });
                task.Code = TeamTaskCodes.New();
            }
        }
        return Results.Created($"/v1/staff/tasks/{task.Code}", await Reload(db, task.Id, ct));
    }

    private static async Task<IResult> Patch(string task, PatchTaskRequest req, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        if (req.Status is not null) return Bad("Use /move para mudar o status.");
        var t = await ByRef(db.TeamTasks, task).FirstOrDefaultAsync(ct);
        if (t is null) return NotFound();
        if (req.IfUpdatedAt is { } expected && Math.Abs((t.UpdatedAt - expected.UtcDateTime).Ticks) >= 10)
            return Results.Conflict(new { message = "A tarefa mudou. Recarregue." });

        var changed = new List<string>();
        var who = Who(http);
        var now = Now();

        if (req.Title is not null)
        {
            var title = Clean.Cut(req.Title.ReplaceLineEndings(" "), 200);
            if (title is null) return Bad("O título não pode ficar vazio.");
            if (title != t.Title) { t.Title = title; changed.Add("title"); }
        }
        if (req.Body is not null)
        {
            var body = Clean.Cut(req.Body, 20_000) ?? "";
            if (body != t.Body) { t.Body = body; changed.Add("body"); }
        }
        if (req.Priority is not null)
        {
            var priority = req.Priority.Trim().ToLowerInvariant();
            if (!TeamTaskPriorities.IsValid(priority)) return Bad("Prioridade inválida. Use low, normal ou high.");
            if (priority != t.Priority) { t.Priority = priority; changed.Add("priority"); }
        }
        if (req.Labels is not null)
        {
            var (labels, error) = TeamTaskInput.Labels(req.Labels);
            if (error is not null) return Bad(error);
            if (!labels.SequenceEqual(t.Labels)) { t.Labels = labels; changed.Add("labels"); }
        }
        if (req.Product is { ValueKind: not JsonValueKind.Undefined } productJson)
        {
            Guid? productId;
            if (productJson.ValueKind == JsonValueKind.Null || (productJson.ValueKind == JsonValueKind.String && productJson.GetString()!.Trim().Length == 0))
                productId = null;
            else if (productJson.ValueKind == JsonValueKind.String && await FindProduct(db, productJson.GetString(), ct) is { } p)
                productId = p.Id;
            else return NotFound("Sistema não encontrado. Use list_products para ver os slugs.");
            if (productId != t.ProductId) { t.ProductId = productId; changed.Add("product"); }
        }
        if (req.DueDate is { ValueKind: not JsonValueKind.Undefined } dueJson)
        {
            DateOnly? due;
            if (dueJson.ValueKind == JsonValueKind.Null || (dueJson.ValueKind == JsonValueKind.String && dueJson.GetString()!.Trim().Length == 0))
                due = null;
            else if (dueJson.ValueKind == JsonValueKind.String && DateOnly.TryParseExact(dueJson.GetString()!.Trim(), "yyyy-MM-dd", out var d))
                due = d;
            else return Bad("O prazo usa o formato AAAA-MM-DD.");
            if (due != t.DueDate) { t.DueDate = due; changed.Add("dueDate"); }
        }
        if (req.AssigneeId is { ValueKind: not JsonValueKind.Undefined } assigneeJson)
        {
            Guid? assigneeId;
            if (assigneeJson.ValueKind == JsonValueKind.Null || (assigneeJson.ValueKind == JsonValueKind.String && assigneeJson.GetString()!.Trim().Length == 0))
                assigneeId = null;
            else if (assigneeJson.ValueKind == JsonValueKind.String && await FindStaff(db, assigneeJson.GetString(), ct) is { } s)
                assigneeId = s;
            else return NotFound("Responsável não encontrado.");
            if (assigneeId != t.AssigneeId) { t.AssigneeId = assigneeId; changed.Add("assignee"); }
        }
        if (req.Checklist is not null)
        {
            var (items, error) = TeamTaskInput.Checklist(req.Checklist);
            if (error is not null) return Bad(error);
            if (JsonSerializer.Serialize(items) != JsonSerializer.Serialize(t.Checklist)) { t.Checklist = items; changed.Add("checklist"); }
        }
        if (req.Links is not null)
        {
            var (links, error) = TeamTaskInput.Links(req.Links);
            if (error is not null) return Bad(error);
            if (JsonSerializer.Serialize(links) != JsonSerializer.Serialize(t.Links)) { t.Links = links; changed.Add("links"); }
        }
        string? newNote = null;
        if (req.BlockedNote is not null)
        {
            if (t.Status != TeamTaskStatuses.Blocked) return Bad("A tarefa não está bloqueada. Use /move para bloquear.");
            newNote = Clean.Cut(req.BlockedNote, 2000);
            if (newNote is null) return Bad("A nota de bloqueio não pode ficar vazia.");
            if (newNote == t.BlockedNote) newNote = null;
            else t.BlockedNote = newNote;
        }

        if (changed.Count > 0 || newNote is not null)
        {
            t.UpdatedAt = now;
            if (changed.Count > 0) Log(db, t, who, TeamTaskEventKinds.Updated, new { fields = changed }, now);
            // The note goes to the history too: what the person saw is what the next session checks.
            if (newNote is not null) Log(db, t, who, TeamTaskEventKinds.Blocked, new { note = newNote }, now);
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(await Reload(db, t.Id, ct));
    }

    private static async Task<IResult> Move(string task, MoveTaskRequest req, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var status = req.Status?.Trim().ToLowerInvariant();
        if (!TeamTaskStatuses.IsValid(status)) return Bad($"Status inválido. Use {string.Join(", ", TeamTaskStatuses.All)}.");
        var taskId = await ByRef(db.TeamTasks.AsNoTracking(), task).Select(t => (Guid?)t.Id).FirstOrDefaultAsync(ct);
        if (taskId is null) return NotFound();
        Guid? aboveId = null, belowId = null;
        if (!string.IsNullOrWhiteSpace(req.BeforeId))
        {
            aboveId = await ByRef(db.TeamTasks.AsNoTracking(), req.BeforeId).Select(t => (Guid?)t.Id).FirstOrDefaultAsync(ct);
            if (aboveId is null) return Bad("O cartão de cima (beforeId) não existe.");
        }
        if (!string.IsNullOrWhiteSpace(req.AfterId))
        {
            belowId = await ByRef(db.TeamTasks.AsNoTracking(), req.AfterId).Select(t => (Guid?)t.Id).FirstOrDefaultAsync(ct);
            if (belowId is null) return Bad("O cartão de baixo (afterId) não existe.");
        }
        if (aboveId == taskId || belowId == taskId) return Bad("Um cartão não pode ser vizinho de si mesmo.");

        var who = Who(http);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // The task and the neighbours it lands between are locked (in id order, so two moves never
        // wait on each other crosswise): a concurrent move cannot take the same gap.
        var ids = new[] { taskId.Value, aboveId, belowId }.OfType<Guid>().Distinct().ToArray();
        var locked = await db.TeamTasks.FromSql($"SELECT * FROM team_tasks WHERE id = ANY({ids}) ORDER BY id FOR UPDATE").ToListAsync(ct);
        var t = locked.FirstOrDefault(x => x.Id == taskId);
        if (t is null) return NotFound();
        if (t.ArchivedAt is not null) return Bad("A tarefa está arquivada. Desarquive antes de mover.");
        var above = aboveId is null ? null : locked.FirstOrDefault(x => x.Id == aboveId);
        var below = belowId is null ? null : locked.FirstOrDefault(x => x.Id == belowId);
        foreach (var n in new[] { above, below })
            if (n is not null && (n.Status != status || n.ArchivedAt is not null))
                return Bad("O cartão vizinho está em outra coluna. Recarregue o quadro.");

        var entering = t.Status != status;
        string? note = null;
        if (entering && status == TeamTaskStatuses.Blocked && (note = Clean.Cut(req.BlockedNote, 2000)) is null)
            return Bad("Para bloquear, escreva a nota de bloqueio (o que deu errado).");

        // One neighbour given: the other is whoever sits next to it now. None: the top of the column.
        var column = db.TeamTasks.Where(x => x.Status == status && x.ArchivedAt == null && x.Id != t.Id);
        if (above is not null && below is null)
            below = await column.Where(x => x.Position > above.Position).OrderBy(x => x.Position).FirstOrDefaultAsync(ct);
        else if (above is null && below is not null)
            above = await column.Where(x => x.Position < below.Position).OrderByDescending(x => x.Position).FirstOrDefaultAsync(ct);
        else if (above is null && below is null)
            below = await column.OrderBy(x => x.Position).FirstOrDefaultAsync(ct);

        var now = Now();
        var position = TeamTaskPositions.Place(above?.Position, below?.Position);
        if (position is null)
        {
            // The gap wore out: renumber the whole column, in this transaction, and place again.
            // The renumbered cards count as changed, so every open board picks up their new numbers.
            var rest = await db.TeamTasks
                .FromSql($"SELECT * FROM team_tasks WHERE status = {status} AND archived_at IS NULL AND id <> {t.Id} ORDER BY position, created_at FOR UPDATE")
                .ToListAsync(ct);
            var numbers = TeamTaskPositions.Renumber(rest.Count);
            for (var i = 0; i < rest.Count; i++)
            {
                rest[i].Position = numbers[i];
                rest[i].UpdatedAt = now;
            }
            position = TeamTaskPositions.Place(above?.Position, below?.Position)!;
        }

        if (entering)
        {
            var from = t.Status;
            t.ApplyStatus(status!, note, now);
            Log(db, t, who, TeamTaskEventKinds.Moved, new { from, to = status }, now);
            if (note is not null) Log(db, t, who, TeamTaskEventKinds.Blocked, new { note }, now);
        }
        t.Position = position.Value;
        t.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(await Reload(db, t.Id, ct));
    }

    private static async Task<IResult> PostComment(string task, CommentRequest req, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var body = req.Body?.Trim();
        if (string.IsNullOrEmpty(body) || body.Length > 10_000) return Bad("Escreva um comentário de até 10.000 caracteres.");
        var t = await ByRef(db.TeamTasks, task).FirstOrDefaultAsync(ct);
        if (t is null) return NotFound();
        var who = Who(http);
        var now = Now();
        var comment = new TeamTaskComment
        {
            Id = Guid.NewGuid(), TaskId = t.Id, AuthorRef = who.Ref, AuthorName = who.Name, Source = who.Source,
            Body = body, CreatedAt = now,
        };
        db.TeamTaskComments.Add(comment);
        Log(db, t, who, TeamTaskEventKinds.Commented, new { commentId = comment.Id }, now);
        t.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        return Results.Created($"/v1/staff/tasks/{t.Code}/comments/{comment.Id}",
            new CommentDto(comment.Id, comment.AuthorRef, comment.AuthorName, comment.Source, comment.Body, comment.CreatedAt));
    }

    private static async Task<IResult> Archive(string task, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var t = await ByRef(db.TeamTasks, task).FirstOrDefaultAsync(ct);
        if (t is null) return NotFound();
        if (t.ArchivedAt is null)
        {
            var now = Now();
            t.ArchivedAt = now;
            t.UpdatedAt = now;
            Log(db, t, Who(http), TeamTaskEventKinds.Archived, null, now);
            await db.SaveChangesAsync(ct);
        }
        return Results.NoContent();
    }

    private static async Task<IResult> Unarchive(string task, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var t = await ByRef(db.TeamTasks, task).FirstOrDefaultAsync(ct);
        if (t is null) return NotFound();
        if (t.ArchivedAt is not null)
        {
            var now = Now();
            var top = await db.TeamTasks.Where(x => x.Status == t.Status && x.ArchivedAt == null).MinAsync(x => (double?)x.Position, ct);
            t.ArchivedAt = null;
            t.Position = TeamTaskPositions.Top(top);
            t.UpdatedAt = now;
            Log(db, t, Who(http), TeamTaskEventKinds.Unarchived, null, now);
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(await Reload(db, t.Id, ct));
    }

    private static async Task<IResult> ArchiveDone(ArchiveDoneRequest? req, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var days = req?.OlderThanDays ?? 0;
        if (days is < 0 or > 3650) return Bad("olderThanDays vai de 0 a 3650.");
        var q = db.TeamTasks.Where(t => t.Status == TeamTaskStatuses.Done && t.ArchivedAt == null);
        if (!string.IsNullOrWhiteSpace(req?.Product))
        {
            if (await FindProduct(db, req.Product, ct) is not { } p) return Bad("Sistema não encontrado.");
            q = q.Where(t => t.ProductId == p.Id);
        }
        var now = Now();
        if (days > 0)
        {
            var cutoff = now.AddDays(-days);
            q = q.Where(t => t.DoneAt == null || t.DoneAt <= cutoff);
        }
        var tasks = await q.ToListAsync(ct);
        var who = Who(http);
        foreach (var t in tasks)
        {
            t.ArchivedAt = now;
            t.UpdatedAt = now;
            Log(db, t, who, TeamTaskEventKinds.Archived, null, now);
        }
        await db.SaveChangesAsync(ct);
        return Results.Ok(new { archived = tasks.Count });
    }

    // ---- Helpers -----------------------------------------------------------------------------

    private readonly record struct Actor(string Ref, string Name, string Source);

    /// <summary>Who is writing, and how: through a token it is Claude on that person's behalf.</summary>
    private static Actor Who(HttpContext http)
    {
        var token = http.IsToken();
        var name = http.StaffName();
        return new Actor(http.StaffId().ToString(), Clean.Cut(token ? $"{name} (Claude)" : name, 120) ?? "Equipe",
            token ? TeamTaskSources.Claude : TeamTaskSources.Manual);
    }

    private static void Log(PitwallDb db, TeamTask t, Actor who, string kind, object? data, DateTime now) =>
        db.TeamTaskEvents.Add(new TeamTaskEvent
        {
            Id = Guid.NewGuid(), TaskId = t.Id, ActorRef = who.Ref, ActorName = who.Name, Source = who.Source,
            Kind = kind, Data = data is null ? null : JsonSerializer.Serialize(data, EventJson), CreatedAt = now,
        });

    /// <summary>
    /// The clock, at the precision Postgres keeps (microseconds), so the <c>updatedAt</c> a write
    /// answers with is exactly the one a later <c>ifUpdatedAt</c> is compared to.
    /// </summary>
    private static DateTime Now()
    {
        var t = DateTime.UtcNow;
        return new DateTime(t.Ticks - t.Ticks % 10, DateTimeKind.Utc);
    }

    private static DateOnly Today() => DateOnly.FromDateTime(DateTime.UtcNow);

    /// <summary>A task by its id or its code (<c>T-7K2QM</c>, any case).</summary>
    private static IQueryable<TeamTask> ByRef(IQueryable<TeamTask> q, string? task)
    {
        var s = task?.Trim() ?? "";
        if (Guid.TryParse(s, out var id)) return q.Where(t => t.Id == id);
        if (TeamTaskCodes.IsCode(s))
        {
            var code = s.ToUpperInvariant();
            return q.Where(t => t.Code == code);
        }
        return q.Where(t => false);
    }

    private static async Task<Product?> FindProduct(PitwallDb db, string? slugOrId, CancellationToken ct)
    {
        var s = slugOrId?.Trim() ?? "";
        if (Guid.TryParse(s, out var id)) return await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
        var slug = s.ToLowerInvariant();
        return await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Slug == slug, ct);
    }

    private static async Task<Guid?> FindStaff(PitwallDb db, string? id, CancellationToken ct) =>
        Guid.TryParse(id?.Trim(), out var staffId) && await db.Staff.AnyAsync(s => s.Id == staffId && s.DisabledAt == null, ct)
            ? staffId : null;

    /// <summary>The filters the list and the board share: product, assignee, label, text.</summary>
    private static async Task<(IQueryable<TeamTask>? Query, IResult? Error)> Filter(
        IQueryable<TeamTask> q, HttpContext http, PitwallDb db,
        string? product, string? assignee, string? label, string? text, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(product))
        {
            if (await FindProduct(db, product, ct) is not { } p) return (null, Bad("Sistema não encontrado. Use list_products para ver os slugs."));
            q = q.Where(t => t.ProductId == p.Id);
        }
        if (!string.IsNullOrWhiteSpace(assignee))
        {
            var a = assignee.Trim().ToLowerInvariant();
            if (a == "me") { var me = http.StaffId(); q = q.Where(t => t.AssigneeId == me); }
            else if (a == "none") q = q.Where(t => t.AssigneeId == null);
            else if (Guid.TryParse(a, out var staffId)) q = q.Where(t => t.AssigneeId == staffId);
            else return (null, Bad("assignee aceita me, none ou o id de alguém da equipe."));
        }
        if (!string.IsNullOrWhiteSpace(label))
        {
            var l = label.Trim().ToLowerInvariant();
            q = q.Where(t => t.Labels.Contains(l));
        }
        if (!string.IsNullOrWhiteSpace(text))
        {
            var pattern = $"%{text.Trim()}%";
            q = q.Where(t => EF.Functions.ILike(t.Title, pattern) || EF.Functions.ILike(t.Code, pattern) || EF.Functions.ILike(t.Body, pattern));
        }
        return (q, null);
    }

    private static async Task<TaskDto> Reload(PitwallDb db, Guid id, CancellationToken ct)
    {
        var t = await db.TeamTasks.AsNoTracking().Include(x => x.Product).Include(x => x.Assignee).FirstAsync(x => x.Id == id, ct);
        return (await Dtos(db, [t], full: true, ct))[0];
    }

    private static async Task<List<TaskDto>> Dtos(PitwallDb db, IReadOnlyList<TeamTask> tasks, bool full, CancellationToken ct)
    {
        var ids = tasks.Select(t => t.Id).ToList();
        var comments = ids.Count == 0 ? [] : await db.TeamTaskComments.AsNoTracking().Where(c => ids.Contains(c.TaskId))
            .GroupBy(c => c.TaskId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var today = Today();
        return tasks.Select(t =>
        {
            var checklist = t.Checklist ?? [];
            return new TaskDto(
                t.Id, t.Code,
                t.Product is { } p ? new ProductRef(p.Id, p.Slug, p.Name, p.Color) : null,
                t.Title, full ? t.Body : null, t.Status, t.Position, t.Priority, t.Labels, t.DueDate,
                t.Assignee is { } a ? new StaffRef(a.Id, a.Name) : null,
                t.Source, new CreatorRef(t.CreatedByRef, t.CreatedByName), t.BlockedNote,
                full ? checklist.Select(c => new ChecklistItemDto(c.Id, c.Text, c.Done)).ToList() : null,
                checklist.Count(c => c.Done), checklist.Count,
                full ? (t.Links ?? []).Select(l => new LinkDto(l.Label, l.Url)).ToList() : null,
                comments.GetValueOrDefault(t.Id),
                t.DueDate is { } due && due < today && t.Status != TeamTaskStatuses.Done,
                t.CreatedAt, t.UpdatedAt, t.DoneAt, t.ArchivedAt);
        }).ToList();
    }

    private static DateTime? ParseInstant(string s) =>
        DateTimeOffset.TryParse(s, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal, out var d) ? d.UtcDateTime : null;

    private static string EncodeCursor(DateTime at, Guid id) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes($"{at.Ticks}:{id:N}")).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static (DateTime At, Guid Id)? DecodeCursor(string cursor)
    {
        try
        {
            var b = cursor.Trim().Replace('-', '+').Replace('_', '/');
            b = b.PadRight(b.Length + (4 - b.Length % 4) % 4, '=');
            var parts = Encoding.UTF8.GetString(Convert.FromBase64String(b)).Split(':');
            if (parts.Length == 2 && long.TryParse(parts[0], out var ticks) && ticks > 0 && ticks < DateTime.MaxValue.Ticks
                && Guid.TryParseExact(parts[1], "N", out var id))
                return (new DateTime(ticks, DateTimeKind.Utc), id);
        }
        catch (FormatException) { }
        return null;
    }

    private static IResult Bad(string message) => Results.BadRequest(new { message });

    private static IResult NotFound(string message = "Tarefa não encontrada.") => Results.NotFound(new { message });
}
