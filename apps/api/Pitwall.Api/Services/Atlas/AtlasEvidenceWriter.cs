using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas;

/// <summary>
/// Evidence is "a source saw this, here, at this scope". Upserting the same source and reference
/// again only moves the last-seen time; it never duplicates, and the scope keeps the strongest seen.
/// A source that stops seeing it marks it gone, and it comes back the next time it is seen.
/// </summary>
public static class AtlasEvidenceWriter
{
    public static async Task<AtlasEvidence> UpsertAsync(
        PitwallDb db, string subjectType, Guid subjectId, string source, string method, string reference, string scope, DateTime now,
        string? detail = null, string? relation = null, string? commitSha = null, Guid? changeSetId = null, CancellationToken ct = default)
    {
        bool Same(AtlasEvidence e) => e.SubjectType == subjectType && e.SubjectId == subjectId && e.Source == source && e.Ref == reference;
        var evidence = db.AtlasEvidence.Local.FirstOrDefault(Same)
            ?? await db.AtlasEvidence.FirstOrDefaultAsync(e => e.SubjectType == subjectType && e.SubjectId == subjectId
                && e.Source == source && e.Ref == reference, ct);
        if (evidence is null)
        {
            evidence = new AtlasEvidence
            {
                Id = Guid.NewGuid(), SubjectType = subjectType, SubjectId = subjectId, Source = source, Method = method, Ref = reference,
                Scope = scope, FirstSeenAt = now, LastSeenAt = now,
            };
            db.AtlasEvidence.Add(evidence);
        }
        else
        {
            evidence.Scope = AtlasScopes.Stronger(evidence.Scope, scope);
            evidence.Method = method;
            evidence.GoneAt = null;
            evidence.LastSeenAt = now;
        }
        if (detail is not null) evidence.Detail = Clean.Cut(detail, 500);
        if (relation is not null) evidence.Relation = relation;
        if (commitSha is not null) evidence.CommitSha = Clean.Cut(commitSha, 64);
        if (changeSetId is not null) evidence.ChangeSetId = changeSetId;
        return evidence;
    }

    /// <summary>
    /// Marks gone every live evidence of <paramref name="source"/> that was not seen in this run.
    /// Only that source: another source's evidence on the same node is untouched. Returns how many.
    /// </summary>
    public static async Task<int> MarkGoneAsync(
        PitwallDb db, string source, IReadOnlyCollection<Guid> seenEvidenceIds, DateTime now, CancellationToken ct = default)
    {
        var seen = seenEvidenceIds.ToHashSet();
        var fromDatabase = await db.AtlasEvidence.Where(e => e.Source == source && e.GoneAt == null).ToListAsync(ct);
        // Evidence added in this unit of work and not saved yet counts too.
        var pending = db.AtlasEvidence.Local.Where(e => e.Source == source && e.GoneAt == null && db.Entry(e).State == EntityState.Added);
        var gone = 0;
        foreach (var evidence in fromDatabase.Concat(pending).DistinctBy(e => e.Id))
        {
            if (seen.Contains(evidence.Id)) continue;
            evidence.GoneAt = now;
            gone++;
        }
        return gone;
    }
}
