using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas.Sync;

/// <summary>What one sync is about: the repository and its system, how far it reaches, and the change set it belongs to.</summary>
internal sealed record SyncContext(
    Product System, string Repo, string Scope, string? Environment, string? CommitSha, Guid ChangeSetId, DateTime Now)
{
    /// <summary>The evidence source of everything this repository's code says: one per repository.</summary>
    public string RepoSource => "repo:" + Repo;
}

/// <summary>What a sync changed, collected while it runs and written into the response at the end.</summary>
internal sealed class SyncTally
{
    public readonly List<SyncRejection> Rejected = [];
    /// <summary>Keys of nodes whose code evidence went away (never retired).</summary>
    public readonly HashSet<string> Gone = new(StringComparer.Ordinal);
    /// <summary>Keys of nodes someone or something reported as removed (waiting for a person).</summary>
    public readonly HashSet<string> Removals = new(StringComparer.Ordinal);
    public readonly HashSet<Guid> Touched = [];
    /// <summary>Nodes whose evidence or links changed; the fingerprint does not show those.</summary>
    public readonly HashSet<Guid> Explicit = [];
}

/// <summary>
/// Applies one scan and one report to the map (contract 3, step 5). Works on the entities already
/// tracked by the unit of work, so every decision sees what this same sync already decided. Retired
/// nodes are never restored by a scan: a person retired them, and that stays until the person changes it.
/// </summary>
internal sealed class AtlasReconciler
{
    private readonly PitwallDb _db;
    private readonly AtlasWriter _writer;
    private readonly SyncContext _ctx;
    private readonly SyncTally _tally = new();
    private readonly HashSet<Guid> _seen = [];
    private Dictionary<Guid, string> _before = new();

    public AtlasReconciler(PitwallDb db, AtlasWriter writer, SyncContext ctx)
    {
        _db = db;
        _writer = writer;
        _ctx = ctx;
    }

    public SyncTally Tally => _tally;

    /// <summary>Loads every node once: the map is small, and decisions are easier to make in memory.</summary>
    public async Task LoadAsync(CancellationToken ct)
    {
        var services = await _db.AtlasServices.ToListAsync(ct);
        _before = services.ToDictionary(s => s.Id, Fingerprint);
    }

    // ---- Findings (the scan) ------------------------------------------------------------------

    public async Task ApplyFindingsAsync(IReadOnlyList<Finding> findings, CancellationToken ct)
    {
        var nodes = new AtlasService?[findings.Count];
        var bySignature = new Dictionary<string, AtlasService>(StringComparer.Ordinal);

        for (var i = 0; i < findings.Count; i++)
        {
            var f = findings[i];
            var node = await NodeForAsync(f, ct);
            if (node is null) continue;
            nodes[i] = node;
            bySignature.TryAdd(f.Signature, node);
            _tally.Touched.Add(node.Id);

            var detail = _ctx.Scope == AtlasScopes.Deployed ? $"ambiente: {_ctx.Environment}" : null;
            var (_, changed) = await EvidenceAsync(AtlasSubjects.Service, node.Id, _ctx.RepoSource, f.Method, f.Reference, f.Relation,
                _ctx.Scope, detail, _ctx.CommitSha, ct);
            if (changed) _tally.Explicit.Add(node.Id);
        }

        // Edges between findings are links of the map, with the same evidence as the nodes.
        for (var i = 0; i < findings.Count; i++)
        {
            var f = findings[i];
            if (nodes[i] is not { } node) continue;
            if (f.FromSignature is { } from && bySignature.TryGetValue(from, out var source) && source.Id != node.Id)
                await LinkAsync(source, node, f, ct);
            if (f.ToSignature is { } to && bySignature.TryGetValue(to, out var target) && target.Id != node.Id)
                await LinkAsync(node, target, f, ct);
        }
    }

