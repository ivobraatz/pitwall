using System.Collections;
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Metadata;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas;

/// <summary>
/// Writes the history of the Atlas as it is saved: one row per structural change, with who made
/// it and which fields moved. Collectors update what they observe all the time; those fields are
/// left out, so the history shows what the team and the agents did, not every poll.
/// </summary>
public sealed class AtlasChangeRecorder(AtlasActor actor) : SaveChangesInterceptor
{
    /// <summary>What the collectors and the sync observe. An update made only of these writes no history.</summary>
    private static readonly HashSet<string> Observation = new(StringComparer.OrdinalIgnoreCase)
    {
        "MonitorStatus", "DeployStatus", "LastDeployAt", "CommitSha", "CheckedAt", "VerifiedAt", "VerifiedBy", "MissingSince",
        "UpdatedAt", "Version", "LastRunName", "LastRunStatus", "LastRunAt", "LastRunUrl", "LastRunSha", "Commits7d", "Runs7d",
        "FailedRuns7d", "OpenAlerts", "OpenPullRequests", "LastSyncAt", "LastSyncSha", "LastSyncScope", "LastScanHash",
        "LastDeployedSha", "Stack", "DefaultBranch", "ExternalId",
    };

    /// <summary>A system's own settings change elsewhere; the Atlas shows and records only these.</summary>
    private static readonly HashSet<string> SystemFields = new(StringComparer.OrdinalIgnoreCase) { "Name", "Description", "WebsiteUrl", "Color" };

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Record(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Record(eventData.Context);
        return ValueTask.FromResult(result);
    }

    private void Record(DbContext? context)
    {
        if (context is null) return;
        context.ChangeTracker.DetectChanges();
        var now = DateTime.UtcNow;
        var ownedFields = OwnedFields(context);
        var changes = new List<AtlasChange>();

        foreach (var entry in context.ChangeTracker.Entries().ToList())
        {
            var entityType = EntityTypeOf(entry.Entity);
            if (entityType is null) continue;
            var owned = ownedFields.GetValueOrDefault(entry.Entity) ?? [];
            // An unchanged row whose JSON lists changed is an update of that row.
            var state = entry.State == EntityState.Unchanged ? EntityState.Modified : entry.State;
            if (state == EntityState.Modified && owned.Count == 0 && entry.State == EntityState.Unchanged) continue;

            var fields = new List<AtlasFieldChange>();
            string op;
            var id = (Guid)entry.Property("Id").CurrentValue!;
            var named = entry.Metadata.FindProperty("Name") is not null ? entry.Property("Name") : null;

            switch (state)
            {
                case EntityState.Added:
                    op = "created";
                    if (named is not null) fields.Add(new AtlasFieldChange { Field = "Name", After = Format(named.CurrentValue) });
                    break;
                case EntityState.Deleted:
                    op = "deleted";
                    if (named is not null) fields.Add(new AtlasFieldChange { Field = "Name", Before = Format(named.OriginalValue) });
                    break;
                case EntityState.Modified:
                {
                    var retired = entry.Metadata.FindProperty("RetiredAt") is not null ? entry.Property("RetiredAt") : null;
                    if (retired is { IsModified: true })
                    {
                        op = retired.CurrentValue is null ? "restored" : "retired";
                    }
                    else if (named is { IsModified: true })
                    {
                        op = "renamed";
                    }
                    else op = "updated";

                    foreach (var property in entry.Properties.Where(p => p.IsModified))
                    {
                        if (IsIgnored(entityType, property.Metadata.Name)) continue;
                        fields.Add(new AtlasFieldChange
                        {
                            Field = property.Metadata.Name, Before = Format(property.OriginalValue), After = Format(property.CurrentValue),
                        });
                    }
                    fields.AddRange(owned.Where(f => !IsIgnored(entityType, f.Field)));
                    // Nothing but observation: no row.
                    if (fields.Count == 0) continue;
                    break;
                }
                default:
                    continue;
            }

            changes.Add(new AtlasChange
            {
                Id = Guid.NewGuid(), At = now, Actor = Clean.Cut(actor.Name, 120) ?? AtlasActor.SystemName,
                Source = actor.Source, ChangeSetId = actor.ChangeSetId, EntityType = entityType, EntityId = id,
                ProductId = ProductOf(context, entry.Entity), Op = op, Fields = fields,
            });
        }

        if (changes.Count > 0) context.Set<AtlasChange>().AddRange(changes);
    }

