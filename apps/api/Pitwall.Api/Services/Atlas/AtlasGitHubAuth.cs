namespace Pitwall.Services.Atlas;

/// <summary>
/// How the Atlas talks to GitHub. A collector asks for a token on each request, so a credential that
/// rotates (an app's installation token) is never held longer than it is valid.
/// </summary>
public interface IAtlasGitHubAuth
{
    bool Configured { get; }
    Task<string?> TokenAsync(CancellationToken ct);
}

/// <summary>A personal access token from the environment. Never logged, never returned to a caller.</summary>
public sealed class PatGitHubAuth(string? token) : IAtlasGitHubAuth
{
    public bool Configured => !string.IsNullOrWhiteSpace(token);

    public Task<string?> TokenAsync(CancellationToken ct) => Task.FromResult(Configured ? token : null);
}
