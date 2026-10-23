using Microsoft.EntityFrameworkCore;
using OtpNet;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Endpoints.Staff;

/// <summary>
/// Signing the team in and out, passwords, and the second factor. The console is the only place
/// customer data from every product sits side by side, so TOTP is offered from the first sign-in
/// and the instance can require it (<c>Pitwall:RequireTotp</c>).
/// </summary>
public static class StaffAuthEndpoints
{
    // Verifying against a fixed hash when the address is unknown keeps the response time the same
    // for "no such person" and "wrong password", so the endpoint does not confirm who exists.
    private static readonly string DummyHash = BCrypt.Net.BCrypt.HashPassword("pitwall-timing-guard", 11);

    public sealed record LoginRequest(string? Email, string? Password, string? Totp);
    public sealed record PasswordRequest(string? Current, string? Next);
    public sealed record TotpConfirmRequest(string? Code);
    public sealed record TotpDisableRequest(string? Password);

    public static IEndpointRouteBuilder MapStaffAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff/auth").WithTags("Staff");

        group.MapPost("/login", async (LoginRequest req, HttpContext http, PitwallDb db, Secrets secrets, CancellationToken ct) =>
        {
            var email = req.Email?.Trim().ToLowerInvariant() ?? "";
            var staff = await db.Staff.FirstOrDefaultAsync(s => s.Email == email && s.DisabledAt == null, ct);
            var ok = BCrypt.Net.BCrypt.Verify(req.Password ?? "", staff?.PasswordHash ?? DummyHash);
            if (staff is null || !ok) return Results.Json(new { message = "E-mail ou senha incorretos." }, statusCode: 401);

            if (staff.TotpEnabled)
            {
                if (string.IsNullOrWhiteSpace(req.Totp))
                    return Results.Json(new { message = "Informe o código do autenticador.", totpRequired = true }, statusCode: 401);
                if (!VerifyTotp(secrets.Open(staff.TotpSecretSealed!), req.Totp))
                    return Results.Json(new { message = "Código do autenticador inválido.", totpRequired = true }, statusCode: 401);
            }
            await StaffSessionAuthHandler.SignInAsync(http, db, staff, ct);
            return Results.Ok(Me(staff, http.RequestServices.GetRequiredService<IConfiguration>()));
        }).RequireRateLimiting("login");

        group.MapPost("/logout", async (HttpContext http, PitwallDb db, CancellationToken ct) =>
        {
            await StaffSessionAuthHandler.SignOutAsync(http, db, ct);
            return Results.NoContent();
        });

        var authed = group.MapGroup("").RequireAuthorization(Policies.Staff);

        authed.MapGet("/me", async (HttpContext http, PitwallDb db, IConfiguration config, CancellationToken ct) =>
        {
            var staff = await db.Staff.AsNoTracking().FirstAsync(s => s.Id == http.StaffId(), ct);
            return Results.Ok(Me(staff, config));
        });