    private static bool IsIgnored(string entityType, string property) =>
        entityType == "system" ? !SystemFields.Contains(property) : Observation.Contains(property)
        || property.StartsWith("LastRun", StringComparison.OrdinalIgnoreCase) || property.StartsWith("LastSync", StringComparison.OrdinalIgnoreCase);

    /// <summary>The history's name for each entity it follows; anything else is not recorded.</summary>
    private static string? EntityTypeOf(object entity) => entity switch
    {
        AtlasService => "service",
        AtlasLink => "link",
        AtlasRepo => "repo",
        AtlasProcess => "process",
        AtlasStep => "step",
        AtlasRoutine => "routine",
        AtlasEnvironment => "environment",
        Product => "system",
        AtlasRef => "ref",
        _ => null,
    };

    private static Guid? ProductOf(DbContext context, object entity) => entity switch
    {
        AtlasService s => s.ProductId,
        AtlasRepo r => r.ProductId,
        AtlasProcess p => p.ProductId,
        AtlasStep st => st.ProductId,
        AtlasRoutine rt => rt.ProductId,
        Product p => p.Id,
        AtlasLink l => context.ChangeTracker.Entries<AtlasService>().Select(e => e.Entity).FirstOrDefault(s => s.Id == l.FromServiceId)?.ProductId,
        _ => null,
    };

    /// <summary>
    /// Owned lists stored as JSON (facts, stages): a change to an element is a change of the owner's
    /// field, with the list as it is now. The owner is the one that holds the element; a removed element
    /// has no holder any more, so it is attributed to the owners being saved.
    /// </summary>
    private static Dictionary<object, List<AtlasFieldChange>> OwnedFields(DbContext context)
    {
        var result = new Dictionary<object, List<AtlasFieldChange>>(ReferenceEqualityComparer.Instance);
        var all = context.ChangeTracker.Entries().ToList();
        foreach (var owned in all.Where(e => e.State != EntityState.Unchanged && e.Metadata.IsOwned()))
        {
            var ownership = owned.Metadata.FindOwnership();
            var nav = ownership?.PrincipalToDependent;
            if (nav is null || !nav.IsCollection) continue;
            var ownerType = ownership!.PrincipalEntityType.ClrType;
            var owners = all.Where(o => o.Metadata.ClrType == ownerType && o.State != EntityState.Deleted).ToList();
            var holders = owners.Where(o => o.Collection(nav.Name).CurrentValue is IEnumerable items
                && items.Cast<object>().Any(x => ReferenceEquals(x, owned.Entity))).ToList();
            var targets = holders.Count > 0 ? holders : owners.Where(o => o.State == EntityState.Modified).ToList();

            foreach (var target in targets)
            {
                if (!result.TryGetValue(target.Entity, out var list)) result[target.Entity] = list = [];
                var field = nav.Name.ToLowerInvariant();
                if (list.Any(f => f.Field == field)) continue;
                var current = target.Collection(nav.Name).CurrentValue;
                list.Add(new AtlasFieldChange { Field = field, After = Clean.Cut(JsonSerializer.Serialize(current), 500) });
            }
        }
        return result;
    }

    private static string? Format(object? value)
    {
        var text = value switch
        {
            null => null,
            DateTime d => d.ToString("O", CultureInfo.InvariantCulture),
            bool b => b ? "sim" : "não",
            IEnumerable list when value is not string => string.Join(", ", list.Cast<object?>().Select(x => Convert.ToString(x, CultureInfo.InvariantCulture))),
            _ => Convert.ToString(value, CultureInfo.InvariantCulture),
        };
        return Clean.Cut(text, 500);
    }
}
