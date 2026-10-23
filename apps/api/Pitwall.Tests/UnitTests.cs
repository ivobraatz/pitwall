using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.FileProviders;
using Pitwall.Auth;
using Pitwall.Domain;
using Pitwall.Services;
using Pitwall.Services.Errors;
using Pitwall.Services.Releases;
using Pitwall.Services.Webhooks;

namespace Pitwall.Tests;

public class ErrorSignatureTests
{
    private static readonly string[] DotnetPrefixes = ["DataRunner."];

    [Fact]
    public void Same_bug_on_another_line_keeps_its_signature()
    {
        var a = ErrorSignature.Compute("System.InvalidOperationException", "/api/v1/reports/{id}/run",
            "at System.Linq.Enumerable.First()\n   at DataRunner.Reports.Runner.Run(Int32 id) in /src/Runner.cs:line 42", DotnetPrefixes);
        var b = ErrorSignature.Compute("System.InvalidOperationException", "/api/v1/reports/{id}/run",
            "at System.Linq.Enumerable.First()\n   at DataRunner.Reports.Runner.Run(Int32 id) in /src/Runner.cs:line 57", DotnetPrefixes);
        Assert.Equal(a, b);
    }

    [Fact]
    public void Different_own_frame_is_a_different_bug()
    {
        var a = ErrorSignature.Compute("X", "/r", "at Lib.F()\n at DataRunner.A.B()", DotnetPrefixes);
        var b = ErrorSignature.Compute("X", "/r", "at Lib.F()\n at DataRunner.A.C()", DotnetPrefixes);
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void Node_frames_drop_line_and_column()
    {
        var frame = ErrorSignature.FirstOwnFrame(
            "TypeError: x is undefined\n    at Object.parse (node:internal/x:1:1)\n    at runFlow (/app/apps/api/src/routes/flows.ts:120:15)",
            ["/apps/api/src/"]);
        Assert.Equal("runFlow (/app/apps/api/src/routes/flows.ts)", frame);
    }

    [Theory]
    [InlineData("/api/reports/42/run", "/api/reports/:id/run")]
    [InlineData("/api/t/3f2504e0-4f89-11d3-9a0c-0305e82c3301?x=1", "/api/t/:id")]
    [InlineData("/api/reports", "/api/reports")]
    public void Raw_paths_lose_their_ids(string path, string expected) =>
        Assert.Equal(expected, ErrorSignature.NormalizeRoute(path));
}

public class TicketCodeTests
{
    [Fact]
    public void Codes_read_as_a_date_and_avoid_ambiguous_letters()
    {
        var code = TicketCodes.New(new DateTime(2026, 10, 16));
        Assert.Matches(@"^20261016-[0-9A-HJKMNP-TV-Z]{4}$", code);
    }

    [Fact]
    public void Codes_are_found_in_commit_messages()
    {
        var found = TicketCodes.FindIn("fix(reports): handle empty runs (20261016-7k3q, 20261017-ABCD)").ToList();
        Assert.Equal(["20261016-7K3Q", "20261017-ABCD"], found);
        Assert.Empty(TicketCodes.FindIn("bump version to 20261016-1"));
    }
}

public class WebhookSignerTests
{
    [Fact]
    public void Signature_covers_timestamp_and_body()
    {
        var sig = WebhookSigner.Sign("secret", 1_700_000_000, "{\"a\":1}");
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes("secret"));
        var expected = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes("1700000000.{\"a\":1}"))).ToLowerInvariant();
        Assert.Equal($"t=1700000000,v1={expected}", sig);
    }
}

public class ActorTests
{
    [Fact]
    public void Round_trips_accented_names()
    {
        var actor = new Actor("ws-1", "Padaria São João", "u-9", "Conceição Araújo", null);
        var http = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        http.Request.Headers[Actor.Header] = Actor.Encode(actor);
        Assert.Equal(actor, Actor.From(http));
    }

    [Fact]
    public void Missing_customer_is_no_actor()
    {
        var http = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        http.Request.Headers[Actor.Header] = Actor.Encode(new Actor(" ", null, "u", null, null));
        Assert.Null(Actor.From(http));
        http.Request.Headers[Actor.Header] = "not base64 !!";
        Assert.Null(Actor.From(http));
    }
}

public class SecretsTests
{
    private sealed class Env : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Production";
        public string ApplicationName { get; set; } = "t";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    [Fact]
    public void Seals_and_opens()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Pitwall:SecretKey"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }).Build();
        var secrets = new Secrets(config, new Env());
        var sealedValue = secrets.Seal("pwhs_abc");
        Assert.NotEqual("pwhs_abc", sealedValue);
        Assert.Equal("pwhs_abc", secrets.Open(sealedValue));
    }

    [Fact]
    public void Production_without_a_key_refuses_to_start() =>
        Assert.Throws<InvalidOperationException>(() => new Secrets(new ConfigurationBuilder().Build(), new Env()));
}

public class ReleaseWriterTests
{
    private static readonly string[] Locales = ["pt", "en"];

    [Fact]
    public void Parses_and_holds_the_shape()
    {
        var reply = """
            {"publish": true,
             "pt": {"title": "Relatórios mais rápidos.", "summary": "Rode relatórios grandes.", "new": ["**Agendar** `cron` diário", ""], "improvements": []},
             "en": {"title": "Faster reports", "summary": "Run big reports.", "new": ["**Schedule** daily"], "improvements": []}}
            """;
        var draft = ReleaseWriter.Parse(reply, Locales)!;
        Assert.True(draft.Publish);
        Assert.Equal("Relatórios mais rápidos", draft.Notes["pt"].Title);
        Assert.Equal(["**Agendar** cron diário"], draft.Notes["pt"].New);
    }

    [Fact]
    public void Nothing_to_publish_is_not_a_failure()
    {
        var draft = ReleaseWriter.Parse("""{"publish": false}""", Locales)!;
        Assert.False(draft.Publish);
    }

    [Fact]
    public void Schema_requires_every_locale() =>
        Assert.Equal("[\"publish\",\"pt\",\"en\"]", ReleaseWriter.Schema(Locales)["required"].GetRawText());

    [Fact]
    public void Markdown_uses_the_locale_headings()
    {
        var md = ReleaseWriter.Markdown(new NoteText("t", "s", ["a"], ["b"]), "pt");
        Assert.Equal("### Novo\n\n- a\n\n### Melhorias\n\n- b\n", md);
    }

    [Fact]
    public void Prompt_names_the_product_and_languages()
    {
        var product = new Product { Name = "RH Flex", Description = "HR for small companies.", Settings = new() };
        var prompt = ReleaseWriter.SystemPrompt(product, Locales);
        Assert.Contains("RH Flex: HR for small companies.", prompt);
        Assert.Contains("Brazilian Portuguese and English", prompt);
    }
}

public class TicketStatusTests
{
    [Fact]
    public void Status_keeps_its_stamps_true()
    {
        var t = new Ticket();
        var now = DateTime.UtcNow;
        t.ApplyStatus(TicketStatuses.Closed, now);
        Assert.Equal(now, t.ResolvedAt);
        Assert.Equal(now, t.ClosedAt);
        t.ApplyStatus(TicketStatuses.Open, now);
        Assert.Null(t.ResolvedAt);
        Assert.Null(t.ClosedAt);
    }
}
