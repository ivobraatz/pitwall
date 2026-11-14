using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Pitwall.Auth;
using static Pitwall.Tests.TeamTaskKit;

namespace Pitwall.Tests;

/// <summary>
/// Personal tokens: shown once, stored as a hash, good for what their scopes say and nothing else,
/// scopes changed only from the owner's console session, and dead the moment they are revoked,
/// expire, or their owner is disabled.
/// </summary>
public class StaffTokenTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private async Task<(HttpClient Session, Guid StaffId, string Token, Guid TokenId)> SessionAndTokenAsync(string name = "Ana")
    {
        var (session, staff) = await SignInAsync(fx, name);
        var res = await session.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "Claude Code no notebook", expiresInDays = 90 });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var body = await res.Json();
        return (session, staff.Id, body.GetProperty("token").GetString()!, body.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Create_token_returns_plaintext_once_and_stores_hash()
    {
        var (session, staff) = await SignInAsync(fx);
        var res = await session.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "notebook", expiresInDays = 30 });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var body = await res.Json();
        var token = body.GetProperty("token").GetString()!;
        Assert.StartsWith("pwt_", token);
        Assert.Equal(token[..12], body.GetProperty("prefix").GetString());
        Assert.Equal(["tasks"], body.GetProperty("scopes").EnumerateArray().Select(s => s.GetString()));
        Assert.InRange(body.GetProperty("expiresAt").GetDateTime(), DateTime.UtcNow.AddDays(29), DateTime.UtcNow.AddDays(31));

        await WithDbAsync(fx, async db =>
        {
            var row = await db.StaffTokens.SingleAsync(t => t.StaffUserId == staff.Id);
            Assert.Equal(Tokens.Hash(token), row.Hash);
            Assert.DoesNotContain(token, row.Hash + row.Prefix + row.Name);
        });

        Assert.Equal(HttpStatusCode.BadRequest, (await session.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await session.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "x", expiresInDays = 7 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await session.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "x", scopes = new[] { "tickets" } })).StatusCode);
    }

    [Fact]
    public async Task Token_expires_in_90_days_unless_told_otherwise()
    {
        var (session, _) = await SignInAsync(fx);
        var omitted = await (await session.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "padrão" })).Json();
        Assert.InRange(omitted.GetProperty("expiresAt").GetDateTime(), DateTime.UtcNow.AddDays(89), DateTime.UtcNow.AddDays(91));

        var never = await session.PostAsync("/v1/staff/me/tokens",
            JsonContent.Create(System.Text.Json.JsonDocument.Parse("""{"name":"sem expiração","expiresInDays":null}""").RootElement));
        Assert.Equal(HttpStatusCode.Created, never.StatusCode);
        Assert.Equal(System.Text.Json.JsonValueKind.Null, (await never.Json()).GetProperty("expiresAt").ValueKind);

        var year = await (await session.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "um ano", expiresInDays = 365 })).Json();
        Assert.InRange(year.GetProperty("expiresAt").GetDateTime(), DateTime.UtcNow.AddDays(364), DateTime.UtcNow.AddDays(366));
        Assert.Equal(HttpStatusCode.BadRequest, (await session.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "x", expiresInDays = "90" })).StatusCode);
    }

    [Fact]
    public async Task List_tokens_never_returns_plaintext()
    {
        var (session, _, token, tokenId) = await SessionAndTokenAsync();
        var raw = await session.GetStringAsync("/v1/staff/me/tokens");
        Assert.DoesNotContain(token, raw);
        Assert.Contains(tokenId.ToString(), raw);
        Assert.Contains(token[..12], raw);
    }

    [Fact]
    public async Task Token_with_tasks_scope_reaches_tasks_routes()
    {
        var (_, _, token, _) = await SessionAndTokenAsync();
        var mcp = TokenClient(fx, token);
        Assert.Equal(HttpStatusCode.OK, (await mcp.GetAsync("/v1/staff/tasks/board")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await mcp.GetAsync("/v1/staff/tasks")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await mcp.GetAsync("/v1/staff/tasks/meta")).StatusCode);
    }

    [Fact]
    public async Task Token_without_tasks_scope_gets_403()
    {
        var staff = await SeedStaffAsync(fx);
        var (token, _) = await SeedTokenAsync(fx, staff.Id, scopes: []);
        var res = await TokenClient(fx, token).GetAsync("/v1/staff/tasks/board");
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Contains("escopo tasks", (await res.Json()).GetProperty("message").GetString());
    }

    [Fact]
    public async Task Token_create_sets_source_claude_and_name_suffix()
    {
        var (_, staffId, token, tokenId) = await SessionAndTokenAsync("Bia");
        var task = await CreateTaskAsync(TokenClient(fx, token), new { title = "Configurar webhook no painel" });
        Assert.Equal("claude", task.GetProperty("source").GetString());
        Assert.Equal("Bia (Claude)", task.GetProperty("createdBy").GetProperty("name").GetString());
        Assert.Equal(staffId.ToString(), task.GetProperty("createdBy").GetProperty("ref").GetString());

        // Used once: the owner sees when.
        await WithDbAsync(fx, async db => Assert.NotNull((await db.StaffTokens.SingleAsync(t => t.Id == tokenId)).LastUsedAt));
    }

    [Fact]
    public async Task Token_cannot_reach_tickets_or_products()
    {
        var (_, _, token, _) = await SessionAndTokenAsync();
        var mcp = TokenClient(fx, token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await mcp.GetAsync("/v1/staff/tickets")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await mcp.GetAsync("/v1/staff/products")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await mcp.GetAsync("/v1/staff/team")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await mcp.GetAsync("/v1/staff/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Token_cannot_create_tokens()
    {
        var (_, _, token, _) = await SessionAndTokenAsync();
        var mcp = TokenClient(fx, token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await mcp.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "outro" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await mcp.GetAsync("/v1/staff/me/tokens")).StatusCode);
    }

    [Fact]
    public async Task Revoked_token_returns_401()
    {
        var (session, _, token, tokenId) = await SessionAndTokenAsync();
        var mcp = TokenClient(fx, token);
        Assert.Equal(HttpStatusCode.OK, (await mcp.GetAsync("/v1/staff/tasks/board")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await session.DeleteAsync($"/v1/staff/me/tokens/{tokenId}")).StatusCode);
        // Immediately: the revocation clears the cached lookup.
        var res = await mcp.GetAsync("/v1/staff/tasks/board");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Contains("Tokens pessoais", (await res.Json()).GetProperty("message").GetString());
    }

    [Fact]
    public async Task Expired_token_returns_401()
    {
        var staff = await SeedStaffAsync(fx);
        var (token, _) = await SeedTokenAsync(fx, staff.Id, expiresAt: DateTime.UtcNow.AddMinutes(-1));
        Assert.Equal(HttpStatusCode.Unauthorized, (await TokenClient(fx, token).GetAsync("/v1/staff/tasks/board")).StatusCode);
    }

    [Fact]
    public async Task Token_of_inactive_staff_returns_401()
    {
        var staff = await SeedStaffAsync(fx, disabled: true);
        var (token, _) = await SeedTokenAsync(fx, staff.Id);
        Assert.Equal(HttpStatusCode.Unauthorized, (await TokenClient(fx, token).GetAsync("/v1/staff/tasks/board")).StatusCode);
    }

    [Fact]
    public async Task Token_write_does_not_need_csrf_header()
    {
        var (_, _, token, _) = await SessionAndTokenAsync();
        var mcp = TokenClient(fx, token);
        Assert.False(mcp.DefaultRequestHeaders.Contains(StaffSessionAuthHandler.CsrfHeader));
        var res = await mcp.PostAsJsonAsync("/v1/staff/tasks", new { title = "Testar login no celular" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }

    [Fact]
    public async Task Bearer_wins_over_a_cookie_without_csrf_header()
    {
        // A session cookie without the console header would fail the request on its own; with a
        // token beside it, the token decides.
        var (session, staff) = await SignInAsync(fx, csrf: false);
        var (token, _) = await SeedTokenAsync(fx, staff.Id);
        session.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var res = await session.PostAsJsonAsync("/v1/staff/tasks", new { title = "Cookie e token juntos" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.Equal("claude", (await res.Json()).GetProperty("source").GetString());
    }

    [Fact]
    public async Task Session_write_without_csrf_header_still_fails()
    {
        var (session, _) = await SignInAsync(fx, csrf: false);
        Assert.Equal(HttpStatusCode.OK, (await session.GetAsync("/v1/staff/tasks/board")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await session.PostAsJsonAsync("/v1/staff/tasks", new { title = "Sem cabeçalho" })).StatusCode);
    }

    [Fact]
    public async Task Token_limit_returns_409()
    {
        var (session, staff) = await SignInAsync(fx);
        for (var i = 0; i < 10; i++) await SeedTokenAsync(fx, staff.Id);
        // Revoked and expired ones do not count against the limit — but these ten do.
        await SeedTokenAsync(fx, staff.Id, revokedAt: DateTime.UtcNow);
        var res = await session.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "o décimo primeiro" });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task Scopes_change_in_place_and_count_at_once()
    {
        var (session, _, token, tokenId) = await SessionAndTokenAsync();
        var mcp = TokenClient(fx, token);
        Assert.Equal(HttpStatusCode.Forbidden, (await mcp.GetAsync("/v1/staff/atlas")).StatusCode);

        var res = await session.PatchAsJsonAsync($"/v1/staff/me/tokens/{tokenId}", new { scopes = new[] { "atlas", "tasks", "atlas" } });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(["tasks", "atlas"], (await res.Json()).GetProperty("scopes").EnumerateArray().Select(s => s.GetString()));
        // Immediately, with the same token: the change clears the cached lookup.
        Assert.Equal(HttpStatusCode.OK, (await mcp.GetAsync("/v1/staff/atlas")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await mcp.GetAsync("/v1/staff/tasks/board")).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await session.PatchAsJsonAsync($"/v1/staff/me/tokens/{tokenId}", new { scopes = new[] { "atlas" } })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await mcp.GetAsync("/v1/staff/tasks/board")).StatusCode);
    }

    [Fact]
    public async Task Scopes_need_one_known_scope_and_a_live_token()
    {
        var (session, _, _, tokenId) = await SessionAndTokenAsync();
        var url = $"/v1/staff/me/tokens/{tokenId}";
        Assert.Equal(HttpStatusCode.BadRequest, (await session.PatchAsJsonAsync(url, new { scopes = Array.Empty<string>() })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await session.PatchAsJsonAsync(url, new { scopes = new[] { "tickets" } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await session.PatchAsJsonAsync(url, new { })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await session.PatchAsJsonAsync($"/v1/staff/me/tokens/{Guid.NewGuid()}", new { scopes = new[] { "tasks" } })).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await session.DeleteAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await session.PatchAsJsonAsync(url, new { scopes = new[] { "tasks", "atlas" } })).StatusCode);
    }

    [Fact]
    public async Task Token_cannot_change_scopes()
    {
        var (_, _, token, tokenId) = await SessionAndTokenAsync();
        var mcp = TokenClient(fx, token);
        var res = await mcp.PatchAsJsonAsync($"/v1/staff/me/tokens/{tokenId}", new { scopes = new[] { "tasks", "atlas", "errors" } });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await mcp.GetAsync("/v1/staff/atlas")).StatusCode);
    }

    [Fact]
    public async Task Cannot_change_other_staff_token_scopes()
    {
        var (_, _, token, tokenId) = await SessionAndTokenAsync("Ana");
        var (other, _) = await SignInAsync(fx, "Bia");
        Assert.Equal(HttpStatusCode.NotFound, (await other.PatchAsJsonAsync($"/v1/staff/me/tokens/{tokenId}", new { scopes = new[] { "atlas" } })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await TokenClient(fx, token).GetAsync("/v1/staff/tasks/board")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await TokenClient(fx, token).GetAsync("/v1/staff/atlas")).StatusCode);
    }

    [Fact]
    public async Task Cannot_revoke_other_staff_token()
    {
        var (_, _, token, tokenId) = await SessionAndTokenAsync("Ana");
        var (other, _) = await SignInAsync(fx, "Bia");
        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"/v1/staff/me/tokens/{tokenId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await TokenClient(fx, token).GetAsync("/v1/staff/tasks/board")).StatusCode);
        var list = await (await other.GetAsync("/v1/staff/me/tokens")).Json();
        Assert.Equal(0, list.GetArrayLength());
    }
}