    /// <summary>Code evidence not seen in this scan goes away, for pushed and deployed scans of a complete package only.</summary>
    public async Task MarkGoneAsync(CancellationToken ct)
    {
        var source = _ctx.RepoSource;
        var live = await _db.AtlasEvidence.Where(e => e.Source == source && e.GoneAt == null).ToListAsync(ct);
        var missing = live.Where(e => !_seen.Contains(e.Id)).ToList();
        if (missing.Count == 0) return;

        var nodes = _db.AtlasServices.Local.ToDictionary(s => s.Id);
        foreach (var evidence in missing)
        {
            if (evidence.SubjectType == AtlasSubjects.Service && nodes.TryGetValue(evidence.SubjectId, out var node))
                _tally.Gone.Add(node.Key);
        }
        await AtlasEvidenceWriter.MarkGoneAsync(_db, source, _seen, _ctx.Now, ct);
    }

    // ---- Report operations ---------------------------------------------------------------------

    public async Task ApplyOpsAsync(IReadOnlyList<SyncOp> ops, CancellationToken ct)
    {
        foreach (var op in ops)
        {
            var kind = (op.Op ?? "").Trim().ToLowerInvariant();
            switch (kind)
            {
                case "node": await NodeOpAsync(op, ct); break;
                case "edge": await EdgeOpAsync(op, ct); break;
                case "removed": await RemovedOpAsync(op, ct); break;
                case "task": await TaskOpAsync(op, ct); break;
                default: Reject(kind.Length == 0 ? "op" : kind, "Operação desconhecida. Use node, edge, removed ou task."); break;
            }
        }
    }

    private async Task NodeOpAsync(SyncOp op, CancellationToken ct)
    {
        var name = Clean.Cut(op.Name, 120);
        if (name is null) { Reject("node", "Dê um nome ao componente (até 120 caracteres)."); return; }
        var kind = (op.Kind ?? "").Trim().ToLowerInvariant();
        if (!AtlasServiceKinds.IsValid(kind)) { Reject("node", $"Tipo inválido: {Clean.Cut(op.Kind, 40)}."); return; }
        if (op.Facts is { Count: > 40 }) { Reject("node", "No máximo 40 detalhes por componente."); return; }

        var (node, _, error) = await _writer.UpsertServiceAsync(new AtlasWriter.ServiceInput(
            System: _ctx.System.Slug, Environment: op.Environment, Name: name, Kind: kind, Provider: op.Provider, Url: op.Url,
            Group: op.Group, Signature: op.Signature, Facts: op.Facts, Key: op.Key, Engine: op.Engine, Origin: AtlasOrigins.Reported), ct);
        if (error is not null || node is null) { Reject("node", error ?? "Componente inválido."); return; }

        _tally.Touched.Add(node.Id);
        var (_, changed) = await EvidenceAsync(AtlasSubjects.Service, node.Id, AtlasSources.Agent, AtlasMethods.Report,
            op.Evidence ?? AtlasMethods.ReportRef, null, AtlasScopes.Declared, null, null, ct);
        if (changed) _tally.Explicit.Add(node.Id);
    }

    private async Task EdgeOpAsync(SyncOp op, CancellationToken ct)
    {
        var relation = (op.Relation ?? "").Trim().ToLowerInvariant();
        if (!AtlasRelations.IsValid(relation)) { Reject("edge", "Relação inválida."); return; }
        var from = await _writer.FindServiceAsync(op.From, ct);
        if (from is null) { Reject("edge", $"Serviço de origem não encontrado: {Clean.Cut(op.From, 120)}."); return; }
        var to = await _writer.FindServiceAsync(op.To, ct);
        if (to is null) { Reject("edge", $"Serviço de destino não encontrado: {Clean.Cut(op.To, 120)}."); return; }

        var (link, error) = await _writer.LinkAsync(from.Id.ToString(), to.Id.ToString(), null, ct, relation: relation);
        if (error is not null || link is null) { Reject("edge", error ?? "Ligação inválida."); return; }
        var linkIsNew = _db.Entry(link).State == EntityState.Added;
        if (linkIsNew) link.Origin = AtlasOrigins.Reported;

        _tally.Touched.Add(from.Id);
        _tally.Touched.Add(to.Id);
        var (_, changed) = await EvidenceAsync(AtlasSubjects.Link, link.Id, AtlasSources.Agent, AtlasMethods.Report,
            op.Evidence ?? AtlasMethods.ReportRef, null, AtlasScopes.Declared, null, null, ct);
        if (linkIsNew || changed)
        {
            _tally.Explicit.Add(from.Id);
            _tally.Explicit.Add(to.Id);
        }
    }

