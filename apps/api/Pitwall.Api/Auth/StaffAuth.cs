using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Auth;

/// <summary>
/// The team's console session: an opaque random cookie, of which only the hash is stored.
///
/// Cross-site requests are refused twice over: the cookie is <c>SameSite=Strict</c>, and every
/// state-changing request must also carry <c>X-Pitwall-Staff: 1</c> — a header a foreign page
/// cannot add without a CORS preflight this API never grants.
/// </summary>
public sealed class StaffSessionAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    PitwallDb db) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Scheme = "StaffSession";
    public const string Cookie = "pw_session";
    public const string CsrfHeader = "X-Pitwall-Staff";
    public const string StaffClaim = "pw:staff";

    /// <summary>A session unused this long is over.</summary>
    public static readonly TimeSpan IdleTimeout = TimeSpan.FromHours(12);
    /// <summary>And none lives longer than this, used or not.</summary>
    public static readonly TimeSpan AbsoluteLifetime = TimeSpan.FromDays(7);

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Cookies.TryGetValue(Cookie, out var token) || string.IsNullOrWhiteSpace(token))
            return AuthenticateResult.NoResult();
        if (!HttpMethods.IsGet(Request.Method) && !HttpMethods.IsHead(Request.Method)
            && Request.Headers[CsrfHeader] != "1")
            return AuthenticateResult.Fail("Missing the console header.");

        var hash = Tokens.Hash(token);
        var now = DateTime.UtcNow;
        var session = await db.StaffSessions
            .Include(s => s.Staff)
            .FirstOrDefaultAsync(s => s.TokenHash == hash, Context.RequestAborted);
        if (session is null || session.ExpiresAt < now || session.LastSeenAt + IdleTimeout < now || session.Staff.DisabledAt != null)
            return AuthenticateResult.Fail("Session expired.");

        if (now - session.LastSeenAt > TimeSpan.FromMinutes(5))
        {
            session.LastSeenAt = now;
            await db.SaveChangesAsync(Context.RequestAborted);
        }

        var claims = new[]
        {
            new Claim(StaffClaim, session.StaffId.ToString()),
            new Claim(ClaimTypes.Name, session.Staff.Name),
            new Claim(ClaimTypes.Email, session.Staff.Email),
            new Claim(ClaimTypes.Role, session.Staff.Role),
        };
        return AuthenticateResult.Success(new AuthenticationTicket(
            new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)), Scheme));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Response.WriteAsJsonAsync(new { message = "Sign in to the console." });
    }

    protected override Task HandleForbiddenAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status403Forbidden;
        return Response.WriteAsJsonAsync(new { message = "Only an admin can do that." });
    }

    /// <summary>Opens a session and sets the cookie. Returns nothing the caller needs: the cookie is the session.</summary>
    public static async Task SignInAsync(HttpContext http, PitwallDb db, StaffUser staff, CancellationToken ct)
    {
        var token = Tokens.Random(48);
        var now = DateTime.UtcNow;
        db.StaffSessions.Add(new StaffSession
        {
            Id = Guid.NewGuid(), StaffId = staff.Id, TokenHash = Tokens.Hash(token),
            CreatedAt = now, LastSeenAt = now, ExpiresAt = now + AbsoluteLifetime,
            Ip = http.Connection.RemoteIpAddress?.ToString(),
            UserAgent = Clean.Cut(http.Request.Headers.UserAgent.ToString(), 300),
        });
        staff.LastLoginAt = now;
        await db.SaveChangesAsync(ct);
        http.Response.Cookies.Append(Cookie, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = http.Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            Expires = now + AbsoluteLifetime,
        });
    }

    public static async Task SignOutAsync(HttpContext http, PitwallDb db, CancellationToken ct)
    {
        if (http.Request.Cookies.TryGetValue(Cookie, out var token) && !string.IsNullOrWhiteSpace(token))
        {
            var hash = Tokens.Hash(token);
            await db.StaffSessions.Where(s => s.TokenHash == hash).ExecuteDeleteAsync(ct);
        }
        http.Response.Cookies.Delete(Cookie, new CookieOptions { Path = "/" });
    }
}

public static class StaffContext
{
    public static Guid StaffId(this HttpContext http) =>
        Guid.Parse(http.User.FindFirst(StaffSessionAuthHandler.StaffClaim)!.Value);

    public static string StaffName(this HttpContext http) =>
        http.User.FindFirst(ClaimTypes.Name)?.Value ?? "Team";
}

public static class Policies
{
    public const string Support = "support";
    public const string IngestErrors = "ingest:errors";
    public const string IngestReleases = "ingest:releases";
    public const string Staff = "staff";
    public const string StaffAdmin = "staff:admin";
}
