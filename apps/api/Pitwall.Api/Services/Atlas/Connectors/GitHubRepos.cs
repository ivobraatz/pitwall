using System.Net.Http.Headers;
using System.Text.Json;

namespace Pitwall.Services.Atlas;

/// <summary>One repository as GitHub lists it to this credential. Ids are text: the ExternalId of a repository.</summary>
public sealed record GitHubRepoItem(string Id, string FullName, string Url, bool Private, bool Archived, bool Fork, string? DefaultBranch);

/// <summary>The requests every GitHub read makes: the credential's token, the API version, a user agent. Never the token in a message.</summary>
public static class GitHubApi
{
    public static async Task<HttpRequestMessage> GetAsync(IAtlasGitHubAuth auth, string path, CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, GitHubCollector.Api + path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await auth.TokenAsync(ct));
        req.Headers.UserAgent.ParseAdd("Pitwall-Atlas/1.0");
        req.Headers.Accept.ParseAdd("application/vnd.github+json");
        req.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        return req;
    }
}

/// <summary>The repositories a credential can see, page by page: the App's installation list, or the person's own repositories with a token.</summary>
public static class GitHubRepoList
{
    public const int PageSize = 100;
    private const int MaxPages = 20;

    public static async Task<List<GitHubRepoItem>> FetchAsync(HttpClient http, IAtlasGitHubAuth auth, CancellationToken ct)
    {
        var all = new List<GitHubRepoItem>();
        var separator = auth.RepositoriesPath.Contains('?') ? "&" : "?";
        for (var page = 1; page <= MaxPages; page++)
        {
            var body = await AtlasCollect.GetJsonAsync(http,
                await GitHubApi.GetAsync(auth, $"{auth.RepositoriesPath}{separator}per_page={PageSize}&page={page}", ct), ct);
            // The installation's list wraps the array in an object; the user's list is the array itself.
            var items = body.ValueKind == JsonValueKind.Array ? body.EnumerateArray().ToList() : body.Items("repositories").ToList();
            all.AddRange(items.Select(Parse).OfType<GitHubRepoItem>());
            if (items.Count < PageSize) break;
        }
        return all;
    }

    private static GitHubRepoItem? Parse(JsonElement r)
    {
        var id = r.Scalar("id");
        var fullName = r.Str("full_name")?.ToLowerInvariant();
        if (id is null || fullName is null) return null;
        return new GitHubRepoItem(id, fullName, Clean.Cut(r.Str("html_url"), 300) ?? "",
            Flag(r, "private"), Flag(r, "archived"), Flag(r, "fork"), Clean.Cut(r.Str("default_branch"), 100));
    }

    private static bool Flag(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
}
