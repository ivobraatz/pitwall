using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Pitwall.Data;

namespace Pitwall.Auth;

/// <summary>
/// Authenticates a tool acting for someone on the team (the Pitwall MCP) by that person's token:
/// <c>Authorization: Bearer pwt_…</c>. The principal carries the same claims as a console session,
/// so the endpoints read who it is the same way, plus the token id and its scopes.
///
/// No CSRF header is asked for: a browser never attaches a bearer token on its own, so a foreign
/// page cannot make one ride along. Lookups are cached for a minute; revoking a token clears its
/// entry at once, disabling its owner takes effect within that minute.
/// </summary>
public sealed class StaffTokenAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    PitwallDb db,
    IMemoryCache cache) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Scheme = "StaffToken";
    /// <summary>
    /// The scheme the task routes use: the bearer token when the request carries one, the console
    /// session otherwise. A request with both is the token's — its cookie is ignored there.
    /// </summary>
    public const string SessionOrToken = "StaffSessionOrToken";
    public const string TokenClaim = "pw:token";
    public const string BearerPrefix = "Bearer pwt_";
    private static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(1);

    private sealed record CachedToken(Guid TokenId, Guid StaffId, string Name, string Email, string Role, string[] Scopes, DateTime? ExpiresAt);

    public static string CacheKey(string hash) => "staff-token:" + hash;

    public static bool Carries(HttpContext http) =>
        http.Request.Headers.Authorization.ToString().StartsWith(BearerPrefix, StringComparison.Ordinal);

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Carries(Context)) return AuthenticateResult.NoResult();
        var token = Request.Headers.Authorization.ToString()["Bearer ".Length..].Trim();
        var key = CacheKey(Tokens.Hash(token));

        if (!cache.TryGetValue(key, out CachedToken? found))
        {
            var hash = Tokens.Hash(token);
            found = await db.StaffTokens.AsNoTracking()
                .Where(t => t.Hash == hash && t.RevokedAt == null && t.StaffUser.DisabledAt == null)
                .Select(t => new CachedToken(t.Id, t.StaffUserId, t.StaffUser.Name, t.StaffUser.Email, t.StaffUser.Role, t.Scopes, t.ExpiresAt))
                .FirstOrDefaultAsync(Context.RequestAborted);
            cache.Set(key, found, CacheFor);
            if (found is not null)
            {
                // At most once per cache window per token: a hint for its owner, not an audit trail.
                await db.StaffTokens.Where(t => t.Id == found.TokenId)
                    .ExecuteUpdateAsync(s => s.SetProperty(t => t.LastUsedAt, DateTime.UtcNow), Context.RequestAborted);
            }
        }
        if (found is null) return AuthenticateResult.Fail("Unknown or revoked token.");
        if (found.ExpiresAt is { } expires && expires <= DateTime.UtcNow) return AuthenticateResult.Fail("Expired token.");

        var claims = new List<Claim>
        {
            new(StaffSessionAuthHandler.StaffClaim, found.StaffId.ToString()),
            new(ClaimTypes.Name, found.Name),
            new(ClaimTypes.Email, found.Email),
            new(ClaimTypes.Role, found.Role),
            new(TokenClaim, found.TokenId.ToString()),
        };
        claims.AddRange(found.Scopes.Select(s => new Claim(ProductKeyAuthHandler.ScopeClaim, s)));
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)), Scheme));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Response.WriteAsJsonAsync(new { message = "Token inválido, expirado ou revogado. Gere outro em Configurações → Tokens pessoais." });
    }

    protected override Task HandleForbiddenAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status403Forbidden;
        var scope = Request.Path.StartsWithSegments("/v1/staff/atlas") ? "atlas"
            : Request.Path.StartsWithSegments("/v1/staff/errors") ? "errors" : "tasks";
        return Response.WriteAsJsonAsync(new { message = $"O token não tem o escopo {scope}. Gere outro em Configurações → Tokens pessoais." });
    }
}
