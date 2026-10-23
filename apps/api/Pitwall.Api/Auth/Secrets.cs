using System.Security.Cryptography;
using System.Text;

namespace Pitwall.Auth;

/// <summary>
/// The few secrets Pitwall must be able to read back (webhook signing secrets, TOTP seeds) are
/// sealed with AES-GCM under the instance key, so a database dump alone does not hand anyone
/// the means to forge a webhook into a product or mint a second factor.
///
/// Everything Pitwall only has to recognise (API keys, session cookies) is hashed instead —
/// see <see cref="Tokens"/>.
/// </summary>
public sealed class Secrets
{
    private readonly byte[] _key;

    public Secrets(IConfiguration config, IHostEnvironment env)
    {
        var raw = config["Pitwall:SecretKey"];
        if (string.IsNullOrWhiteSpace(raw))
        {
            if (!env.IsDevelopment() && !env.IsEnvironment("Testing"))
                throw new InvalidOperationException(
                    "Pitwall:SecretKey is required outside development (32 random bytes, base64). Generate one with: openssl rand -base64 32");
            // A fixed development key: sealed values from a dev database are not secret anyway.
            raw = Convert.ToBase64String(SHA256.HashData("pitwall-development-only"u8));
        }
        _key = Convert.FromBase64String(raw);
        if (_key.Length != 32) throw new InvalidOperationException("Pitwall:SecretKey must decode to exactly 32 bytes.");
    }

    public string Seal(string plaintext)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var data = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[data.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(_key, 16);
        aes.Encrypt(nonce, data, cipher, tag);
        return "v1." + Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public string Open(string sealedValue)
    {
        if (!sealedValue.StartsWith("v1.", StringComparison.Ordinal)) throw new CryptographicException("Unknown sealed format.");
        var blob = Convert.FromBase64String(sealedValue[3..]);
        var nonce = blob.AsSpan(0, 12);
        var tag = blob.AsSpan(12, 16);
        var cipher = blob.AsSpan(28);
        var plain = new byte[cipher.Length];
        using var aes = new AesGcm(_key, 16);
        aes.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }
}

/// <summary>Random tokens and their hashes: API keys, session cookies, webhook secrets.</summary>
public static class Tokens
{
    private const string Alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    public static string Random(int length)
    {
        var bytes = RandomNumberGenerator.GetBytes(length);
        var chars = new char[length];
        for (var i = 0; i < length; i++) chars[i] = Alphabet[bytes[i] % Alphabet.Length];
        return new string(chars);
    }

    /// <summary><c>pw_datarunner_…</c>: says what it is and whose it is when it turns up in a log.</summary>
    public static string NewProductKey(string slug) => $"pw_{slug}_{Random(32)}";

    public static string NewWebhookSecret() => $"pwhs_{Random(40)}";

    public static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
}
