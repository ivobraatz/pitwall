using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas.Sync;

/// <summary>
/// The sync (contract 3): one request from an agent, a pipeline, a hook or the CLI, or one scan of a repository
/// by the server, applied to the map in a single transaction. Checks and redaction happen before anything is
/// read from the database; the writes happen under a lock per repository, so two syncs of the same repository
/// never interleave, and an identical request is answered from the stored result.
/// </summary>
public sealed class AtlasSyncService(PitwallDb db, AtlasWriter writer, AtlasActor actor, IAtlasSnapshotTrigger snapshots)
{
    public const string GitHubScanSource = "github-scan";
    public static readonly string[] Sources = ["agent", "ci", "git-hook", "cli", GitHubScanSource];
    public static readonly string[] Scopes = ["local", "pushed", "deployed"];

    public const int MaxFiles = 300;
    public const long MaxPackageBytes = 1024 * 1024;
    public const long MaxFileBytes = 200 * 1024;
    public const int MaxListItems = 50;
    public const int MaxOps = 200;

    public const string NotAssociated = "Repositório não associado a um sistema. Associe no console (Atlas → Integração) ou envie system.";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly Regex TaskCode = new("^T-[A-Z0-9]{3,12}$", RegexOptions.CultureInvariant);

    /// <summary>What a request means once it is checked, cut and redacted. Nothing here touches the database.</summary>
    internal sealed record Prepared(
        string Source, string Repo, string? SystemRef, string Scope, string? Environment, string IdempotencyKey, Guid? ActivityId,
        string? Tool, string? Branch, string? CommitSha, string BundleHash, bool Partial, ScanResult Scan, string? Summary,
        List<string> Tasks, List<SyncOp> Ops, List<string> Attention, List<SyncRejection> Rejected);

    /// <summary>Applies a request. Throws <see cref="AtlasSyncRejected"/> for what is refused as a whole.</summary>
    public async Task<SyncResponse> ApplyAsync(SyncRequest req, CancellationToken ct)
    {
        var prepared = Prepare(req);
        for (var attempt = 1; ; attempt++)
        {
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            try
            {
                var (response, changed) = await WriteAsync(prepared, ct);
                await tx.CommitAsync(ct);
                if (changed) snapshots.Request("sync");
                return response;
            }
            catch (DbUpdateConcurrencyException) when (attempt < 2)
            {
                // Another write moved a row this sync read: start over once, from the database as it is now.
                await tx.RollbackAsync(ct);
            }
            catch (DbUpdateException ex) when (attempt < 2 && IsUniqueViolation(ex))
            {
                // Two requests with the same key raced past the check: the other one is the answer.
                await tx.RollbackAsync(ct);
                db.ChangeTracker.Clear();
                if (await ReplayAsync(prepared.IdempotencyKey, ct) is { } replay) return replay;
                throw;
            }
        }
    }

    // ---- Checks and redaction -----------------------------------------------------------------

