using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services;

namespace Pitwall.Tests;

/// <summary>The sweep drops Atlas events older than 90 days and keeps the younger ones.</summary>
public class AtlasConnectorRetentionTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    [Fact]
    public async Task Atlas_events_older_than_ninety_days_are_removed_and_younger_ones_stay()
    {
        var marker = ConnectorKit.Unique("retencao");
        var old = new AtlasEvent { Id = Guid.NewGuid(), At = DateTime.UtcNow.AddDays(-91), Source = "github", Type = "push", Title = marker + " 91" };
        var young = new AtlasEvent { Id = Guid.NewGuid(), At = DateTime.UtcNow.AddDays(-89), Source = "github", Type = "push", Title = marker + " 89" };
        using (var scope = fx.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
            db.AtlasEvents.AddRange(old, young);
            await db.SaveChangesAsync();
        }

        using (var scope = fx.Factory.Services.CreateScope())
        {
            var sweep = new RetentionService(fx.Factory.Services.GetRequiredService<IServiceScopeFactory>(), NullLogger<RetentionService>.Instance);
            await sweep.SweepAsync(CancellationToken.None);
        }

        var titles = await ConnectorKit.ReadAsync(fx, db => db.AtlasEvents.Where(e => e.Title.StartsWith(marker)).Select(e => e.Title).ToListAsync());
        Assert.Equal([marker + " 89"], titles);
    }
}
