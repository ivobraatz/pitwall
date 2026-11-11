using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Pitwall.Services.Atlas;

namespace Pitwall.Tests;

/// <summary>
/// The GitHub App credential: the JWT's header and claims (checked against a public key made in the test), the
/// installation token bought once and kept, the App winning over the personal token, and the App's repository list.
/// </summary>
public class AtlasConnectorGitHubAppTests
{
    private const string AppId = "424242";
    private const string InstallationId = "7070707";
    private const string InstallationToken = "ghs_test_installation_token";

    private static string Pem(RSA rsa) => rsa.ExportRSAPrivateKeyPem();

    private static (string Header, string Payload, string Signature) Split(string jwt)
    {
        var parts = jwt.Split('.');
        Assert.Equal(3, parts.Length);
        return (parts[0], parts[1], parts[2]);
    }

    private static JsonElement Decode(string part)
    {
        var base64 = part.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
        return JsonDocument.Parse(Convert.FromBase64String(base64)).RootElement.Clone();
    }

    private static byte[] Bytes(string part) => Convert.FromBase64String(
        part.Replace('-', '+').Replace('_', '/').PadRight(part.Length + (4 - part.Length % 4) % 4, '='));

    private static string FutureInstant(TimeSpan from) => DateTime.UtcNow.Add(from).ToString("yyyy-MM-ddTHH:mm:ssZ");

