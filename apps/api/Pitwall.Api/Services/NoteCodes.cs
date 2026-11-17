using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Pitwall.Services;

/// <summary>
/// Note handles: <c>N-7K2QM</c>. Same alphabet as <see cref="TeamTaskCodes"/>, its own prefix, so a
/// note code is never mistaken for a task or a ticket in a commit or a message.
/// </summary>
public static partial class NoteCodes
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
        return "N-" + new string(chars);
    }

    /// <summary>Whether a piece of text is a note code (any case). The caller upper-cases it before looking it up.</summary>
    public static bool IsCode(string? text) => text is not null && CodePattern().IsMatch(text.Trim());

    /// <summary>The codes a body links to with <c>[[N-7K2QM]]</c>: upper case, in order, without repeats.</summary>
    public static string[] LinksIn(string? body) =>
        LinkPattern().Matches(body ?? "").Select(m => m.Groups[1].Value.ToUpperInvariant()).Distinct().ToArray();

    [GeneratedRegex(@"^N-[0-9A-HJKMNP-TV-Z]{5}$", RegexOptions.IgnoreCase)]
    private static partial Regex CodePattern();

    [GeneratedRegex(@"\[\[(N-[0-9A-HJKMNP-TV-Z]{5})\]\]", RegexOptions.IgnoreCase)]
    private static partial Regex LinkPattern();
}
