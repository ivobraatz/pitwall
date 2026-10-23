using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pitwall.Auth;

/// <summary>
/// Who, on the product's side, is behind a support request. The product's backend asserts it —
/// it signed the person in, Pitwall did not — in the <c>Pitwall-Actor</c> header: base64url of
/// a small JSON object, because names carry accents and HTTP headers do not.
///
/// <c>customerId</c> is the boundary: a person sees their customer's tickets and nothing else.
/// </summary>
public sealed record Actor(
    [property: JsonPropertyName("customerId")] string CustomerId,
    [property: JsonPropertyName("customerName")] string? CustomerName,
    [property: JsonPropertyName("userId")] string? UserId,
    [property: JsonPropertyName("userName")] string? UserName,
    [property: JsonPropertyName("userEmail")] string? UserEmail)
{
    public const string Header = "Pitwall-Actor";

    public static Actor? From(HttpContext http)
    {
        var raw = http.Request.Headers[Header].ToString();
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > 4096) return null;
        try
        {
            var json = Encoding.UTF8.GetString(FromBase64Url(raw.Trim()));
            var actor = JsonSerializer.Deserialize<Actor>(json);
            if (actor is null || string.IsNullOrWhiteSpace(actor.CustomerId) || actor.CustomerId.Length > 100) return null;
            return actor with
            {
                CustomerId = actor.CustomerId.Trim(),
                CustomerName = Clean.Cut(actor.CustomerName, 200),
                UserId = Clean.Cut(actor.UserId, 100),
                UserName = Clean.Cut(actor.UserName, 200),
                UserEmail = Clean.Cut(actor.UserEmail, 320),
            };
        }
        catch (Exception ex) when (ex is FormatException or JsonException or DecoderFallbackException)
        {
            return null;
        }
    }

    public static string Encode(Actor actor) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(actor)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] FromBase64Url(string s)
    {
        var b = s.Replace('-', '+').Replace('_', '/');
        b = b.PadRight(b.Length + (4 - b.Length % 4) % 4, '=');
        return Convert.FromBase64String(b);
    }
}
