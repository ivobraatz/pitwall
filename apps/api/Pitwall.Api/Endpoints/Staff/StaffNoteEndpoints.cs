using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services;
using CreatorRef = Pitwall.Endpoints.Staff.StaffTaskEndpoints.CreatorRef;
using ProductRef = Pitwall.Endpoints.Staff.StaffTaskEndpoints.ProductRef;

namespace Pitwall.Endpoints.Staff;

/// <summary>
/// The team's notes: working drafts (an idea, a finding, a procedure in the making) kept in folders
/// and read by the whole team. When one is structured it becomes a task on the board
/// (<see cref="ConvertToTask"/>). Reached by a console session or by a personal token with the
/// <c>notes</c> scope; converting with a token also needs the <c>tasks</c> scope.
/// </summary>
public static partial class StaffNoteEndpoints
{
    public const long MaxBodyBytes = 512 * 1024;
    public const int MaxFolderDepth = 4;
    /// <summary>The newest revisions kept for a note; the rest are dropped.</summary>
    public const int MaxRevisions = 50;
    private const int MaxBody = 100_000;
    /// <summary>Edits by the same person within this window are one session: they keep no revision of their own.</summary>
    private static readonly TimeSpan SameSession = TimeSpan.FromMinutes(10);
    private static readonly JsonSerializerOptions EventJson = new(JsonSerializerDefaults.Web);

    private const string NoteMissing = "Anotação não encontrada.";
    private const string FolderMissing = "Pasta não encontrada.";
    private const string FolderNameRule = "O nome da pasta usa de 1 a 80 caracteres, sem barra (/).";
    private const string FolderSiblingTaken = "Já existe uma pasta com esse nome aqui.";
    private const string FolderDepthRule = "No máximo 4 níveis de pastas.";
    private const string FolderIntoItself = "Uma pasta não pode ir para dentro dela mesma.";
    private const string ProductMissing = "Sistema não encontrado. Use list_products para ver os slugs.";
    private const string ConvertOnly = "Use a conversão para virar tarefa.";
    private const string RevisionMissing = "Revisão não encontrada.";
    private const string CodeTaken = "Não consegui gerar um código livre para a anotação. Tente de novo.";

    // ---- Contract ----------------------------------------------------------------------------

    public sealed record FolderRef(Guid Id, string Name);
    public sealed record TaskRef(Guid Id, string Code, string Title, string Status);
    /// <summary>A note another one links to (its backlinks).</summary>
    public sealed record CodeTitle(string Code, string Title);
    /// <summary>A note this one links to. <c>Missing</c> when no note has that code.</summary>
    public sealed record LinkedNote(string Code, string Title, bool Missing);

    public sealed record FolderDto(Guid Id, Guid? ParentId, string Name, double Position, int NoteCount, DateTime CreatedAt, DateTime UpdatedAt);

    /// <summary>
    /// One note, the same shape everywhere. Lists leave out <see cref="Body"/>, <see cref="Backlinks"/> and
    /// <see cref="Linked"/>; the detail (read, create, patch) carries them all.
    /// </summary>
    public sealed record NoteDto(
        Guid Id, string Code, FolderRef? Folder, string FolderPath, ProductRef? Product, string Title,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Body,
        string Excerpt, string Stage, string[] Labels, bool Pinned, string Source, CreatorRef CreatedBy, string UpdatedByName,
        TaskRef? Task, DateTime? ConvertedAt, int WordCount, DateTime CreatedAt, DateTime UpdatedAt, DateTime? ArchivedAt,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<CodeTitle>? Backlinks,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<LinkedNote>? Linked);

    public sealed record RevisionDto(
        Guid Id, string Title, string AuthorName, string Source, DateTime CreatedAt, int Length,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Body);

    public sealed record CreateFolderRequest(string? Name, string? ParentId);

    /// <remarks>
    /// Only the fields sent change. <c>ParentId</c> is raw JSON: <c>null</c> moves the folder to the top,
    /// left out keeps it where it is (the board reads its dueDate the same way).
    /// </remarks>
    public sealed record PatchFolderRequest(string? Name, JsonElement ParentId, double? Position);

    public sealed record CreateNoteRequest(
        string? Title, string? Body, string? FolderId, string? Product, string? Stage, string[]? Labels, bool? Pinned);

    /// <remarks>
    /// <c>FolderId</c> and <c>Product</c> are raw JSON: <c>null</c> clears them, left out keeps them.
    /// <c>Append</c> adds text to the end of the body, so an agent can record a finding without rewriting the note.
    /// </remarks>
    public sealed record PatchNoteRequest(
        string? Title, string? Body, JsonElement FolderId, JsonElement Product, string? Stage, string[]? Labels,
        bool? Pinned, DateTimeOffset? IfUpdatedAt, string? Append);

    public sealed record ConvertRequest(string? Title, string? Priority, string? DueDate, string? AssigneeId, string? Status, bool? Force);

    public static IEndpointRouteBuilder MapStaffNoteEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff/notes").RequireAuthorization(Policies.Notes).WithTags("Staff");
        group.MapGet("/folders", ListFolders);
        group.MapGet("", ListNotes);
        group.MapGet("/meta", Meta);
        group.MapGet("/{note}", GetNote);
        group.MapGet("/{note}/task-preview", TaskPreview);
        group.MapGet("/{note}/revisions", ListRevisions);
        group.MapGet("/{note}/revisions/{revision:guid}", GetRevision);

