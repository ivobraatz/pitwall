using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Storage;

namespace Pitwall.Services;

/// <summary>
/// Keeps only what is still useful. Hourly:
///   - server errors older than 30 days (tickets keep their signature; the stack trace goes);
///   - recordings of tickets closed more than 90 days ago (the conversation stays);
///   - expired console sessions and delivered webhooks older than 30 days.
/// </summary>
public sealed class RetentionService(IServiceScopeFactory scopes, ILogger<RetentionService> logger) : BackgroundService
{
    public static readonly TimeSpan ServerErrorRetention = TimeSpan.FromDays(30);
    public static readonly TimeSpan WebhookLogRetention = TimeSpan.FromDays(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the app finish starting (and migrating) first.
        try { await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); } catch (OperationCanceledException) { return; }
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try { await SweepAsync(stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Retention sweep failed; next hour will try again.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task SweepAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        var store = scope.ServiceProvider.GetRequiredService<AttachmentStore>();
        var now = DateTime.UtcNow;

        var errors = await db.ServerErrors.Where(e => e.OccurredAt < now - ServerErrorRetention).ExecuteDeleteAsync(ct);
        var sessions = await db.StaffSessions.Where(s => s.ExpiresAt < now).ExecuteDeleteAsync(ct);
        var hooks = await db.WebhookDeliveries
            .Where(w => w.Status != WebhookStatuses.Pending && w.CreatedAt < now - WebhookLogRetention)
            .ExecuteDeleteAsync(ct);

        var cutoff = now - AttachmentStore.RecordingRetentionAfterClose;
        var stale = await db.TicketAttachments
            .Where(a => a.Kind == AttachmentKinds.Recording && a.Ticket.ClosedAt != null && a.Ticket.ClosedAt < cutoff)
            .Take(500).ToListAsync(ct);
        foreach (var a in stale) await store.DeleteAsync(a.StorageKey, ct);
        db.TicketAttachments.RemoveRange(stale);
        await db.SaveChangesAsync(ct);

        if (errors + sessions + hooks + stale.Count > 0)
            logger.LogInformation("Retention: {Errors} server errors, {Recordings} recordings, {Sessions} sessions, {Hooks} webhook logs removed",
                errors, stale.Count, sessions, hooks);
    }
}
