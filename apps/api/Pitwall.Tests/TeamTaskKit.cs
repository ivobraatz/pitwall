using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Tests;

/// <summary>
/// People, sessions and tokens for the board's tests. Every client comes from its own address
/// (X-Forwarded-For): signing in and creating tokens share the per-address "login" limit.
/// </summary>
internal static class TeamTaskKit
{
    private static int _address;

    public static HttpClient NewClient(PitwallFixture fx)
    {
        var client = fx.Factory.CreateClient();
        var n = Interlocked.Increment(ref _address);
        client.DefaultRequestHeaders.Add("X-Forwarded-For", $"10.{(n >> 16) & 255}.{(n >> 8) & 255}.{n & 255}");
        return client;
    }

    public static async Task<StaffUser> SeedStaffAsync(PitwallFixture fx, string name = "Ana", string role = StaffRoles.Agent, bool disabled = false)
    {
        var staff = new StaffUser
        {
            Id = Guid.NewGuid(), Email = $"staff-{Guid.NewGuid():N}@pitwall.test", Name = name, Role = role,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("senha-de-teste", 4), CreatedAt = DateTime.UtcNow,
            DisabledAt = disabled ? DateTime.UtcNow : null,
        };
        using var scope = fx.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        db.Staff.Add(staff);
        await db.SaveChangesAsync();
        return staff;
    }

    /// <summary>A console session, with the CSRF header unless <paramref name="csrf"/> is false.</summary>
    public static async Task<(HttpClient Client, StaffUser Staff)> SignInAsync(PitwallFixture fx, string name = "Ana", bool csrf = true)
    {
        var staff = await SeedStaffAsync(fx, name);
        var client = NewClient(fx);
        using (var login = new HttpRequestMessage(HttpMethod.Post, "/v1/staff/auth/login"))
        {
            login.Headers.Add(StaffSessionAuthHandler.CsrfHeader, "1");
            login.Content = JsonContent.Create(new { email = staff.Email, password = "senha-de-teste" });
            var res = await client.SendAsync(login);
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        }
        if (csrf) client.DefaultRequestHeaders.Add(StaffSessionAuthHandler.CsrfHeader, "1");
        return (client, staff);
    }

    /// <summary>A token straight into the database (for the states the API would not create: expired, scope-less).</summary>
    public static async Task<(string Token, Guid Id)> SeedTokenAsync(
        PitwallFixture fx, Guid staffId, string[]? scopes = null, DateTime? expiresAt = null, DateTime? revokedAt = null)
    {
        var token = Tokens.NewStaffToken();
        var row = new StaffToken
        {
            Id = Guid.NewGuid(), StaffUserId = staffId, Name = "teste", Prefix = token[..12], Hash = Tokens.Hash(token),
            Scopes = scopes ?? [StaffTokenScopes.Tasks], CreatedAt = DateTime.UtcNow, ExpiresAt = expiresAt, RevokedAt = revokedAt,
        };
        using var scope = fx.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        db.StaffTokens.Add(row);
        await db.SaveChangesAsync();
        return (token, row.Id);
    }

    /// <summary>What the MCP holds: a bearer token and no cookie, no console header.</summary>
    public static HttpClient TokenClient(PitwallFixture fx, string token)
    {
        var client = NewClient(fx);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    public static async Task<JsonElement> CreateTaskAsync(HttpClient client, object body)
    {
        var res = await client.PostAsJsonAsync("/v1/staff/tasks", body);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    public static async Task<JsonElement> Json(this HttpResponseMessage res) => await res.Content.ReadFromJsonAsync<JsonElement>();

    public static async Task WithDbAsync(PitwallFixture fx, Func<PitwallDb, Task> act)
    {
        using var scope = fx.Factory.Services.CreateScope();
        await act(scope.ServiceProvider.GetRequiredService<PitwallDb>());
    }
}