    internal Prepared Prepare(SyncRequest req)
    {
        var source = Lower(req.Source) ?? throw Bad("Diga a origem: agent, ci, git-hook ou cli.");
        if (!Sources.Contains(source)) throw Bad("Origem inválida. Use agent, ci, git-hook ou cli.");
        var scope = Lower(req.Scope) ?? throw Bad("Diga o escopo: local, pushed ou deployed.");
        if (!Scopes.Contains(scope)) throw Bad("Escopo inválido. Use local, pushed ou deployed.");
        var repo = Lower(req.Repo);
        if (repo is null || !Regex.IsMatch(repo, @"^[a-z0-9_.-]{1,100}/[a-z0-9_.-]{1,100}$"))
            throw Bad("O repositório usa o formato dono/nome.");
        var environment = Lower(req.Environment);
        if (environment is not null && !Regex.IsMatch(environment, "^[a-z0-9][a-z0-9-]{0,39}$"))
            throw Bad("O ambiente usa só letras minúsculas, números e hífen (até 40).");
        if (scope == AtlasScopes.Deployed && environment is null)
            throw Bad("Diga o ambiente (environment) ao sincronizar com escopo deployed.");

        Guid? activityId = null;
        if (!string.IsNullOrWhiteSpace(req.ActivityId))
        {
            if (!Guid.TryParse(req.ActivityId, out var parsed)) throw Bad("O id da atividade é inválido.");
            activityId = parsed;
        }
        var givenKey = req.IdempotencyKey?.Trim();
        if (givenKey is { Length: > 120 }) throw Bad("A chave de idempotência tem até 120 caracteres.");

        var rejected = new List<SyncRejection>();
        var files = (req.Files ?? []).OfType<SyncFile>().ToList();
        if (files.Count > MaxFiles) throw Bad("O pacote tem no máximo 300 arquivos.");
        var kept = new List<(string Path, string? Content)>();
        long total = 0;
        var dropped = 0;
        foreach (var file in files)
        {
            var path = AtlasSanitizer.NormalizePath(file.Path ?? "");
            if (path.Length == 0 || path.StartsWith('/') || path.Contains(':') || path.Split('/').Any(s => s == ".."))
            {
                rejected.Add(new SyncRejection("file", "Caminho inválido: arquivo não foi lido."));
                continue;
            }
            var name = AtlasSanitizer.FileName(path);
            if (AtlasSanitizer.IsForbiddenPath(path))
            {
                rejected.Add(new SyncRejection($"file:{Clean.Cut(name, 60)}", "Arquivo de segredos: não é lido nem guardado."));
                continue;
            }
            // Not on the list at all: quietly ignored, as the CLI would never have sent it.
            if (AtlasSanitizer.Category(path) == AtlasSanitizer.PathKind.None) continue;

            var bytes = file.Content is null ? 0 : Encoding.UTF8.GetByteCount(file.Content);
            total += bytes;
            if (total > MaxPackageBytes) throw Bad("O pacote passa de 1 MB.");
            if (bytes > MaxFileBytes)
            {
                rejected.Add(new SyncRejection($"file:{Clean.Cut(name, 60)}", "Arquivo acima de 200 KB: não foi guardado."));
                dropped++;
                continue;
            }
            var sanitized = AtlasSanitizer.Transform(path, file.Content);
            if (sanitized.Dropped)
            {
                rejected.Add(new SyncRejection($"file:{Clean.Cut(name, 60)}", "Conteúdo inválido (JSON não lê): arquivo não foi guardado."));
                dropped++;
                continue;
            }
            kept.Add((path, sanitized.Content));
        }

        var report = req.Report;
        var summary = Clean.Cut(AtlasSanitizer.Redact(report?.Summary), 4000);
        foreach (var list in new[] { report?.Created, report?.Changed, report?.Removed, report?.Attention })
            if (list is { Count: > MaxListItems }) throw Bad("Até 50 itens em cada lista do relatório.");
        var attention = (report?.Attention ?? []).Select(a => Clean.Cut(AtlasSanitizer.Redact(a), 300)).OfType<string>().ToList();
        var tasks = new List<string>();
        foreach (var raw in report?.Tasks ?? [])
        {
            var code = Clean.Cut(raw, 20)?.ToUpperInvariant();
            if (code is not null && TaskCode.IsMatch(code)) tasks.Add(code);
            else rejected.Add(new SyncRejection("task", "Código de tarefa inválido (use T-XXXXX)."));
        }
        if (report?.Ops is { Count: > MaxOps }) throw Bad("No máximo 200 operações no relatório.");
        var ops = (report?.Ops ?? []).OfType<SyncOp>().Select(Sanitize).ToList();

        var canonical = new StringBuilder();
        foreach (var file in kept.OrderBy(f => f.Path, StringComparer.Ordinal))
            canonical.Append(file.Path).Append('\0').Append(file.Content ?? "").Append('\0');
        var bundleHash = Sha256(canonical.ToString());
        var reportHash = Sha256(JsonSerializer.Serialize(new { summary, attention, tasks, ops }, Json));
        var key = givenKey is { Length: > 0 } ? givenKey : Sha256($"{repo}|{req.CommitSha ?? ""}|{scope}|{bundleHash}|{reportHash}");

        return new Prepared(
            Source: source, Repo: repo, SystemRef: Clean.Cut(req.System, 80), Scope: scope, Environment: environment,
            IdempotencyKey: key, ActivityId: activityId, Tool: Clean.Cut(Lower(req.Tool), 40), Branch: Clean.Cut(req.Branch, 200),
            CommitSha: Clean.Cut(req.CommitSha, 64), BundleHash: bundleHash,
            Partial: req.Partial == true || dropped > 0 || kept.Count == 0,
            Scan: AtlasManifestParser.Parse(kept), Summary: summary, Tasks: tasks, Ops: ops, Attention: attention, Rejected: rejected);
    }

