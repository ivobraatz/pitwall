using Microsoft.EntityFrameworkCore;
using Pitwall.Data;

namespace Pitwall.Services.Atlas.Graph;

/// <summary>
/// What each source last did: the collectors that are configured, and the rows they left. A source
/// that is connected but has not succeeded for three hours is stale; its old data stays on the map.
/// </summary>
internal static class AtlasSources
{
    public static readonly TimeSpan StaleAfter = TimeSpan.FromHours(3);

    public static async Task<List<SourceStatusDto>> ListAsync(PitwallDb db, AtlasCollectorRunner runner, DateTime now, CancellationToken ct)
    {
        var rows = await db.AtlasSources.AsNoTracking().ToListAsync(ct);
        var connected = runner.Collectors.DistinctBy(c => c.Name)
            .ToDictionary(c => c.Name, c => c.Configured, StringComparer.Ordinal);
        var byName = rows.ToDictionary(r => r.Name, StringComparer.Ordinal);
        var names = connected.Keys.Concat(byName.Keys).Distinct(StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal);

        return names.Select(name =>
        {
            byName.TryGetValue(name, out var row);
            var isConnected = connected.GetValueOrDefault(name);
            var stale = isConnected && (row?.LastOkAt is null || row.LastOkAt < now - StaleAfter);
            return new SourceStatusDto(name, isConnected, row?.LastRunAt, row?.LastOkAt, row?.LastError, row?.ItemsSeen, stale);
        }).ToList();
    }
}
