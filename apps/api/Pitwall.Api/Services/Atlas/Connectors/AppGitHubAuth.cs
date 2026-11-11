using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Pitwall.Services.Atlas;

/// <summary>
/// A GitHub App installation. The app proves itself with a JWT signed by its private key; GitHub gives an
/// installation token for that JWT, valid about an hour. The token is kept until five minutes before it ends,
/// then bought again. The key, the JWT and the token are never logged, never put in a message.
/// </summary>
public sealed class AppGitHubAuth(HttpClient http, string? appId, string? privateKey, string? installationId) : IAtlasGitHubAuth
{
    private static readonly TimeSpan Margin = TimeSpan.FromMinutes(5);
    private readonly SemaphoreSlim _lock = new(1, 1);
    private string? _token;
    private DateTime _expiresAt;

    public bool Configured => !string.IsNullOrWhiteSpace(appId) && !string.IsNullOrWhiteSpace(privateKey) && !string.IsNullOrWhiteSpace(installationId);

    public string RepositoriesPath => "/installation/repositories";

    public async Task<string?> TokenAsync(CancellationToken ct)
    {
        if (!Configured) return null;
        await _lock.WaitAsync(ct);
        try
        {
            if (_token is not null && DateTime.UtcNow < _expiresAt - Margin) return _token;
            (_token, _expiresAt) = await BuyInstallationTokenAsync(DateTime.UtcNow, ct);
            return _token;
        }
        finally { _lock.Release(); }
    }

    private async Task<(string Token, DateTime ExpiresAt)> BuyInstallationTokenAsync(DateTime now, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post,
            GitHubCollector.Api + $"/app/installations/{Uri.EscapeDataString(installationId!.Trim())}/access_tokens");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", CreateJwt(now));
        req.Headers.UserAgent.ParseAdd("Pitwall-Atlas/1.0");
        req.Headers.Accept.ParseAdd("application/vnd.github+json");
        req.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"O GitHub recusou a instalação do App ({(int)res.StatusCode}).", null, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>(ct);
        var token = body.Str("token") ?? throw new HttpRequestException("O GitHub não devolveu o token da instalação.");
        return (token, AtlasCollect.Instant(body.Str("expires_at")) ?? now.AddMinutes(55));
    }

    /// <summary>
    /// The app's JWT: RS256, issued a minute ago so a clock a little behind is not refused, valid for nine minutes.
    /// The key is read with the framework's PEM support; no package.
    /// </summary>
    public string CreateJwt(DateTime now)
    {
        var unix = new DateTimeOffset(now.ToUniversalTime()).ToUnixTimeSeconds();
        var header = Encode(new { alg = "RS256", typ = "JWT" });
        var payload = Encode(new { iat = unix - 60, exp = unix + 540, iss = appId!.Trim() });
        var input = $"{header}.{payload}";
        using var rsa = RSA.Create();
        try { rsa.ImportFromPem(PemText()); }
        catch (Exception ex) when (ex is CryptographicException or ArgumentException)
        {
            throw new InvalidOperationException("A chave privada do GitHub App não é um PEM válido.");
        }
        var signature = rsa.SignData(Encoding.ASCII.GetBytes(input), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return $"{input}.{Base64Url(signature)}";
    }

    /// <summary>The key as the console or the environment file holds it: with escaped line breaks or with real ones.</summary>
    private string PemText() => privateKey!.Trim().Replace("\\n", "\n");

    private static string Encode(object value) => Base64Url(JsonSerializer.SerializeToUtf8Bytes(value));

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