    [Fact]
    public void The_app_jwt_is_rs256_with_the_claims_of_the_app_and_verifies_with_its_public_key()
    {
        using var rsa = RSA.Create(2048);
        var auth = new AppGitHubAuth(new HttpClient(new ConnectorKit.FakeProvider()), AppId, Pem(rsa), InstallationId);
        var now = DateTime.UtcNow;

        var jwt = auth.CreateJwt(now);
        var (header, payload, signature) = Split(jwt);

        var h = Decode(header);
        Assert.Equal("RS256", h.GetProperty("alg").GetString());
        Assert.Equal("JWT", h.GetProperty("typ").GetString());

        var p = Decode(payload);
        var unix = new DateTimeOffset(now).ToUnixTimeSeconds();
        Assert.Equal(AppId, p.GetProperty("iss").GetString());
        Assert.InRange(p.GetProperty("iat").GetInt64(), unix - 60 - 2, unix - 60 + 2);
        Assert.Equal(p.GetProperty("iat").GetInt64() + 600, p.GetProperty("exp").GetInt64());

        // Only the public half verifies it: the signature is the app's, not something anyone could make.
        using var publicKey = RSA.Create();
        publicKey.ImportRSAPublicKey(rsa.ExportRSAPublicKey(), out _);
        var signed = Encoding.ASCII.GetBytes($"{header}.{payload}");
        Assert.True(publicKey.VerifyData(signed, Bytes(signature), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
    }

    [Fact]
    public void A_key_with_escaped_line_breaks_is_read_the_same_way()
    {
        using var rsa = RSA.Create(2048);
        var escaped = Pem(rsa).Replace("\n", "\\n");
        var jwt = new AppGitHubAuth(new HttpClient(new ConnectorKit.FakeProvider()), AppId, escaped, InstallationId).CreateJwt(DateTime.UtcNow);
        Assert.Equal(3, jwt.Split('.').Length);
    }

    [Fact]
    public void A_key_that_is_not_a_pem_fails_without_showing_it()
    {
        const string junk = "NOT-A-KEY-MATERIAL-XYZ";
        var auth = new AppGitHubAuth(new HttpClient(new ConnectorKit.FakeProvider()), AppId, junk, InstallationId);
        var error = Assert.Throws<InvalidOperationException>(() => auth.CreateJwt(DateTime.UtcNow));
        Assert.DoesNotContain(junk, error.Message);
    }

    [Fact]
    public async Task The_installation_token_is_bought_once_and_kept_until_near_its_end()
    {
        using var rsa = RSA.Create(2048);
        var provider = new ConnectorKit.FakeProvider()
            .On($"/app/installations/{InstallationId}/access_tokens",
                $"{{\"token\":\"{InstallationToken}\",\"expires_at\":\"{FutureInstant(TimeSpan.FromHours(1))}\"}}");
        var auth = new AppGitHubAuth(new HttpClient(provider), AppId, Pem(rsa), InstallationId);

        Assert.Equal(InstallationToken, await auth.TokenAsync(CancellationToken.None));
        Assert.Equal(InstallationToken, await auth.TokenAsync(CancellationToken.None));

        var request = Assert.Single(provider.Requests);
        Assert.Equal($"https://api.github.com/app/installations/{InstallationId}/access_tokens", request.Url);
        Assert.StartsWith("Bearer ", request.Authorization);
        // The app's JWT is what the token is bought with, never the installation token itself.
        Assert.NotEqual($"Bearer {InstallationToken}", request.Authorization);
        Assert.DoesNotContain(InstallationToken, request.Url);
    }

    [Fact]
    public async Task The_installation_token_is_bought_again_when_it_is_five_minutes_from_its_end()
    {
        using var rsa = RSA.Create(2048);
        var provider = new ConnectorKit.FakeProvider()
            .On($"/app/installations/{InstallationId}/access_tokens",
                $"{{\"token\":\"{InstallationToken}\",\"expires_at\":\"{FutureInstant(TimeSpan.FromMinutes(3))}\"}}");
        var auth = new AppGitHubAuth(new HttpClient(provider), AppId, Pem(rsa), InstallationId);

        await auth.TokenAsync(CancellationToken.None);
        await auth.TokenAsync(CancellationToken.None);
        Assert.Equal(2, provider.Requests.Count);
    }

    [Fact]
    public async Task The_app_lists_the_installation_repositories()
    {
        using var rsa = RSA.Create(2048);
        var provider = new ConnectorKit.FakeProvider()
            .On($"/app/installations/{InstallationId}/access_tokens",
                $"{{\"token\":\"{InstallationToken}\",\"expires_at\":\"{FutureInstant(TimeSpan.FromHours(1))}\"}}")
            .On("/installation/repositories", """
                {"total_count":2,"repositories":[
                  {"id":5001,"full_name":"Acme-Inc/Rockets","html_url":"https://github.example/acme-inc/rockets","private":true,"archived":false,"fork":false,"default_branch":"main"},
                  {"id":5002,"full_name":"acme-inc/old","html_url":"https://github.example/acme-inc/old","private":false,"archived":true,"fork":false,"default_branch":"main"}]}
                """);
        var auth = new AppGitHubAuth(new HttpClient(provider), AppId, Pem(rsa), InstallationId);

        var repos = await GitHubRepoList.FetchAsync(new HttpClient(provider), auth, CancellationToken.None);

        Assert.Equal(["5001", "5002"], repos.Select(r => r.Id).ToArray());
        Assert.Equal("acme-inc/rockets", repos[0].FullName);
        Assert.True(repos[0].Private);
        Assert.True(repos[1].Archived);
        Assert.Equal("main", repos[0].DefaultBranch);
        var listing = provider.Requests.Single(r => r.Url.Contains("/installation/repositories"));
        Assert.Equal($"Bearer {InstallationToken}", listing.Authorization);
    }

    [Fact]
    public void The_app_wins_over_the_personal_token_when_all_three_settings_are_there()
    {
        using var rsa = RSA.Create(2048);
        var http = new HttpClient(new ConnectorKit.FakeProvider());
        var both = Config(new Dictionary<string, string?>
        {
            ["Atlas:GitHub:Token"] = "ghp_personal_test",
            ["Atlas:GitHub:AppId"] = AppId,
            ["Atlas:GitHub:PrivateKey"] = Pem(rsa),
            ["Atlas:GitHub:InstallationId"] = InstallationId,
        });
        Assert.IsType<AppGitHubAuth>(AtlasConnectorsSetup.ChooseGitHubAuth(both, http));

        // A missing piece (no installation id) is not an App: the token stays.
        var partial = Config(new Dictionary<string, string?>
        {
            ["Atlas:GitHub:Token"] = "ghp_personal_test",
            ["Atlas:GitHub:AppId"] = AppId,
            ["Atlas:GitHub:PrivateKey"] = Pem(rsa),
        });
        Assert.IsType<PatGitHubAuth>(AtlasConnectorsSetup.ChooseGitHubAuth(partial, http));

        var none = AtlasConnectorsSetup.ChooseGitHubAuth(Config(new Dictionary<string, string?>()), http);
        Assert.IsType<PatGitHubAuth>(none);
        Assert.False(none.Configured);
    }

    private static IConfiguration Config(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
