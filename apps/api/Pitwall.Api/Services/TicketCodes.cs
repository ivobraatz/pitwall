using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Pitwall.Services;

/// <summary>
/// Ticket handles: <c>20260918-7K3Q</c>. Crockford's alphabet (no I, L, O or U), so a code read
/// aloud, typed from a photo or pasted into a commit message survives the trip.
/// </summary>
public static partial class TicketCodes
{
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public static string New(DateTime now)
    {
        Span<byte> bytes = stackalloc byte[4];
        RandomNumberGenerator.Fill(bytes);
        var suffix = new char[4];
        for (var i = 0; i < 4; i++) suffix[i] = Alphabet[bytes[i] % Alphabet.Length];
        return $"{now:yyyyMMdd}-{new string(suffix)}";
    }

    /// <summary>Every ticket code mentioned in a piece of text (a commit subject or body).</summary>
    public static IEnumerable<string> FindIn(string? text) =>
        string.IsNullOrEmpty(text) ? [] : CodePattern().Matches(text).Select(m => m.Value.ToUpperInvariant());

    [GeneratedRegex(@"\b20\d{6}-[0-9A-HJKMNP-TV-Z]{4}\b", RegexOptions.IgnoreCase)]
    private static partial Regex CodePattern();
}