        var writes = group.MapGroup("").RequireRateLimiting("tasks-writes");
        writes.MapPost("/folders", CreateFolder);
        writes.MapPatch("/folders/{folder:guid}", PatchFolder);
        writes.MapDelete("/folders/{folder:guid}", DeleteFolder);
        writes.MapPost("", CreateNote);
        writes.MapPatch("/{note}", PatchNote);
        writes.MapPost("/{note}/archive", Archive);
        writes.MapPost("/{note}/unarchive", Unarchive);
        writes.MapDelete("/{note}", DeleteNote);
        writes.MapPost("/{note}/duplicate", Duplicate);
        writes.MapPost("/{note}/convert", ConvertToTask);
        writes.MapPost("/{note}/revisions/{revision:guid}/restore", RestoreRevision);
        return app;
    }

    // ---- Folders -----------------------------------------------------------------------------

    private static async Task<IResult> ListFolders(PitwallDb db, CancellationToken ct)
    {
        var folders = await db.NoteFolders.AsNoTracking()
            .OrderBy(f => f.ParentId).ThenBy(f => f.Position).ThenBy(f => f.Name).ToListAsync(ct);
        var counts = (await db.Notes.AsNoTracking().Where(n => n.ArchivedAt == null && n.FolderId != null)
                .GroupBy(n => n.FolderId).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct))
            .Where(g => g.Key is not null).ToDictionary(g => g.Key!.Value, g => g.Count);
        var inbox = await db.Notes.CountAsync(n => n.ArchivedAt == null && n.FolderId == null, ct);
        var archived = await db.Notes.CountAsync(n => n.ArchivedAt != null, ct);
        return Results.Ok(new
        {
            items = folders.Select(f => FolderOf(f, counts.GetValueOrDefault(f.Id))),
            inbox,
            archived,
        });
    }

    private static async Task<IResult> CreateFolder(CreateFolderRequest req, PitwallDb db, CancellationToken ct)
    {
        var name = FolderName(req.Name);
        if (name is null) return Bad(FolderNameRule);
        Guid? parentId = null;
        if (!string.IsNullOrWhiteSpace(req.ParentId))
        {
            if (!Guid.TryParse(req.ParentId.Trim(), out var pid)) return NotFound(FolderMissing);
            parentId = pid;
        }
        var folders = await FolderMap(db, ct);
        if (parentId is { } parent)
        {
            if (!folders.ContainsKey(parent)) return NotFound(FolderMissing);
            if (Depth(folders, parent) >= MaxFolderDepth) return Bad(FolderDepthRule);
        }
        if (await db.NoteFolders.AnyAsync(f => f.ParentId == parentId && f.Name == name, ct)) return Conflict(FolderSiblingTaken);

        var top = await db.NoteFolders.Where(f => f.ParentId == parentId).MaxAsync(f => (double?)f.Position, ct);
        var now = Now();
        var folder = new NoteFolder
        {
            Id = Guid.NewGuid(), ParentId = parentId, Name = name, Position = TeamTaskPositions.Bottom(top),
            CreatedAt = now, UpdatedAt = now,
        };
        db.NoteFolders.Add(folder);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Conflict(FolderSiblingTaken);
        }
        return Results.Created($"/v1/staff/notes/folders/{folder.Id}", FolderOf(folder, 0));
    }

    private static async Task<IResult> PatchFolder(Guid folder, PatchFolderRequest req, PitwallDb db, CancellationToken ct)
    {
        var f = await db.NoteFolders.FirstOrDefaultAsync(x => x.Id == folder, ct);
        if (f is null) return NotFound(FolderMissing);
        var folders = await FolderMap(db, ct);

        var newName = req.Name is null ? f.Name : FolderName(req.Name);
        if (newName is null) return Bad(FolderNameRule);

        var parentId = f.ParentId;
        if (req.ParentId.ValueKind != JsonValueKind.Undefined)
        {
            if (!TryNullableId(req.ParentId, out parentId)) return Bad("parentId precisa ser o id de uma pasta, ou null para a raiz.");
            if (parentId is { } p && !folders.ContainsKey(p)) return NotFound(FolderMissing);
        }
        var moved = parentId != f.ParentId;
        if (moved)
        {
            if (IsWithin(folders, f.Id, parentId)) return Bad(FolderIntoItself);
            // The folder takes its subfolders along: the deepest of them must still fit in the four levels.
            if (Depth(folders, parentId) + Height(folders, f.Id) > MaxFolderDepth) return Bad(FolderDepthRule);
        }

        double? position = null;
        if (req.Position is { } pos)
        {
            if (!double.IsFinite(pos)) return Bad("A posição precisa ser um número.");
            position = pos;
        }

        var renamed = newName != f.Name;
        if ((moved || renamed) && await db.NoteFolders.AnyAsync(x => x.ParentId == parentId && x.Name == newName && x.Id != f.Id, ct))
            return Conflict(FolderSiblingTaken);

        if (moved || renamed || position is not null)
        {
            f.Name = newName;
            f.ParentId = parentId;
            if (position is { } np) f.Position = np;
            f.UpdatedAt = Now();
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                return Conflict(FolderSiblingTaken);
            }
        }
        return Results.Ok(FolderOf(f, await NoteCount(db, f.Id, ct)));
    }

    /// <summary>
    /// Notes (archived ones too) and subfolders move up one level first, in one transaction; only then
    /// the folder goes. A subfolder whose name the new parent already has gets " (2)", " (3)"…
    /// </summary>
    private static async Task<IResult> DeleteFolder(Guid folder, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var f = await db.NoteFolders.FirstOrDefaultAsync(x => x.Id == folder, ct);
        if (f is null) return NotFound(FolderMissing);
        var who = Who(http);
        var now = Now();
        var up = f.ParentId;

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var taken = (await db.NoteFolders.AsNoTracking().Where(x => x.ParentId == up && x.Id != f.Id).Select(x => x.Name).ToListAsync(ct))
            .ToHashSet();
        var children = await db.NoteFolders.Where(x => x.ParentId == f.Id).OrderBy(x => x.Position).ThenBy(x => x.Name).ToListAsync(ct);
        foreach (var child in children)
        {
            child.Name = Unused(child.Name, taken);
            taken.Add(child.Name);
            child.ParentId = up;
            child.UpdatedAt = now;
        }
        var notes = await db.Notes.Where(n => n.FolderId == f.Id).ToListAsync(ct);
        foreach (var n in notes)
        {
            n.FolderId = up;
            Touch(n, who, now);
        }
        // The children must leave the folder before it goes: the database refuses a folder that still has children.
        await db.SaveChangesAsync(ct);
        db.NoteFolders.Remove(f);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    // ---- Reads -------------------------------------------------------------------------------

    private static async Task<IResult> ListNotes(
        HttpContext http, PitwallDb db, CancellationToken ct,
        [FromQuery] string? folder = null, [FromQuery] bool? deep = null, [FromQuery] string? q = null,
        [FromQuery] string? stage = null, [FromQuery] string? label = null, [FromQuery] string? product = null,
        [FromQuery] bool? pinned = null, [FromQuery] bool? includeArchived = null, [FromQuery] bool? archived = null,
        [FromQuery] int? limit = null, [FromQuery] string? cursor = null)
    {
        var serverTime = Now();
        IQueryable<Note> notes = db.Notes.AsNoTracking();
        if (archived == true) notes = notes.Where(n => n.ArchivedAt != null);
        else if (includeArchived != true) notes = notes.Where(n => n.ArchivedAt == null);

        if (!string.IsNullOrWhiteSpace(stage))
        {
            var stages = stage.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => s.ToLowerInvariant()).Distinct().ToArray();
            if (!stages.All(NoteStages.IsValid)) return Bad($"Estágio inválido. Use {string.Join(", ", NoteStages.All)}.");
            notes = notes.Where(n => stages.Contains(n.Stage));
        }
        if (!string.IsNullOrWhiteSpace(folder))
        {
            var text = folder.Trim();
            if (text.Equals("inbox", StringComparison.OrdinalIgnoreCase)) notes = notes.Where(n => n.FolderId == null);
            else
            {
                if (!Guid.TryParse(text, out var folderId)) return Bad("folder aceita o id de uma pasta, ou inbox.");
                var folders = await FolderMap(db, ct);
                if (!folders.ContainsKey(folderId)) return Bad(FolderMissing);
                var ids = deep == true ? Subtree(folders, folderId) : new List<Guid> { folderId };
                notes = notes.Where(n => n.FolderId != null && ids.Contains(n.FolderId.Value));
            }
        }
        if (!string.IsNullOrWhiteSpace(label))
        {
            var (labels, error) = TeamTaskInput.Labels([label]);
            if (error is not null) return Bad(error);
            if (labels.Length == 1)
            {
                var wanted = labels[0];
                notes = notes.Where(n => n.Labels.Contains(wanted));
            }
        }
        if (!string.IsNullOrWhiteSpace(product))
        {
            if (await FindProduct(db, product, ct) is not { } p) return Bad(ProductMissing);
            var productId = p.Id;
            notes = notes.Where(n => n.ProductId == productId);
        }
        if (pinned is { } wantPinned) notes = notes.Where(n => n.Pinned == wantPinned);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var pattern = $"%{q.Trim()}%";
            notes = notes.Where(n => EF.Functions.ILike(n.Title, pattern) || EF.Functions.ILike(n.Code, pattern) || EF.Functions.ILike(n.Body, pattern));
        }
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            if (DecodeCursor(cursor) is not var (at, id)) return Bad("Cursor inválido.");
            notes = notes.Where(n => EF.Functions.LessThan(ValueTuple.Create(n.UpdatedAt, n.Id), ValueTuple.Create(at, id)));
        }

        var size = Math.Clamp(limit ?? 100, 1, 200);
        var page = await notes.Include(n => n.Product).Include(n => n.Task)
            .OrderByDescending(n => n.UpdatedAt).ThenByDescending(n => n.Id)
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

    private static async Task<IResult> Meta(PitwallDb db, CancellationToken ct)
    {
        var products = await db.Products.AsNoTracking().Where(p => p.DisabledAt == null).OrderBy(p => p.Name)
            .Select(p => new ProductRef(p.Id, p.Slug, p.Name, p.Color)).ToListAsync(ct);
        // Counted in memory: a team's notes are hundreds, not millions.
        var open = await db.Notes.AsNoTracking().Where(n => n.ArchivedAt == null).Select(n => new { n.Labels, n.Stage }).ToListAsync(ct);
        var labels = open.SelectMany(n => n.Labels).GroupBy(l => l)
            .Select(g => new { name = g.Key, count = g.Count() })
            .OrderByDescending(l => l.count).ThenBy(l => l.name).Take(200).ToList();
        var stages = NoteStages.All.Select(s => new { stage = s, count = open.Count(n => n.Stage == s) }).ToList();
        return Results.Ok(new { products, labels, stages });
    }

    private static async Task<IResult> GetNote(string note, PitwallDb db, CancellationToken ct)
    {
        var n = await LoadAsync(db, note, ct);
        return n is null ? NotFound() : Results.Ok(await DetailAsync(db, n, ct));
    }

    private static async Task<IResult> TaskPreview(string note, PitwallDb db, CancellationToken ct)
    {
        var n = await LoadAsync(db, note, ct);
        return n is null ? NotFound() : Results.Ok(NoteToTask.Draft(n));
    }

    private static async Task<IResult> ListRevisions(string note, PitwallDb db, CancellationToken ct)
    {
        var id = await ByRef(db.Notes.AsNoTracking(), note).Select(n => (Guid?)n.Id).FirstOrDefaultAsync(ct);
        if (id is null) return NotFound();
        var items = await db.NoteRevisions.AsNoTracking().Where(r => r.NoteId == id.Value)
            .OrderByDescending(r => r.CreatedAt).Take(MaxRevisions)
            .Select(r => new RevisionDto(r.Id, r.Title, r.AuthorName, r.Source, r.CreatedAt, r.Body.Length, null))
            .ToListAsync(ct);
        return Results.Ok(new { items });
    }

    private static async Task<IResult> GetRevision(string note, Guid revision, PitwallDb db, CancellationToken ct)
    {
        var id = await ByRef(db.Notes.AsNoTracking(), note).Select(n => (Guid?)n.Id).FirstOrDefaultAsync(ct);
        if (id is null) return NotFound();
        var rev = await db.NoteRevisions.AsNoTracking().Where(r => r.Id == revision && r.NoteId == id.Value)
            .Select(r => new RevisionDto(r.Id, r.Title, r.AuthorName, r.Source, r.CreatedAt, r.Body.Length, r.Body))
            .FirstOrDefaultAsync(ct);
        return rev is null ? NotFound(RevisionMissing) : Results.Ok(rev);
    }

    // ---- Writes ------------------------------------------------------------------------------

    private static async Task<IResult> CreateNote(CreateNoteRequest req, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var title = Clean.Cut(req.Title?.ReplaceLineEndings(" "), 200);
        if (title is null) return Bad("Dê um título à anotação (até 200 caracteres).");
        var stage = req.Stage?.Trim().ToLowerInvariant() ?? NoteStages.Idea;
        if (stage == NoteStages.Converted) return Bad(ConvertOnly);
        if (!NoteStages.IsValid(stage)) return Bad($"Estágio inválido. Use {string.Join(", ", NoteStages.All)}.");
        var (labels, labelError) = TeamTaskInput.Labels(req.Labels);
        if (labelError is not null) return Bad(labelError);

        Guid? folderId = null;
        if (!string.IsNullOrWhiteSpace(req.FolderId))
        {
            if (!Guid.TryParse(req.FolderId.Trim(), out var fid) || !await db.NoteFolders.AnyAsync(f => f.Id == fid, ct))
                return NotFound(FolderMissing);
            folderId = fid;
        }
        Guid? productId = null;
        if (!string.IsNullOrWhiteSpace(req.Product))
        {
            if (await FindProduct(db, req.Product, ct) is not { } p) return NotFound(ProductMissing);
            productId = p.Id;
        }

        var who = Who(http);
        var now = Now();
        var note = new Note
        {
            Id = Guid.NewGuid(), Code = NoteCodes.New(), FolderId = folderId, ProductId = productId, Title = title,
            Body = Clean.Cut(req.Body, MaxBody) ?? "", Stage = stage, Labels = labels, Pinned = req.Pinned == true,
            Source = who.Source, CreatedByRef = who.Ref, CreatedByName = who.Name,
            UpdatedByName = who.Name, UpdatedBySource = who.Source, CreatedAt = now, UpdatedAt = now,
        };
        db.Notes.Add(note);
        if (!await SaveRetrying(db, () => note.Code = NoteCodes.New(), ct)) return Conflict(CodeTaken);
        return Results.Created($"/v1/staff/notes/{note.Code}", await ReloadDetail(db, note.Id, ct));
    }

    private static async Task<IResult> PatchNote(string note, PatchNoteRequest req, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var n = await ByRef(db.Notes, note).FirstOrDefaultAsync(ct);
        if (n is null) return NotFound();
        if (req.IfUpdatedAt is { } expected && Math.Abs((n.UpdatedAt - expected.UtcDateTime).Ticks) >= 10)
            return Conflict("A anotação mudou. Recarregue.");
        if (req.Body is not null && req.Append is not null) return Bad("Use body ou append, não os dois.");

        var title = n.Title;
        if (req.Title is not null)
        {
            title = Clean.Cut(req.Title.ReplaceLineEndings(" "), 200) ?? "";
            if (title.Length == 0) return Bad("O título não pode ficar vazio.");
        }
        var body = req.Body is null ? n.Body : Clean.Cut(req.Body, MaxBody) ?? "";
        if (req.Append is not null)
        {
            var extra = Clean.Cut(req.Append, MaxBody);
            if (extra is null) return Bad("O texto a acrescentar não pode ficar vazio.");
            body = body.Length == 0 ? extra : body + "\n\n" + extra;
            if (body.Length > MaxBody) return Bad("A anotação passaria de 100.000 caracteres.");
        }

        var stage = n.Stage;
        if (req.Stage is not null)
        {
            var s = req.Stage.Trim().ToLowerInvariant();
            if (!NoteStages.IsValid(s)) return Bad($"Estágio inválido. Use {string.Join(", ", NoteStages.All)}.");
            if (n.Stage == NoteStages.Converted)
            {
                if (s != n.Stage) return Bad("A anotação já virou tarefa.");
            }
            else if (s == NoteStages.Converted) return Bad(ConvertOnly);
            else stage = s;
        }

        var folderId = n.FolderId;
        if (req.FolderId.ValueKind != JsonValueKind.Undefined)
        {
            if (!TryNullableId(req.FolderId, out folderId)) return Bad("folderId precisa ser o id de uma pasta, ou null para a entrada.");
            if (folderId is { } fid && !await db.NoteFolders.AnyAsync(f => f.Id == fid, ct)) return NotFound(FolderMissing);
        }

        var productId = n.ProductId;
        if (req.Product.ValueKind != JsonValueKind.Undefined)
        {
            if (Blank(req.Product)) productId = null;
            else if (req.Product.ValueKind == JsonValueKind.String && await FindProduct(db, req.Product.GetString(), ct) is { } p) productId = p.Id;
            else return NotFound(ProductMissing);
        }

        var labels = n.Labels;
        if (req.Labels is not null)
        {
            var (normalized, error) = TeamTaskInput.Labels(req.Labels);
            if (error is not null) return Bad(error);
            labels = normalized;
        }
        var pinned = req.Pinned ?? n.Pinned;

        var contentChanged = title != n.Title || body != n.Body;
        var changed = contentChanged || stage != n.Stage || folderId != n.FolderId || productId != n.ProductId
                      || !labels.SequenceEqual(n.Labels) || pinned != n.Pinned;
        if (!changed) return Results.Ok(await ReloadDetail(db, n.Id, ct));

        var who = Who(http);
        var now = Now();
        // The version before this edit is kept, unless the same person is still in the session that started it.
        if (contentChanged && !(n.UpdatedByName == who.Name && n.UpdatedAt > now.Add(-SameSession)))
            await KeepRevision(db, n, now, ct);
        n.Title = title;
        n.Body = body;
        n.Stage = stage;
        n.FolderId = folderId;
        n.ProductId = productId;
        n.Labels = labels;
        n.Pinned = pinned;
        Touch(n, who, now);
        await db.SaveChangesAsync(ct);
        return Results.Ok(await ReloadDetail(db, n.Id, ct));
    }

    private static async Task<IResult> Archive(string note, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var n = await ByRef(db.Notes, note).FirstOrDefaultAsync(ct);
        if (n is null) return NotFound();
        if (n.ArchivedAt is null)
        {
            var now = Now();
            n.ArchivedAt = now;
            Touch(n, Who(http), now);
            await db.SaveChangesAsync(ct);
        }
        return Results.NoContent();
    }

    private static async Task<IResult> Unarchive(string note, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var n = await ByRef(db.Notes, note).FirstOrDefaultAsync(ct);
        if (n is null) return NotFound();
        if (n.ArchivedAt is not null)
        {
            var now = Now();
            n.ArchivedAt = null;
            Touch(n, Who(http), now);
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(await ReloadDetail(db, n.Id, ct));
    }

    private static async Task<IResult> DeleteNote(string note, PitwallDb db, CancellationToken ct)
    {
        var n = await ByRef(db.Notes, note).FirstOrDefaultAsync(ct);
        if (n is null) return NotFound();
        if (n.ArchivedAt is null) return Bad("Arquive antes de apagar.");
        db.Notes.Remove(n);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Duplicate(string note, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var src = await ByRef(db.Notes.AsNoTracking(), note).FirstOrDefaultAsync(ct);
        if (src is null) return NotFound();
        var who = Who(http);
        var now = Now();
        var copy = new Note
        {
            Id = Guid.NewGuid(), Code = NoteCodes.New(), FolderId = src.FolderId, ProductId = src.ProductId,
            Title = Clean.Cut("Cópia de " + src.Title, 200) ?? "Cópia", Body = src.Body, Stage = NoteStages.Idea,
            Labels = src.Labels, Source = who.Source, CreatedByRef = who.Ref, CreatedByName = who.Name,
            UpdatedByName = who.Name, UpdatedBySource = who.Source, CreatedAt = now, UpdatedAt = now,
        };
        db.Notes.Add(copy);
        if (!await SaveRetrying(db, () => copy.Code = NoteCodes.New(), ct)) return Conflict(CodeTaken);
        return Results.Created($"/v1/staff/notes/{copy.Code}", await ReloadDetail(db, copy.Id, ct));
    }

    private static async Task<IResult> RestoreRevision(string note, Guid revision, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        var n = await ByRef(db.Notes, note).FirstOrDefaultAsync(ct);
        if (n is null) return NotFound();
        var rev = await db.NoteRevisions.AsNoTracking().FirstOrDefaultAsync(r => r.Id == revision && r.NoteId == n.Id, ct);
        if (rev is null) return NotFound(RevisionMissing);
        if (rev.Title != n.Title || rev.Body != n.Body)
        {
            var who = Who(http);
            var now = Now();
            // What the note says now is kept first, so the restore can be undone the same way.
            // A restore is always a change: the 10-minute session rule does not apply.
            await KeepRevision(db, n, now, ct);
            n.Title = rev.Title;
            n.Body = rev.Body;
            Touch(n, who, now);
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(await ReloadDetail(db, n.Id, ct));
    }

    /// <summary>
    /// Turns a note into a task on the board: the draft (see <see cref="NoteToTask"/>) becomes a TeamTask,
    /// and the note is marked converted and points at it. Refused while the note is too thin, unless forced.
    /// </summary>
    private static async Task<IResult> ConvertToTask(string note, ConvertRequest req, HttpContext http, PitwallDb db, CancellationToken ct)
    {
        // The note is only the draft: a token that cannot create tasks cannot convert one.
        if (http.IsToken() && !http.User.HasClaim(ProductKeyAuthHandler.ScopeClaim, StaffTokenScopes.Tasks))
            return Results.Json(new { message = "O token precisa do escopo tasks para criar a tarefa." }, statusCode: StatusCodes.Status403Forbidden);

        var n = await ByRef(db.Notes, note).Include(x => x.Product).Include(x => x.Task).FirstOrDefaultAsync(ct);
        if (n is null) return NotFound();
        if (n.TaskId is not null || n.ConvertedAt is not null)
            return Conflict(n.Task is { } done ? $"A anotação já virou a tarefa {done.Code}." : "A anotação já virou tarefa.");

        var status = req.Status?.Trim().ToLowerInvariant() ?? TeamTaskStatuses.Todo;
        if (status is not (TeamTaskStatuses.Todo or TeamTaskStatuses.Doing)) return Bad("A tarefa começa em todo ou doing.");
        var priority = req.Priority?.Trim().ToLowerInvariant() ?? TeamTaskPriorities.Normal;
        if (!TeamTaskPriorities.IsValid(priority)) return Bad("Prioridade inválida. Use low, normal ou high.");
        DateOnly? due = null;
        if (!string.IsNullOrWhiteSpace(req.DueDate))
        {
            if (!DateOnly.TryParseExact(req.DueDate.Trim(), "yyyy-MM-dd", out var d)) return Bad("O prazo usa o formato AAAA-MM-DD.");
            due = d;
        }
        Guid? assigneeId = null;
        if (!string.IsNullOrWhiteSpace(req.AssigneeId))
        {
            if (await FindStaff(db, req.AssigneeId, ct) is not { } assignee) return NotFound("Responsável não encontrado.");
            assigneeId = assignee;
        }

        var draft = NoteToTask.Draft(n);
        var title = draft.Title;
        if (req.Title is not null)
        {
            title = Clean.Cut(req.Title.ReplaceLineEndings(" "), 200) ?? "";
            if (title.Length == 0) return Bad("O título não pode ficar vazio.");
        }
        if (req.Force != true && draft.Readiness.Score < NoteToTask.ConvertScore)
        {
            var missing = draft.Readiness.Missing;
            return Results.BadRequest(new
            {
                message = $"A anotação ainda não está estruturada: {string.Join("; ", missing)}",
                missing,
            });
        }

        var who = Who(http);
        var now = Now();
        var top = await db.TeamTasks.Where(t => t.Status == status && t.ArchivedAt == null).MinAsync(t => (double?)t.Position, ct);
        var (checklist, checklistError) = TeamTaskInput.Checklist(
            draft.Checklist.Select((text, i) => new TeamTaskInput.ChecklistInput(null, text, draft.ChecklistDone[i])));
        if (checklistError is not null) return Bad(checklistError);
        var (links, linkError) = TeamTaskInput.Links(draft.Links.Select(l => new TeamTaskInput.LinkInput(l.Label, l.Url)));
        if (linkError is not null) return Bad(linkError);

        var task = new TeamTask
        {
            Id = Guid.NewGuid(), ProductId = n.ProductId, Code = TeamTaskCodes.New(), Title = title, Body = draft.Body,
            Status = status, Position = TeamTaskPositions.Top(top), Priority = priority, Labels = draft.Labels, DueDate = due,
            AssigneeId = assigneeId, Source = who.Source, CreatedByRef = who.Ref, CreatedByName = who.Name,
            Checklist = checklist, Links = links, CreatedAt = now, UpdatedAt = now,
        };
        db.TeamTasks.Add(task);
        // The same "created" a task made by hand gets, with where it came from.
        db.TeamTaskEvents.Add(new TeamTaskEvent
        {
            Id = Guid.NewGuid(), TaskId = task.Id, ActorRef = who.Ref, ActorName = who.Name, Source = who.Source,
            Kind = TeamTaskEventKinds.Created, Data = JsonSerializer.Serialize(new { fromNote = n.Code }, EventJson), CreatedAt = now,
        });
        n.TaskId = task.Id;
        n.ConvertedAt = now;
        n.Stage = NoteStages.Converted;
        Touch(n, who, now);

        if (!await SaveRetrying(db, () => task.Code = TeamTaskCodes.New(), ct))
            return Conflict("Não consegui gerar um código livre para a tarefa. Tente de novo.");
        return Results.Created($"/v1/staff/tasks/{task.Code}", new
        {
            note = await ReloadDetail(db, n.Id, ct),
            task = new TaskRef(task.Id, task.Code, task.Title, task.Status),
        });
    }

    // ---- Helpers -----------------------------------------------------------------------------

    private readonly record struct Writer(string Ref, string Name, string Source);

    /// <summary>Who is writing, and how: through a token it is Claude on that person's behalf.</summary>
    private static Writer Who(HttpContext http)
    {
        var token = http.IsToken();
        var name = http.StaffName();
        return new Writer(http.StaffId().ToString(), Clean.Cut(token ? $"{name} (Claude)" : name, 120) ?? "Equipe",
            token ? TeamTaskSources.Claude : TeamTaskSources.Manual);
    }

    /// <summary>Records the last change and who made it: the next edit's revision rule reads it.</summary>
    private static void Touch(Note n, Writer who, DateTime now)
    {
        n.UpdatedAt = now;
        n.UpdatedByName = who.Name;
        n.UpdatedBySource = who.Source;
    }

    /// <summary>
    /// Keeps what the note says now as a revision, its author being whoever wrote it last. The oldest
    /// beyond <see cref="MaxRevisions"/> go. The revision being added is not saved yet, so the query
    /// counts the stored ones and keeps MaxRevisions - 1 of them.
    /// </summary>
    private static async Task KeepRevision(PitwallDb db, Note n, DateTime now, CancellationToken ct)
    {
        db.NoteRevisions.Add(new NoteRevision
        {
            Id = Guid.NewGuid(), NoteId = n.Id, Title = n.Title, Body = n.Body,
            AuthorName = n.UpdatedByName, Source = n.UpdatedBySource, CreatedAt = now,
        });
        var old = await db.NoteRevisions.Where(r => r.NoteId == n.Id)
            .OrderByDescending(r => r.CreatedAt).Skip(MaxRevisions - 1).ToListAsync(ct);
        db.NoteRevisions.RemoveRange(old);
    }

    /// <summary>Saves, drawing a fresh code when the one drawn is taken (32^5 codes: a collision is rare).</summary>
    private static async Task<bool> SaveRetrying(PitwallDb db, Action redraw, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            try { await db.SaveChangesAsync(ct); return true; }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                if (attempt == 3) return false;
                redraw();
            }
        }
    }

    /// <summary>A note by its id or its code (<c>N-7K2QM</c>, any case).</summary>
    private static IQueryable<Note> ByRef(IQueryable<Note> q, string? note)
    {
        var s = note?.Trim() ?? "";
        if (Guid.TryParse(s, out var id)) return q.Where(n => n.Id == id);
        if (NoteCodes.IsCode(s))
        {
            var code = s.ToUpperInvariant();
            return q.Where(n => n.Code == code);
        }
        return q.Where(_ => false);
    }

    private static Task<Note?> LoadAsync(PitwallDb db, string note, CancellationToken ct) =>
        ByRef(db.Notes.AsNoTracking(), note).Include(x => x.Product).Include(x => x.Task).FirstOrDefaultAsync(ct);

    private static async Task<NoteDto> ReloadDetail(PitwallDb db, Guid id, CancellationToken ct)
    {
        var n = await db.Notes.AsNoTracking().Include(x => x.Product).Include(x => x.Task).FirstAsync(x => x.Id == id, ct);
        return await DetailAsync(db, n, ct);
    }

    private static async Task<NoteDto> DetailAsync(PitwallDb db, Note n, CancellationToken ct)
    {
        var folders = await FolderMap(db, ct);
        var pattern = $"%[[{n.Code}]]%";
        var backlinks = await db.Notes.AsNoTracking()
            .Where(x => x.Id != n.Id && x.ArchivedAt == null && EF.Functions.ILike(x.Body, pattern))
            .OrderByDescending(x => x.UpdatedAt)
            .Select(x => new CodeTitle(x.Code, x.Title))
            .ToListAsync(ct);
        var codes = NoteCodes.LinksIn(n.Body);
        var found = codes.Length == 0 ? new Dictionary<string, string>() : await db.Notes.AsNoTracking()
            .Where(x => codes.Contains(x.Code)).ToDictionaryAsync(x => x.Code, x => x.Title, ct);
        var linked = codes.Select(c => found.TryGetValue(c, out var title)
            ? new LinkedNote(c, title, false)
            : new LinkedNote(c, "", true)).ToList();
        return ToDto(n, folders, full: true) with { Backlinks = backlinks, Linked = linked };
    }

    private static async Task<List<NoteDto>> Dtos(PitwallDb db, IReadOnlyList<Note> notes, bool full, CancellationToken ct)
    {
        var folders = await FolderMap(db, ct);
        return notes.Select(n => ToDto(n, folders, full)).ToList();
    }

    private static NoteDto ToDto(Note n, IReadOnlyDictionary<Guid, NoteFolder> folders, bool full) => new(
        n.Id, n.Code,
        n.FolderId is { } fid && folders.TryGetValue(fid, out var folder) ? new FolderRef(folder.Id, folder.Name) : null,
        FolderPath(folders, n.FolderId),
        n.Product is { } p ? new ProductRef(p.Id, p.Slug, p.Name, p.Color) : null,
        n.Title, full ? n.Body : null, Excerpt(n.Body), n.Stage, n.Labels, n.Pinned, n.Source,
        new CreatorRef(n.CreatedByRef, n.CreatedByName), n.UpdatedByName,
        n.Task is { } t ? new TaskRef(t.Id, t.Code, t.Title, t.Status) : null,
        n.ConvertedAt, Words(n.Body), n.CreatedAt, n.UpdatedAt, n.ArchivedAt, null, null);

    private static FolderDto FolderOf(NoteFolder f, int noteCount) =>
        new(f.Id, f.ParentId, f.Name, f.Position, noteCount, f.CreatedAt, f.UpdatedAt);

    private static Task<int> NoteCount(PitwallDb db, Guid folderId, CancellationToken ct) =>
        db.Notes.CountAsync(n => n.FolderId == folderId && n.ArchivedAt == null, ct);

    private static Task<Dictionary<Guid, NoteFolder>> FolderMap(PitwallDb db, CancellationToken ct) =>
        db.NoteFolders.AsNoTracking().ToDictionaryAsync(f => f.Id, ct);

    /// <summary>A folder name: trimmed, 1 to 80 characters, no slash, no control characters. Null when it does not fit.</summary>
    private static string? FolderName(string? raw)
    {
        var s = raw?.Trim();
        return string.IsNullOrEmpty(s) || s.Length > 80 || s.Contains('/') || s.Any(char.IsControl) ? null : s;
    }

    /// <summary>How many folders the folder is nested in, itself included: a top-level folder is 1, null is 0.</summary>
    private static int Depth(IReadOnlyDictionary<Guid, NoteFolder> folders, Guid? id)
    {
        var depth = 0;
        var cur = id;
        while (cur is { } c && depth < 10 && folders.TryGetValue(c, out var f))
        {
            depth++;
            cur = f.ParentId;
        }
        return depth;
    }

    /// <summary>The levels a folder spans with its subfolders, itself included.</summary>
    private static int Height(IReadOnlyDictionary<Guid, NoteFolder> folders, Guid id) =>
        1 + folders.Values.Where(f => f.ParentId == id).Select(f => Height(folders, f.Id)).DefaultIfEmpty(0).Max();

    /// <summary>True when the candidate is the folder itself or one of its descendants.</summary>
    private static bool IsWithin(IReadOnlyDictionary<Guid, NoteFolder> folders, Guid folder, Guid? candidate)
    {
        var cur = candidate;
        var hops = 0;
        while (cur is { } c && hops++ < 10)
        {
            if (c == folder) return true;
            cur = folders.TryGetValue(c, out var f) ? f.ParentId : null;
        }
        return false;
    }

    private static List<Guid> Subtree(IReadOnlyDictionary<Guid, NoteFolder> folders, Guid root)
    {
        var ids = new List<Guid> { root };
        for (var i = 0; i < ids.Count; i++)
            ids.AddRange(folders.Values.Where(f => f.ParentId == ids[i]).Select(f => f.Id));
        return ids;
    }

    /// <summary>The folder names from the top down, joined " / ": "Ideias / Pagamentos". Empty for the entrance.</summary>
    private static string FolderPath(IReadOnlyDictionary<Guid, NoteFolder> folders, Guid? id)
    {
        var names = new List<string>();
        var cur = id;
        while (cur is { } c && names.Count < 10 && folders.TryGetValue(c, out var f))
        {
            names.Insert(0, f.Name);
            cur = f.ParentId;
        }
        return string.Join(" / ", names);
    }

    /// <summary>The first name not taken: "Name", then "Name (2)", "Name (3)"…, always within 80 characters.</summary>
    private static string Unused(string name, ISet<string> taken)
    {
        if (!taken.Contains(name)) return name;
        for (var i = 2; ; i++)
        {
            var suffix = $" ({i})";
            var stem = name.Length + suffix.Length > 80 ? name[..(80 - suffix.Length)] : name;
            var candidate = stem + suffix;
            if (!taken.Contains(candidate)) return candidate;
        }
    }

    /// <summary>The first characters of the body, without the heavier markdown marks, on one line.</summary>
    private static string Excerpt(string body)
    {
        var head = body.Length > 600 ? body[..600] : body;
        var plain = Markup().Replace(head, "").ReplaceLineEndings(" ");
        return Clean.Cut(string.Join(' ', plain.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)), 200) ?? "";
    }

    private static int Words(string body) => body.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;

    /// <summary>A null or blank JSON value: the "clear it" value of the raw fields.</summary>
    private static bool Blank(JsonElement raw) =>
        raw.ValueKind == JsonValueKind.Null || (raw.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(raw.GetString()));

    /// <summary>A folder id, or null for "none". False when the value is neither.</summary>
    private static bool TryNullableId(JsonElement raw, out Guid? id)
    {
        id = null;
        if (Blank(raw)) return true;
        if (raw.ValueKind == JsonValueKind.String && Guid.TryParse(raw.GetString(), out var g))
        {
            id = g;
            return true;
        }
        return false;
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

    private static DateTime Now()
    {
        var t = DateTime.UtcNow;
        return new DateTime(t.Ticks - t.Ticks % 10, DateTimeKind.Utc);
    }

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

    private static IResult NotFound(string message = NoteMissing) => Results.NotFound(new { message });

    private static IResult Conflict(string message) => Results.Conflict(new { message });

    [GeneratedRegex(@"[#*`>]")]
    private static partial Regex Markup();
}