    /// <summary>A removal is reported, never done: the node stays until a person confirms or dismisses it.</summary>
    private async Task RemovedOpAsync(SyncOp op, CancellationToken ct)
    {
        var node = await _writer.FindServiceAsync(op.Ref, ct);
        if (node is null) { Reject("removed", $"Serviço não encontrado: {Clean.Cut(op.Ref, 120)}."); return; }
        node.RemovalReportedAt ??= _ctx.Now;
        _tally.Removals.Add(node.Key);
        var (_, changed) = await EvidenceAsync(AtlasSubjects.Service, node.Id, AtlasSources.Agent, AtlasMethods.Report,
            op.Evidence ?? AtlasMethods.ReportRef, null, AtlasScopes.Declared, null, null, ct);
        if (changed) _tally.Explicit.Add(node.Id);
    }

    private async Task TaskOpAsync(SyncOp op, CancellationToken ct)
    {
        var node = await _writer.FindServiceAsync(op.Ref, ct);
        if (node is null) { Reject("task", $"Serviço não encontrado: {Clean.Cut(op.Ref, 120)}."); return; }
        var (reference, error) = await _writer.AddRefAsync(node, AtlasRefKinds.Task, op.Code, op.Note, ct);
        if (error is not null || reference is null) { Reject("task", error ?? "Tarefa inválida."); return; }
        _tally.Touched.Add(node.Id);
        if (_db.Entry(reference).State == EntityState.Added) _tally.Explicit.Add(node.Id);
    }

    // ---- Summary -------------------------------------------------------------------------------

    /// <summary>
    /// The keys of nodes created and updated in this sync, and how many touched nodes ended up unchanged.
    /// A node is updated when its fields moved, or when evidence or a link about it was added or revived.
    /// </summary>
    public (List<string> Created, List<string> Updated, int Unchanged) Summarize()
    {
        var services = _db.AtlasServices.Local.ToList();
        var created = services.Where(s => _db.Entry(s).State == EntityState.Added).ToList();
        var createdIds = created.Select(s => s.Id).ToHashSet();
        var updated = services
            .Where(s => !createdIds.Contains(s.Id)
                && (_tally.Explicit.Contains(s.Id) || (_before.TryGetValue(s.Id, out var before) && before != Fingerprint(s))))
            .ToList();
        var updatedIds = updated.Select(s => s.Id).ToHashSet();
        var unchanged = _tally.Touched.Count(id => !createdIds.Contains(id) && !updatedIds.Contains(id));
        return (
            created.Select(s => s.Key).Order(StringComparer.Ordinal).ToList(),
            updated.Select(s => s.Key).Order(StringComparer.Ordinal).ToList(),
            unchanged);
    }

    // ---- Nodes ---------------------------------------------------------------------------------

