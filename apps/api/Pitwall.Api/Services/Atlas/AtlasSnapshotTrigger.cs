namespace Pitwall.Services.Atlas;

/// <summary>
/// Asks for a snapshot of the map soon (after a sync, say). The request never waits for the snapshot:
/// the graph service takes it outside the request. Until that service is registered, asking does nothing.
/// </summary>
public interface IAtlasSnapshotTrigger
{
    void Request(string reason);
}

public sealed class NoopAtlasSnapshotTrigger : IAtlasSnapshotTrigger
{
    public void Request(string reason)
    {
    }
}
