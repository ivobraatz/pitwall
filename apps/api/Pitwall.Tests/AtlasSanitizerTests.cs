using System.Text.Json;
using Pitwall.Services.Atlas.Sync;

namespace Pitwall.Tests;

/// <summary>Every secret shape of contract 6 is taken out; ordinary text stays; secret files are never read.</summary>
public class AtlasSanitizerTests
{
    [Theory]
    // The provider keys are split in two: a whole example key in the source trips the secret scanners.
    [InlineData("AKIAABCDEFGHIJKLMNOP")]
    [InlineData("sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc")]
    [InlineData("sk_test_" + "4eC39HqLyjWDarjtT1zdp7dc")]
    [InlineData("rk_live_" + "4eC39HqLyjWDarjtT1zdp7dc")]
    [InlineData("sk-ant-api03-abcdefghijklmnop")]
    [InlineData("sk-abcdefghijklmnopqrstuvwxyz0123")]
    [InlineData("ghp_abcdefghijklmnopqrstuvwxyz0123456789")]
    [InlineData("gho_abcdefghijklmnopqrstuvwxyz0123456789")]
    [InlineData("ghs_abcdefghijklmnopqrstuvwxyz0123456789")]
    [InlineData("github_pat_11ABCDEFG0123456789_abcdef")]
    [InlineData("xoxb-1234-5678-abcdefghijk")]
    [InlineData("pwt_abc123def456")]
    [InlineData("pw_abcdefghijklmnop1234")]
    [InlineData("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123")]
    public void Known_token_shapes_are_redacted(string secret)
    {
        var text = $"deploy usou {secret} ontem";

        var redacted = AtlasSanitizer.Redact(text);

        Assert.DoesNotContain(secret, redacted);
        Assert.Contains("[removido]", redacted);
        Assert.StartsWith("deploy usou ", redacted);
    }

    [Fact]
    public void Private_key_block_is_redacted_whole()
    {
        const string pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKabcdef\n-----END RSA PRIVATE KEY-----";

        var redacted = AtlasSanitizer.Redact($"chave:\n{pem}\nfim");

        Assert.DoesNotContain("MIIBOgIBAAJBAKabcdef", redacted);
        Assert.DoesNotContain("PRIVATE KEY", redacted);
        Assert.Contains("fim", redacted);
    }

    [Fact]
    public void Credentials_inside_a_url_keep_scheme_and_host_only()
    {
        var redacted = AtlasSanitizer.Redact("conexão postgres://app:s3cr3tpass@db.acme.example:5432/loja");

        Assert.Equal("conexão postgres://[removido]@db.acme.example:5432/loja", redacted);
    }

    [Theory]
    [InlineData("password=hunter2hunter2", "password=[removido]")]
    [InlineData("api_key: abcdef123456", "api_key=[removido]")]
    [InlineData("token = \"abc123def456\"", "token=[removido]\"")]
    [InlineData("client_secret=zzzzzz999999", "client_secret=[removido]")]
    public void Assignments_of_secret_names_keep_the_name(string input, string expected)
    {
        Assert.Equal(expected, AtlasSanitizer.Redact(input));
    }

    [Fact]
    public void Long_hex_and_base64_after_equals_are_redacted()
    {
        const string hex = "0123456789abcdef0123456789abcdef01234567";
        const string b64 = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODk=";

        var redacted = AtlasSanitizer.Redact($"commit={hex} data={b64}");

        Assert.DoesNotContain(hex, redacted);
        Assert.DoesNotContain(b64, redacted);
    }

    [Theory]
    [InlineData("Ajuste no checkout: a página de preços foi reescrita e o token de acesso expirou em 2026.")]
    [InlineData("password reset page e secret santa do time, sem valor nenhum")]
    [InlineData("Commit 3f2a e versão 16.4.5 do Next.js; URL https://acme.example/docs/atlas")]
    [InlineData("Lista: stripe, resend, anthropic; rodou em 2026-11-11 às 10:00")]
    public void Ordinary_text_passes_unchanged(string text)
    {
        Assert.Equal(text, AtlasSanitizer.Redact(text));
    }

