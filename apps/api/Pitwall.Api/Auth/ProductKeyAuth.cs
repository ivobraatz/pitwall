using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Pitwall.Data;

namespace Pitwall.Auth;

/// <summary>
/// Authenticates a product's backend (or its CI) by its API key: <c>Authorization: Bearer pw_…</c>.
/// The key names the product and its scopes; nothing a caller sends can widen either. Lookups
/// are cached for a minute — a revoked key stops working within that minute.
/// </summary>
public sealed class ProductKeyAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    PitwallDb db,
    IMemoryCache cache) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Scheme = "ProductKey";
    public const string ProductClaim = "pw:product";
    public const string ScopeClaim = "pw:scope";
    private static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(1);

    private sealed record CachedKey(Guid KeyId, Guid ProductId, string[] Scopes);

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer pw_", StringComparison.Ordinal)) return AuthenticateResult.NoResult();
        var token = header["Bearer ".Length..].Trim();
        var hash = Tokens.Hash(token);

        if (!cache.TryGetValue(hash, out CachedKey? found))
        {
            found = await db.ProductKeys.AsNoTracking()
                .Where(k => k.Hash == hash && k.RevokedAt == null && k.Product.DisabledAt == null)
                .Select(k => new CachedKey(k.Id, k.ProductId, k.Scopes))
                .FirstOrDefaultAsync(Context.RequestAborted);
            cache.Set(hash, found, CacheFor);
            if (found is not null)
            {
                // Best effort, at most once per cache window per key: when it was last seen is a
                // hint for the team ("is this key still in use?"), not an audit trail.
                await db.ProductKeys.Where(k => k.Id == found.KeyId)
                    .ExecuteUpdateAsync(s => s.SetProperty(k => k.LastUsedAt, DateTime.UtcNow), Context.RequestAborted);
            }
        }
        if (found is null) return AuthenticateResult.Fail("Unknown or revoked key.");

        var claims = new List<Claim> { new(ProductClaim, found.ProductId.ToString()) };
        claims.AddRange(found.Scopes.Select(s => new Claim(ScopeClaim, s)));
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Response.WriteAsJsonAsync(new { message = "A valid product key is required." });
    }

    protected override Task HandleForbiddenAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status403Forbidden;
        return Response.WriteAsJsonAsync(new { message = "This key does not have the scope this endpoint needs." });
    }
}

public static class ProductContext
{
    public static Guid ProductId(this HttpContext http) =>
        Guid.Parse(http.User.FindFirst(ProductKeyAuthHandler.ProductClaim)!.Value);
}
