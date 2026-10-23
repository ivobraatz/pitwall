using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Pitwall.Services.Errors;

/// <summary>
/// The same bug thrown twice gets the same signature: exception type, the route it came
/// through, and the first stack frame that belongs to the product. Line and column numbers are
/// left out so a deploy that shifts code does not split one bug into two.
///
/// Understands both stack formats the products produce:
/// <c>at DataRunner.Api.Endpoints.X.Y(Int32 id) in /src/X.cs:line 42</c> (.NET) and
/// <c>at handler (/app/apps/api/src/routes/flows.ts:120:15)</c> (Node).
/// </summary>
public static partial class ErrorSignature
{
    public static string Compute(string exceptionType, string route, string? stackTrace, IReadOnlyList<string> ownFramePrefixes)
    {
        var frame = FirstOwnFrame(stackTrace, ownFramePrefixes) ?? "";
        var raw = $"{exceptionType}|{NormalizeRoute(route)}|{frame}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)))[..32].ToLowerInvariant();
    }

    /// <summary>
    /// The first frame whose text contains one of the product's markers, normalized. Without
    /// markers (or without a match) the first frame of all — better than nothing, though a
    /// framework frame there makes the signature coarser.
    /// </summary>
    public static string? FirstOwnFrame(string? stack, IReadOnlyList<string> prefixes)
    {
        if (string.IsNullOrEmpty(stack)) return null;
        string? first = null;
        foreach (var line in stack.Split('\n'))
        {
            var t = line.Trim();
            if (!t.StartsWith("at ", StringComparison.Ordinal)) continue;
            var normalized = Normalize(t[3..]);
            first ??= normalized;
            if (prefixes.Count > 0 && prefixes.Any(p => p.Length > 0 && t.Contains(p, StringComparison.Ordinal)))
                return normalized;
        }
        return first;
    }

    private static string Normalize(string frame)
    {
        // .NET: "Ns.Type.Method(Int32 id) in /src/file.cs:line 42" → "Ns.Type.Method"
        var dotnet = DotnetFrame().Match(frame);
        if (dotnet.Success) return dotnet.Groups["method"].Value;
        // Node: "fn (/app/x.ts:12:7)" → "fn (/app/x.ts)"; "/app/x.ts:12:7" → "/app/x.ts"
        var withoutPosition = NodePosition().Replace(frame, "");
        return withoutPosition.Trim();
    }

    /// <summary>Ids in a raw path would make every request its own bug: <c>/tickets/3f2a…</c> → <c>/tickets/:id</c>.</summary>
    public static string NormalizeRoute(string route)
    {
        var path = route.Split('?')[0];
        return IdSegment().Replace(path, "/:id");
    }

    [GeneratedRegex(@"^(?<method>[\w.`<>\[\]+|]+)\(.*?\)(\s+in\s+.*)?$")]
    private static partial Regex DotnetFrame();

    [GeneratedRegex(@":\d+(:\d+)?(?=\)?$)")]
    private static partial Regex NodePosition();

    [GeneratedRegex(@"/(?:[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}|\d+)(?=/|$)")]
    private static partial Regex IdSegment();
}