    /// <summary>
    /// The node a finding is about. A shared finding (a payment provider, a mail service) is one node for the whole
    /// operation, found by signature, then by name; a finding named like a system goes to that system's main service.
    /// Any other finding is the system's own node with the same name, created when there is none.
    /// </summary>
    private async Task<AtlasService?> NodeForAsync(Finding f, CancellationToken ct)
    {
        if (f.Shared)
        {
            var shared = SharedHit(f);
            if (shared is not null)
            {
                if (shared.RetiredAt is null) Enrich(shared, f);
                return shared;
            }
            var system = await SystemNamedAsync(f.Name, ct);
            if (system is not null)
            {
                var main = _db.AtlasServices.Local
                    .Where(s => s.ProductId == system.Id && s.RetiredAt == null)
                    .OrderBy(s => KindRank(s.Kind))
                    .FirstOrDefault();
                if (main is not null) return main;
            }
            return await CreateAsync(f, null, ct);
        }

        var candidates = _db.AtlasServices.Local
            .Where(s => s.ProductId == _ctx.System.Id && s.EnvironmentId == null && NameEq(s.Name, f.Name))
            .ToList();
        var own = candidates.FirstOrDefault(s => s.Signature == f.Signature) ?? candidates.FirstOrDefault();
        if (own is not null)
        {
            if (own.RetiredAt is null) Enrich(own, f);
            return own;
        }
        return await CreateAsync(f, _ctx.System, ct);
    }

    private AtlasService? SharedHit(Finding f)
    {
        var shared = _db.AtlasServices.Local.Where(s => s.ProductId == null).ToList();
        return shared.OrderBy(s => s.RetiredAt is null ? 0 : 1).FirstOrDefault(s => s.Signature == f.Signature)
            ?? shared.OrderBy(s => s.RetiredAt is null ? 0 : 1).FirstOrDefault(s => NameEq(s.Name, f.Name) || s.Aliases.Any(a => NameEq(a, f.Name)));
    }

    private async Task<Product?> SystemNamedAsync(string name, CancellationToken ct)
    {
        var slug = AtlasWriter.NameSlug(name);
        var products = await _db.Products.AsNoTracking().ToListAsync(ct);
        var match = products.FirstOrDefault(p => p.Slug == slug) ?? products.FirstOrDefault(p => NameEq(p.Name, name));
        return match is null ? null : _db.Products.Local.FirstOrDefault(p => p.Id == match.Id) ?? match;
    }

    private async Task<AtlasService?> CreateAsync(Finding f, Product? system, CancellationToken ct)
    {
        var (node, _, error) = await _writer.UpsertServiceAsync(new AtlasWriter.ServiceInput(
            System: system?.Slug, Environment: null, Name: f.Name, Kind: f.Kind, Provider: f.Provider, ExternalRef: f.ExternalRef,
            Facts: FactsOf(f), Signature: f.Signature, Origin: AtlasOrigins.Discovered), ct);
        if (error is not null || node is null)
        {
            Reject("node", error ?? "Componente inválido.");
            return null;
        }
        return node;
    }

    /// <summary>A discovered node follows the repository: its facts and its provider reference are what the code says now.</summary>
    private void Enrich(AtlasService node, Finding f)
    {
        if (node.Origin != AtlasOrigins.Discovered) return;
        if (FactsOf(f) is { } facts)
            node.Facts = facts.Select(kv => new AtlasFact { Key = kv.Key, Value = kv.Value }).ToList();
        if (f.Provider is not null) node.Provider = f.Provider;
        if (f.ExternalRef is not null) node.ExternalRef = Clean.Cut(f.ExternalRef, 300);
    }