        authed.MapPost("/password", async (PasswordRequest req, HttpContext http, PitwallDb db, CancellationToken ct) =>
        {
            var staff = await db.Staff.FirstAsync(s => s.Id == http.StaffId(), ct);
            if (!BCrypt.Net.BCrypt.Verify(req.Current ?? "", staff.PasswordHash))
                return Results.BadRequest(new { message = "A senha atual não confere." });
            if (req.Next is null || req.Next.Length < 12)
                return Results.BadRequest(new { message = "A nova senha precisa de pelo menos 12 caracteres." });
            staff.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Next, 12);
            staff.MustChangePassword = false;
            // Every other session of this person ends: a password change is often a reaction to a leak.
            var token = http.Request.Cookies[StaffSessionAuthHandler.Cookie];
            var keep = token is null ? "" : Tokens.Hash(token);
            await db.StaffSessions.Where(s => s.StaffId == staff.Id && s.TokenHash != keep).ExecuteDeleteAsync(ct);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        authed.MapPost("/totp/enroll", async (HttpContext http, PitwallDb db, Secrets secrets, CancellationToken ct) =>
        {
            var staff = await db.Staff.FirstAsync(s => s.Id == http.StaffId(), ct);
            if (staff.TotpEnabled) return Results.BadRequest(new { message = "O autenticador já está ativo." });
            var secret = Base32Encoding.ToString(KeyGeneration.GenerateRandomKey(20));
            staff.TotpSecretSealed = secrets.Seal(secret);
            await db.SaveChangesAsync(ct);
            var uri = $"otpauth://totp/Pitwall:{Uri.EscapeDataString(staff.Email)}?secret={secret}&issuer=Pitwall&digits=6&period=30";
            return Results.Ok(new { secret, uri });
        });

        authed.MapPost("/totp/confirm", async (TotpConfirmRequest req, HttpContext http, PitwallDb db, Secrets secrets, CancellationToken ct) =>
        {
            var staff = await db.Staff.FirstAsync(s => s.Id == http.StaffId(), ct);
            if (staff.TotpSecretSealed is null) return Results.BadRequest(new { message = "Comece o cadastro do autenticador primeiro." });
            if (!VerifyTotp(secrets.Open(staff.TotpSecretSealed), req.Code))
                return Results.BadRequest(new { message = "Código inválido. Confira o relógio do celular e tente de novo." });
            staff.TotpEnabled = true;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        authed.MapPost("/totp/disable", async (TotpDisableRequest req, HttpContext http, PitwallDb db, IConfiguration config, CancellationToken ct) =>
        {
            if (config.GetValue("Pitwall:RequireTotp", false))
                return Results.BadRequest(new { message = "Esta instalação exige o autenticador." });
            var staff = await db.Staff.FirstAsync(s => s.Id == http.StaffId(), ct);
            if (!BCrypt.Net.BCrypt.Verify(req.Password ?? "", staff.PasswordHash))
                return Results.BadRequest(new { message = "Senha incorreta." });
            staff.TotpEnabled = false;
            staff.TotpSecretSealed = null;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        return app;
    }

    private static object Me(StaffUser s, IConfiguration config) => new
    {
        s.Id, s.Name, s.Email, s.Role, s.TotpEnabled, s.MustChangePassword,
        totpRequired = config.GetValue("Pitwall:RequireTotp", false) && !s.TotpEnabled,
    };

    private static bool VerifyTotp(string secret, string? code)
    {
        var digits = new string((code ?? "").Where(char.IsDigit).ToArray());
        if (digits.Length != 6) return false;
        var totp = new Totp(Base32Encoding.ToBytes(secret));
        return totp.VerifyTotp(digits, out _, new VerificationWindow(previous: 1, future: 1));
    }
}

/// <summary>The people on the team. Admins add and disable; everyone can see who is there, for assignment.</summary>
public static class StaffTeamEndpoints
{
    public sealed record CreateStaffRequest(string? Email, string? Name, string? Role);
    public sealed record UpdateStaffRequest(string? Name, string? Role, bool? Disabled);

    public static IEndpointRouteBuilder MapStaffTeamEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff/team").RequireAuthorization(Policies.Staff).WithTags("Staff");

        group.MapGet("", async (PitwallDb db, CancellationToken ct) => Results.Ok(await db.Staff.AsNoTracking()
            .OrderBy(s => s.Name)
            .Select(s => new { s.Id, s.Name, s.Email, s.Role, s.TotpEnabled, s.LastLoginAt, disabled = s.DisabledAt != null })
            .ToListAsync(ct)));

        group.MapPost("", async (CreateStaffRequest req, PitwallDb db, CancellationToken ct) =>
        {
            var email = req.Email?.Trim().ToLowerInvariant();
            var name = Clean.Cut(req.Name, 120);
            if (string.IsNullOrWhiteSpace(email) || !email.Contains('@') || name is null)
                return Results.BadRequest(new { message = "Informe nome e e-mail." });
            if (await db.Staff.AnyAsync(s => s.Email == email, ct))
                return Results.Conflict(new { message = "Já existe alguém com esse e-mail." });
            // A temporary password, shown once, changed at first sign-in.
            var temporary = Tokens.Random(16);
            var staff = new StaffUser
            {
                Id = Guid.NewGuid(), Email = email, Name = name,
                Role = req.Role == StaffRoles.Admin ? StaffRoles.Admin : StaffRoles.Agent,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(temporary, 12), MustChangePassword = true,
                CreatedAt = DateTime.UtcNow,
            };
            db.Staff.Add(staff);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { staff.Id, staff.Email, temporaryPassword = temporary });
        }).RequireAuthorization(Policies.StaffAdmin);

        group.MapPatch("/{id:guid}", async (Guid id, UpdateStaffRequest req, HttpContext http, PitwallDb db, CancellationToken ct) =>
        {
            var staff = await db.Staff.FirstOrDefaultAsync(s => s.Id == id, ct);
            if (staff is null) return Results.NotFound();
            if (id == http.StaffId() && (req.Disabled == true || req.Role == StaffRoles.Agent))
                return Results.BadRequest(new { message = "Você não pode desativar nem rebaixar a si mesmo." });
            if (Clean.Cut(req.Name, 120) is { } name) staff.Name = name;
            if (req.Role is StaffRoles.Admin or StaffRoles.Agent) staff.Role = req.Role;
            if (req.Disabled is { } disabled)
            {
                staff.DisabledAt = disabled ? DateTime.UtcNow : null;
                if (disabled) await db.StaffSessions.Where(s => s.StaffId == id).ExecuteDeleteAsync(ct);
            }
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).RequireAuthorization(Policies.StaffAdmin);

        return app;
    }
}