    /// <summary>Every text of an operation goes through the same redaction and length limits as the rest.</summary>
    private static SyncOp Sanitize(SyncOp o)
    {
        static string? Text(string? s, int max) => Clean.Cut(AtlasSanitizer.Redact(s), max);
        Dictionary<string, string>? facts = null;
        if (o.Facts is not null)
        {
            facts = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var kv in o.Facts)
            {
                var key = Text(kv.Key, 60);
                var value = Text(kv.Value, 500);
                if (key is not null && value is not null) facts.TryAdd(key, value);
            }
        }
        return new SyncOp(
            Op: Lower(o.Op), Key: Lower(o.Key), Name: Text(o.Name, 120), Kind: Lower(o.Kind), Engine: Lower(o.Engine),
            Environment: Lower(o.Environment), Provider: Text(o.Provider, 40), Url: Text(o.Url, 500), Group: Text(o.Group, 60),
            Signature: Text(o.Signature, 60), Facts: facts, Evidence: Text(o.Evidence, 300), From: Text(o.From, 120), To: Text(o.To, 120),
            Relation: Lower(o.Relation), Ref: Text(o.Ref, 120), Code: Text(o.Code, 20), Note: Text(o.Note, 300));
    }

    // ---- Writes ------------------------------------------------------------------------------

    private async Task<(SyncResponse Response, bool Changed)> WriteAsync(Prepared p, CancellationToken ct)
    {
        // One sync per repository at a time; the global lock keeps shared nodes (one Stripe for all) from being created twice.
        var repoLock = "atlas-sync:" + p.Repo;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({repoLock}))", ct);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtext('atlas-sync'))", ct);

        if (await ReplayAsync(p.IdempotencyKey, ct) is { } replay) return (replay, false);

        var repo = await db.AtlasRepos.FirstOrDefaultAsync(r => r.FullName == p.Repo, ct);
        Product? named = null;
        if (p.SystemRef is not null)
        {
            named = await writer.FindSystemAsync(p.SystemRef, ct)
                ?? throw new AtlasSyncRejected(422, "Sistema não encontrado. Cadastre-o antes (register_system).");
        }
        if (repo is null)
        {
            if (named is null) throw new AtlasSyncRejected(422, NotAssociated);
            var (created, error) = await writer.UpsertRepoAsync(p.Repo, named.Slug, ct);
            if (created is null) throw new AtlasSyncRejected(400, error ?? "O repositório é inválido.");
            repo = created;
        }
        else if (named is not null)
        {
            if (repo.ProductId is { } current && current != named.Id)
                throw new AtlasSyncRejected(409, "Este repositório já está associado a outro sistema. Mude a associação no console (Atlas → Integração).");
            repo.ProductId ??= named.Id;
        }
        if (repo.ProductId is not { } productId) throw new AtlasSyncRejected(422, NotAssociated);
        var product = await db.Products.FirstOrDefaultAsync(x => x.Id == productId, ct)
            ?? throw new AtlasSyncRejected(422, NotAssociated);

        AtlasActivity? activity = null;
        if (p.ActivityId is { } activityId)
        {
            activity = await db.AtlasActivities.FirstOrDefaultAsync(a => a.Id == activityId, ct)
                ?? throw new AtlasSyncRejected(404, "Atividade não encontrada. Ela pode já ter sido encerrada ou apagada.");
        }

        var now = AtlasWriter.Instant();
        var changeSetId = Guid.NewGuid();
        // The history names this sync and its change set; the interceptor writes the rows when the unit of work is saved.
        actor.Source = "sync";
        actor.ChangeSetId = changeSetId;

        var reconciler = new AtlasReconciler(db, writer, new SyncContext(product, p.Repo, p.Scope, p.Environment, p.CommitSha, changeSetId, now));
        await reconciler.LoadAsync(ct);
        reconciler.Tally.Rejected.AddRange(p.Rejected);
        await reconciler.ApplyFindingsAsync(p.Scan.Findings, ct);
        // A pushed or deployed scan of a complete package says what is no longer there; a partial one says nothing about what is missing.
        if (!p.Partial && (p.Scope == AtlasScopes.Pushed || p.Scope == AtlasScopes.Deployed))
            await reconciler.MarkGoneAsync(ct);
        await reconciler.ApplyOpsAsync(p.Ops, ct);

        var (createdKeys, updated, unchanged) = reconciler.Summarize();
        var tally = reconciler.Tally;
        var changed = createdKeys.Count + updated.Count + tally.Gone.Count + tally.Removals.Count > 0;
        var status = tally.Rejected.Count > 0 ? "partial" : changed ? "applied" : "noop";
        var gone = tally.Gone.Order(StringComparer.Ordinal).ToList();
        var removals = tally.Removals.Order(StringComparer.Ordinal).ToList();
        var attention = p.Attention
            .Concat(gone.Select(k => $"não encontrado: {k}"))
            .Concat(removals.Select(k => $"remoção aguardando confirmação: {k}"))
            .Take(200)
            .ToList();

        var response = new SyncResponse(
            changeSetId.ToString(), status, false, createdKeys, updated, unchanged, gone, removals, tally.Rejected, attention);

        db.AtlasChangeSets.Add(new AtlasChangeSet
        {
            Id = changeSetId, IdempotencyKey = p.IdempotencyKey, Source = p.Source, Tool = p.Tool, ProductId = product.Id,
            RepoId = repo.Id, Repo = p.Repo, Branch = p.Branch, CommitSha = p.CommitSha, Scope = p.Scope, Environment = p.Environment,
            Actor = actor.Name, ActivityId = p.ActivityId, Summary = p.Summary, TaskCodes = p.Tasks.Distinct().ToList(),
            Status = status, BundleHash = p.BundleHash, ReceivedAt = now, AppliedAt = now,
            Result = JsonSerializer.Serialize(response, Json),
        });

        repo.LastSyncAt = now;
        repo.LastSyncSha = p.CommitSha;
        repo.LastSyncScope = p.Scope;
        if (!p.Partial)
        {
            // The GitHub collector owns the language shares and the archived flag; a scan replaces only the rest.
            var kept = repo.Stack.Where(f => f.Key.StartsWith("language:", StringComparison.Ordinal) || f.Key.StartsWith("github:", StringComparison.Ordinal));
            repo.Stack = kept.Concat(p.Scan.Stack.Select(f => new AtlasFact { Key = f.Key, Value = f.Value })).ToList();
            repo.LastScanHash = p.BundleHash;
        }
        if (p.Scope == AtlasScopes.Deployed) repo.LastDeployedSha = p.CommitSha;

        if (activity is not null)
        {
            activity.Repo = p.Repo;
            activity.Branch = p.Branch;
            activity.HeadSha = p.CommitSha;
            activity.Tool = p.Tool;
            activity.LastSyncAt = now;
        }

        if (changed)
        {
            await AtlasEvents.RecordAsync(db, new AtlasEvent
            {
                At = now, Source = "sync", Type = "sync.applied", Status = "info", ProductId = product.Id, RepoId = repo.Id,
                Title = Clean.Cut($"Sincronização de {p.Repo}: {createdKeys.Count} criados, {updated.Count} atualizados, {gone.Count} sumidos", 300)!,
                CommitSha = p.CommitSha, Detail = Clean.Cut(p.Summary, 1000), ExternalId = changeSetId.ToString(),
            }, ct);
        }

        await db.SaveChangesAsync(ct);
        return (response, changed);
    }

    /// <summary>The stored answer of an earlier request with the same key, marked as a replay.</summary>
    private async Task<SyncResponse?> ReplayAsync(string key, CancellationToken ct)
    {
        var existing = await db.AtlasChangeSets.AsNoTracking().FirstOrDefaultAsync(c => c.IdempotencyKey == key, ct);
        if (existing is null) return null;
        var stored = JsonSerializer.Deserialize<SyncResponse>(existing.Result, Json);
        return stored is null
            ? new SyncResponse(existing.Id.ToString(), existing.Status, true, [], [], 0, [], [], [], [])
            : stored with { Replayed = true };
    }

    // ---- Helpers -----------------------------------------------------------------------------

    private static bool IsUniqueViolation(DbUpdateException ex) => ex.InnerException is PostgresException { SqlState: "23505" };

    private static AtlasSyncRejected Bad(string message) => new(400, message);

    private static string? Lower(string? s) => s?.Trim().ToLowerInvariant() is { Length: > 0 } v ? v : null;

    private static string Sha256(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
}