    private static Dictionary<string, string>? FactsOf(Finding f)
    {
        if (f.Facts is not { Count: > 0 } facts) return null;
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var kv in facts.Take(40))
        {
            var key = Clean.Cut(kv.Key, 60);
            var value = Clean.Cut(kv.Value, 500);
            if (key is not null && value is not null) result.TryAdd(key, value);
        }
        return result.Count == 0 ? null : result;
    }

    private async Task LinkAsync(AtlasService from, AtlasService to, Finding f, CancellationToken ct)
    {
        var relation = f.Relation;
        var link = _db.AtlasLinks.Local.FirstOrDefault(l => l.FromServiceId == from.Id && l.ToServiceId == to.Id && l.Relation == relation)
            ?? await _db.AtlasLinks.FirstOrDefaultAsync(l => l.FromServiceId == from.Id && l.ToServiceId == to.Id && l.Relation == relation, ct);
        var isNew = link is null;
        link ??= new AtlasLink
        {
            Id = Guid.NewGuid(), FromServiceId = from.Id, ToServiceId = to.Id, Relation = relation,
            Origin = AtlasOrigins.Discovered, CreatedAt = _ctx.Now, UpdatedAt = _ctx.Now,
        };
        if (isNew) _db.AtlasLinks.Add(link);
        // A person retired this link: a scan does not bring it back.
        if (link.RetiredAt is not null) return;

        var (_, changed) = await EvidenceAsync(AtlasSubjects.Link, link.Id, _ctx.RepoSource, f.Method, f.Reference, null,
            _ctx.Scope, null, _ctx.CommitSha, ct);
        if (isNew || changed)
        {
            _tally.Explicit.Add(from.Id);
            _tally.Explicit.Add(to.Id);
        }
    }

    // ---- Evidence ------------------------------------------------------------------------------

    /// <summary>
    /// Upserts one piece of evidence and says whether it is new or came back after being gone.
    /// The evidence writer keeps the strongest scope; the reconciler only needs the change flag.
    /// </summary>
    private async Task<(AtlasEvidence Evidence, bool Changed)> EvidenceAsync(
        string subjectType, Guid subjectId, string source, string method, string reference, string? relation,
        string scope, string? detail, string? commitSha, CancellationToken ct)
    {
        var evidence = await AtlasEvidenceWriter.UpsertAsync(_db, subjectType, subjectId, source, method, Clean.Cut(reference, 300) ?? method,
            scope, _ctx.Now, Clean.Cut(detail, 500), relation, commitSha, _ctx.ChangeSetId, ct);
        _seen.Add(evidence.Id);
        var entry = _db.Entry(evidence);
        // Coming back after being gone, or reaching a stronger scope, is a change of the map.
        var changed = entry.State == EntityState.Added
            || (entry.State == EntityState.Modified
                && (entry.OriginalValues[nameof(AtlasEvidence.GoneAt)] is not null
                    || (string?)entry.OriginalValues[nameof(AtlasEvidence.Scope)] != evidence.Scope));
        return (evidence, changed);
    }

    // ---- Helpers -------------------------------------------------------------------------------

    /// <summary>What the map shows of a node: anything a person or a sync can change. Observation fields are left out.</summary>
    private static string Fingerprint(AtlasService s) =>
        $"{s.Key}\u001f{s.Name}\u001f{s.Kind}\u001f{s.Engine}\u001f{s.Signature}\u001f{s.Origin}\u001f{s.ProductId}\u001f{s.EnvironmentId}"
        + $"\u001f{s.RetiredAt}\u001f{s.RetiredReason}\u001f{s.RemovalReportedAt}\u001f{s.MissingSince}\u001f{s.Provider}\u001f{s.ExternalRef}"
        + $"\u001f{s.Url}\u001f{s.Group}\u001f{s.Condition}\u001f{string.Join(";", s.Aliases)}"
        + $"\u001f{string.Join(";", s.Facts.Select(f => f.Key + "=" + f.Value))}";

    private static bool NameEq(string? a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    private static int KindRank(string kind) => kind switch { "api" => 0, "web" => 1, "site" => 2, "worker" => 3, _ => 4 };

    private void Reject(string op, string message)
    {
        _tally.Rejected.Add(new SyncRejection(Clean.Cut(op, 40) ?? "op", AtlasSanitizer.Redact(Clean.Cut(message, 300))));
    }
}

/// <summary>The node and evidence kinds the reconciler writes, as the database spells them.</summary>
internal static class AtlasSubjects
{
    public const string Service = "service";
    public const string Link = "link";
}

internal static class AtlasSources
{
    public const string Agent = "agent";
}

internal static class AtlasMethods
{
    public const string Report = "report";
    public const string ReportRef = "relatório";
}