    [Theory]
    [InlineData(".env")]
    [InlineData(".env.local")]
    [InlineData("apps/web/.env.production")]
    [InlineData("config/id_rsa")]
    [InlineData("certs/x.pem")]
    [InlineData("certs/x.key")]
    [InlineData("secrets.json")]
    [InlineData("credentials.json")]
    [InlineData("deploy/app.pfx")]
    public void Secret_files_are_forbidden(string path)
    {
        Assert.True(AtlasSanitizer.IsForbiddenPath(path));
        Assert.False(AtlasSanitizer.IsAllowedPath(path));
    }

    [Theory]
    [InlineData(".env.example")]
    [InlineData("apps/web/.env.sample")]
    [InlineData("example.env")]
    public void Example_env_files_are_allowed_and_not_forbidden(string path)
    {
        Assert.False(AtlasSanitizer.IsForbiddenPath(path));
        Assert.Equal(AtlasSanitizer.PathKind.Content, AtlasSanitizer.Category(path));
    }

    [Theory]
    [InlineData("package.json", AtlasSanitizer.PathKind.Content)]
    [InlineData("apps/api/Pitwall.Api/Pitwall.Api.csproj", AtlasSanitizer.PathKind.Content)]
    [InlineData(".github/workflows/ci.yml", AtlasSanitizer.PathKind.Content)]
    [InlineData("robots.txt", AtlasSanitizer.PathKind.Content)]
    [InlineData("app/sitemap.ts", AtlasSanitizer.PathKind.Presence)]
    [InlineData("package-lock.json", AtlasSanitizer.PathKind.Presence)]
    [InlineData("node_modules/left-pad/package.json", AtlasSanitizer.PathKind.None)]
    [InlineData("a/b/c/d/e/package.json", AtlasSanitizer.PathKind.None)]
    [InlineData("src/readme.md", AtlasSanitizer.PathKind.None)]
    [InlineData("../package.json", AtlasSanitizer.PathKind.None)]
    public void Whitelist_decides_what_is_read(string path, AtlasSanitizer.PathKind expected)
    {
        Assert.Equal(expected, AtlasSanitizer.Category(path));
    }

    [Fact]
    public void Example_env_keeps_only_variable_names_and_comments()
    {
        const string raw = """
            # Pagamentos
            STRIPE_SECRET_KEY=sk_live_abc123def456ghi789
            export DATABASE_URL="postgres://app:s3cr3t@db.acme.example/loja"
            NEXT_PUBLIC_GA_ID=G-123456
            texto solto que não é variável
            """;

        var result = AtlasSanitizer.Transform(".env.example", raw);

        Assert.False(result.Dropped);
        var lines = result.Content!.Split('\n');
        Assert.Equal(["# Pagamentos", "STRIPE_SECRET_KEY=", "DATABASE_URL=", "NEXT_PUBLIC_GA_ID="], lines);
        Assert.DoesNotContain("sk_live", result.Content);
        Assert.DoesNotContain("s3cr3t", result.Content);
        Assert.DoesNotContain("G-123456", result.Content);
    }

    [Fact]
    public void Appsettings_keep_structure_and_lose_every_leaf_value()
    {
        const string raw = """
            {
              "ConnectionStrings": { "Pitwall": "Host=db;Password=abc123456" },
              "Port": 5000,
              "Debug": true,
              "Hosts": ["acme.example", 7]
            }
            """;

        var result = AtlasSanitizer.Transform("appsettings.Production.json", raw);

        Assert.False(result.Dropped);
        using var doc = JsonDocument.Parse(result.Content!);
        var root = doc.RootElement;
        Assert.Equal("", root.GetProperty("ConnectionStrings").GetProperty("Pitwall").GetString());
        Assert.Equal("", root.GetProperty("Port").GetString());
        Assert.Equal("", root.GetProperty("Debug").GetString());
        Assert.Equal(["", ""], root.GetProperty("Hosts").EnumerateArray().Select(e => e.GetString()!).ToArray());
        Assert.DoesNotContain("abc123456", result.Content);
        Assert.DoesNotContain("acme.example", result.Content);
    }

    [Fact]
    public void Invalid_json_is_dropped_not_kept()
    {
        var result = AtlasSanitizer.Transform("appsettings.json", "{\"ConnectionStrings\": {");

        Assert.Null(result.Content);
        Assert.True(result.Dropped);
    }

    [Fact]
    public void Presence_only_files_keep_no_content()
    {
        var result = AtlasSanitizer.Transform("pnpm-lock.yaml", "lockfileVersion: 9");

        Assert.Null(result.Content);
        Assert.False(result.Dropped);
    }
}
