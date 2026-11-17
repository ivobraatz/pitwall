using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Endpoints.Staff;

/// <summary>
/// Personal tokens: what someone on the team hands a tool (the Pitwall MCP) so it can work the
/// task board and the Atlas on their behalf. Managed from a console session only — a token never
/// mints another or changes its own scopes. The plaintext is in the creation response and nowhere else.
/// </summary>
public static class StaffTokenEndpoints
{
    public const int MaxActivePerPerson = 10;
    private static readonly int[] Lifetimes = [30, 90, 365];
    /// <summary>When the request does not say: a token forgotten on a laptop dies on its own.</summary>
    public const int DefaultLifetimeDays = 90;

    /// <param name="ExpiresInDays">30, 90 or 365; <c>null</c> = never; left out = <see cref="DefaultLifetimeDays"/>.
    /// Raw JSON, because <c>int?</c> cannot tell "left out" from <c>null</c>.</param>
    public sealed record CreateTokenRequest(string? Name, JsonElement ExpiresInDays, string[]? Scopes);

    public sealed record UpdateTokenRequest(string[]? Scopes);

    private const string ScopeMessage = "Escolha um ou mais escopos entre tasks, atlas, errors e notes.";

    /// <summary>The known scopes asked for, in a fixed order; <c>null</c> when none is asked or one is unknown.</summary>
    private static string[]? ParseScopes(IEnumerable<string?> raw)
    {
        var asked = raw.Select(s => s?.Trim().ToLowerInvariant()).ToHashSet();
        if (asked.Count == 0 || !asked.All(StaffTokenScopes.IsValid)) return null;
        return StaffTokenScopes.All.Where(s => asked.Contains(s)).ToArray();
    }

    public static IEndpointRouteBuilder MapStaffTokenEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff/me/tokens").RequireAuthorization(Policies.Staff).WithTags("Staff");

        group.MapGet("", async (HttpContext http, PitwallDb db, CancellationToken ct) =>
        {
            var me = http.StaffId();
            return Results.Ok(await db.StaffTokens.AsNoTracking()
                .Where(t => t.StaffUserId == me)
                .OrderByDescending(t => t.CreatedAt).Take(100)
                .Select(t => new { t.Id, t.Name, t.Prefix, t.Scopes, t.CreatedAt, t.LastUsedAt, t.ExpiresAt, t.RevokedAt })
                .ToListAsync(ct));
        });

        group.MapPost("", async (CreateTokenRequest req, HttpContext http, PitwallDb db, CancellationToken ct) =>
        {
            var name = Clean.Cut(req.Name, 80);
            if (name is null) return Results.BadRequest(new { message = "Dê um nome ao token (até 80 caracteres), como \"Claude Code no notebook\"." });
            int? lifetime = req.ExpiresInDays.ValueKind switch
            {
                JsonValueKind.Undefined => DefaultLifetimeDays,
                JsonValueKind.Null => null,
                JsonValueKind.Number when req.ExpiresInDays.TryGetInt32(out var days) && Lifetimes.Contains(days) => days,
                _ => -1,
            };
            if (lifetime == -1)
                return Results.BadRequest(new { message = "A validade é de 30, 90 ou 365 dias, ou sem expiração." });
            var scopes = ParseScopes(req.Scopes ?? [StaffTokenScopes.Tasks]);
            if (scopes is null) return Results.BadRequest(new { message = ScopeMessage });

            var me = http.StaffId();
            var now = DateTime.UtcNow;
            var active = await db.StaffTokens.CountAsync(t => t.StaffUserId == me && t.RevokedAt == null
                                                              && (t.ExpiresAt == null || t.ExpiresAt > now), ct);
            if (active >= MaxActivePerPerson)
                return Results.Conflict(new { message = $"Você já tem {MaxActivePerPerson} tokens ativos. Revogue um antes de criar outro." });

            var token = Tokens.NewStaffToken();
            var row = new StaffToken
            {
                Id = Guid.NewGuid(), StaffUserId = me, Name = name, Prefix = token[..12], Hash = Tokens.Hash(token),
                Scopes = scopes, CreatedAt = now, ExpiresAt = lifetime is { } d ? now.AddDays(d) : null,
            };
            db.StaffTokens.Add(row);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/v1/staff/me/tokens/{row.Id}", new { row.Id, row.Name, row.Prefix, row.Scopes, row.ExpiresAt, token });
        }).RequireRateLimiting("login");

        // The scopes change in place, so the tool that holds the token keeps it: nothing new to paste.
        // Like the rest of the group, only from a console session: a token never widens itself.
        group.MapPatch("/{id:guid}", async (Guid id, UpdateTokenRequest req, HttpContext http, PitwallDb db, IMemoryCache cache, CancellationToken ct) =>
        {
            var scopes = req.Scopes is null ? null : ParseScopes(req.Scopes);
            if (scopes is null) return Results.BadRequest(new { message = ScopeMessage });

            var me = http.StaffId();
            var row = await db.StaffTokens.FirstOrDefaultAsync(t => t.Id == id && t.StaffUserId == me, ct);
            if (row is null) return Results.NotFound();
            if (row.RevokedAt is not null || row.ExpiresAt is { } expires && expires <= DateTime.UtcNow)
                return Results.Conflict(new { message = "Este token foi revogado ou venceu. Crie outro." });

            row.Scopes = scopes;
            await db.SaveChangesAsync(ct);
            // Without this, the old scopes would hold until the cache entry ran out.
            cache.Remove(StaffTokenAuthHandler.CacheKey(row.Hash));
            return Results.Ok(new { row.Id, row.Name, row.Prefix, row.Scopes, row.CreatedAt, row.LastUsedAt, row.ExpiresAt, row.RevokedAt });
        });

        group.MapDelete("/{id:guid}", async (Guid id, HttpContext http, PitwallDb db, IMemoryCache cache, CancellationToken ct) =>
        {
            var me = http.StaffId();
            var row = await db.StaffTokens.FirstOrDefaultAsync(t => t.Id == id && t.StaffUserId == me, ct);
            if (row is null) return Results.NotFound();
            row.RevokedAt ??= DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            // Without this, the token would keep working until its cache entry ran out.
            cache.Remove(StaffTokenAuthHandler.CacheKey(row.Hash));
            return Results.NoContent();
        });

        return app;
    }
}
