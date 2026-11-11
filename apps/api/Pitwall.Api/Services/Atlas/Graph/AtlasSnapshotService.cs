using Pitwall.Data;
using Pitwall.Services.Atlas;

namespace Pitwall.Services.Atlas.Graph;

/// <summary>
/// Takes a snapshot of the map every six hours (only when it changed). Off in tests, like the other
/// background services: the tests take their snapshots themselves.
/// </summary>
public sealed class AtlasSnapshotService(IServiceScopeFactory scopes, IHostEnvironment env, ILogger<AtlasSnapshotService> logger)
    : BackgroundService
{
    public static readonly TimeSpan Every = TimeSpan.FromHours(6);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (env.IsEnvironment("Testing")) return;
        try
        {
            // Let the host finish starting (and migrating) before the first look.
            await Task.Delay(TimeSpan.FromMinutes(1), stop);
            using var timer = new PeriodicTimer(Every);
            do
            {
                await TakeOnceAsync(stop);
            }
            while (await timer.WaitForNextTickAsync(stop));
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested)
        {
        }
    }

    private async Task TakeOnceAsync(CancellationToken stop)
    {
        try
        {
            using var scope = scopes.CreateScope();
            await AtlasSnapshots.TakeAsync(scope.ServiceProvider.GetRequiredService<PitwallDb>(), "scheduled", stop);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("Atlas snapshot failed: {Message}", ex.Message);
        }
    }
}

/// <summary>
/// The real trigger: a sync asks for a snapshot, and it is taken in the background with its own scope,
/// never inside the request. At most one snapshot every ten minutes by this path; a request that comes
/// in the wait is taken once the wait is over, so the last state is never lost.
/// </summary>
public sealed class AtlasSnapshotRequests(IServiceScopeFactory scopes, ILogger<AtlasSnapshotRequests> logger) : IAtlasSnapshotTrigger
{
    public static readonly TimeSpan MinGap = TimeSpan.FromMinutes(10);

    private readonly object _gate = new();
    private DateTime _lastStarted = DateTime.MinValue;
    private bool _scheduled;

    public void Request(string reason)
    {
        lock (_gate)
        {
            if (_scheduled) return;
            var wait = _lastStarted + MinGap - DateTime.UtcNow;
            _scheduled = true;
            _ = RunAsync(reason, wait > TimeSpan.Zero ? wait : TimeSpan.Zero);
        }
    }

    private async Task RunAsync(string reason, TimeSpan delay)
    {
        if (delay > TimeSpan.Zero) await Task.Delay(delay);
        lock (_gate)
        {
            _scheduled = false;
            _lastStarted = DateTime.UtcNow;
        }
        try
        {
            using var scope = scopes.CreateScope();
            await AtlasSnapshots.TakeAsync(scope.ServiceProvider.GetRequiredService<PitwallDb>(), reason, CancellationToken.None);
        }
        catch (Exception ex)
        {
            logger.LogWarning("Atlas snapshot ({Reason}) failed: {Message}", reason, ex.Message);
        }
    }
}
