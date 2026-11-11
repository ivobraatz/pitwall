using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas;

/// <summary>
/// Operational events (a deploy, a run, a monitor change). An event with the provider's id is
/// written once: the same delivery seen again (a retry, a poll that overlaps the last) changes nothing.
/// </summary>
public static class AtlasEvents
{
    /// <returns>True when the event was new and is added to the unit of work; false when it was already there.</returns>
    public static async Task<bool> RecordAsync(PitwallDb db, AtlasEvent e, CancellationToken ct = default)
    {
        if (e.ExternalId is { Length: > 0 })
        {
            var exists = db.AtlasEvents.Local.Any(x => x.Source == e.Source && x.ExternalId == e.ExternalId)
                || await db.AtlasEvents.AnyAsync(x => x.Source == e.Source && x.ExternalId == e.ExternalId, ct);
            if (exists) return false;
        }
        db.AtlasEvents.Add(e);
        return true;
    }
}
