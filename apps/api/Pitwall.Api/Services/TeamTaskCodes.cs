using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Pitwall.Services;

/// <summary>
/// Team task handles: <c>T-7K2QM</c>. Same alphabet as <see cref="TicketCodes"/> (no I, L, O or U),
/// but never the same shape: release commits resolve tickets by their code, and a task cited in a
/// commit must not close a customer's ticket.
/// </summary>
public static partial class TeamTaskCodes
{
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    public const int Length = 5;

    public static string New()
    {
        Span<byte> bytes = stackalloc byte[Length];
        RandomNumberGenerator.Fill(bytes);
        var chars = new char[Length];
        // 256 is a multiple of 32: the modulo keeps every character equally likely.
        for (var i = 0; i < Length; i++) chars[i] = Alphabet[bytes[i] % Alphabet.Length];
        return "T-" + new string(chars);
    }

    /// <summary>Whether a piece of text is a task code (any case). The caller upper-cases it before looking it up.</summary>
    public static bool IsCode(string? text) => text is not null && CodePattern().IsMatch(text.Trim());

    [GeneratedRegex(@"^T-[0-9A-HJKMNP-TV-Z]{5}$", RegexOptions.IgnoreCase)]
    private static partial Regex CodePattern();
}
