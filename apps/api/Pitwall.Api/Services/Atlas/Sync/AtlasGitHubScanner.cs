using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Pitwall.Services.Atlas.Sync;

/// <summary>
/// Reads a repository's whitelisted files through the GitHub API, for a scan the server runs itself. The token
/// is asked for per call and only ever goes into the request header: it is not logged, stored or returned.
/// </summary>
public sealed class AtlasGitHubScanner(IHttpClientFactory http, IAtlasGitHubAuth auth)
{
    public const string NotConnected = "Conecte o GitHub para escanear pelo servidor (veja Integração).";

    /// <summary>The package of one scan. <see cref="Partial"/> is true when something on the list was not read.</summary>
    public sealed record ScanPackage(string Branch, string TreeSha, List<SyncFile> Files, bool Partial);

    public async Task<ScanPackage> FetchAsync(string fullName, string? defaultBranch, CancellationToken ct)
    {
        if (!auth.Configured) throw new AtlasSyncRejected(409, NotConnected);
        var token = await auth.TokenAsync(ct);
        if (string.IsNullOrWhiteSpace(token)) throw new AtlasSyncRejected(409, NotConnected);
        var client = http.CreateClient("atlas");

        var branch = defaultBranch;
        if (string.IsNullOrWhiteSpace(branch))
        {
            var repo = await GetJsonAsync(client, token, $"https://api.github.com/repos/{fullName}", ct);
            branch = repo.TryGetProperty("default_branch", out var b) ? b.GetString() : null;
            if (string.IsNullOrWhiteSpace(branch)) throw new AtlasSyncRejected(422, "O repositório não tem branch padrão para escanear.");
        }

        var tree = await GetJsonAsync(client, token, $"https://api.github.com/repos/{fullName}/git/trees/{Uri.EscapeDataString(branch)}?recursive=1", ct);
        var treeSha = tree.GetProperty("sha").GetString() ?? "";
        var partial = tree.TryGetProperty("truncated", out var truncated) && truncated.GetBoolean();

        var entries = tree.GetProperty("tree").EnumerateArray()
            .Where(e => e.TryGetProperty("type", out var t) && t.GetString() == "blob")
            .Select(e => (
                Path: AtlasSanitizer.NormalizePath(e.GetProperty("path").GetString() ?? ""),
                Sha: e.GetProperty("sha").GetString() ?? "",
                Size: e.TryGetProperty("size", out var s) ? s.GetInt64() : 0))
            .Where(e => AtlasSanitizer.Category(e.Path) != AtlasSanitizer.PathKind.None && !AtlasSanitizer.IsForbiddenPath(e.Path))
            .OrderBy(e => e.Path, StringComparer.Ordinal)
            .ToList();
        if (entries.Count > AtlasSyncService.MaxFiles)
        {
            entries = entries.Take(AtlasSyncService.MaxFiles).ToList();
            partial = true;
        }

        var files = new List<SyncFile>();
        long total = 0;
        foreach (var entry in entries)
        {
            if (AtlasSanitizer.Category(entry.Path) == AtlasSanitizer.PathKind.Presence)
            {
                files.Add(new SyncFile(entry.Path, null));
                continue;
            }
            // A content file that cannot be read is a partial scan: its absence must not read as "gone".
            if (entry.Size > AtlasSyncService.MaxFileBytes || total + entry.Size > AtlasSyncService.MaxPackageBytes)
            {
                partial = true;
                continue;
            }
            try
            {
                var blob = await GetJsonAsync(client, token, $"https://api.github.com/repos/{fullName}/git/blobs/{entry.Sha}", ct);
                var encoded = blob.GetProperty("content").GetString() ?? "";
                var text = Encoding.UTF8.GetString(Convert.FromBase64String(encoded.Replace("\n", "")));
                total += Encoding.UTF8.GetByteCount(text);
                files.Add(new SyncFile(entry.Path, text));
            }
            catch (Exception ex) when (ex is AtlasSyncRejected or FormatException or HttpRequestException or KeyNotFoundException or InvalidOperationException)
            {
                partial = true;
            }
        }

        return new ScanPackage(branch, treeSha, files, partial);
    }

    private static async Task<JsonElement> GetJsonAsync(HttpClient client, string token, string url, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.UserAgent.ParseAdd("Pitwall-Atlas");
        using var response = await client.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
            throw new AtlasSyncRejected(502, $"O GitHub não respondeu como esperado (código {(int)response.StatusCode}).");
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        return doc.RootElement.Clone();
    }
}
