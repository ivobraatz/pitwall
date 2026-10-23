using System.Text.Json;

namespace Pitwall;

/// <summary>Input hygiene shared by every endpoint: trim, cap, and refuse what is not the expected shape.</summary>
public static class Clean
{
    public static string? Cut(string? s, int max)
    {
        if (s is null) return null;
        var t = s.Trim();
        if (t.Length == 0) return null;
        return t.Length <= max ? t : t[..max];
    }

    /// <summary>A screen path: must be relative to the product's origin. Anything else is dropped, not stored.</summary>
    public static string? Route(string? route)
    {
        var r = route?.Trim();
        if (string.IsNullOrEmpty(r) || !r.StartsWith('/') || r.StartsWith("//")) return null;
        return r.Length <= 512 ? r : r[..512];
    }

    /// <summary>A JSON object up to <paramref name="maxBytes"/>, as raw text; anything else is null.</summary>
    public static string? JsonObject(JsonElement? value, int maxBytes)
    {
        if (value is not { ValueKind: JsonValueKind.Object } v) return null;
        var raw = v.GetRawText();
        return raw.Length <= maxBytes ? raw : null;
    }

    public static string? JsonObject(string? raw, int maxBytes)
    {
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > maxBytes) return null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.ValueKind == JsonValueKind.Object ? doc.RootElement.GetRawText() : null;
        }
        catch (JsonException) { return null; }
    }

    public static string[] TraceIds(IEnumerable<string?>? ids, int max = 20) => (ids ?? [])
        .Select(i => i?.Trim() ?? "").Where(i => i.Length is > 0 and <= 64)
        .Distinct(StringComparer.Ordinal).Take(max).ToArray();

    public static JsonElement? ParseJson(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try { return JsonSerializer.Deserialize<JsonElement>(raw); }
        catch (JsonException) { return null; }
    }

    public static (int Page, int Size) Paging(int? page, int? pageSize, int defaultSize = 25) =>
        (Math.Max(page ?? 1, 1), pageSize is null or < 1 or > 100 ? defaultSize : pageSize.Value);
}

public sealed record Paged<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);
