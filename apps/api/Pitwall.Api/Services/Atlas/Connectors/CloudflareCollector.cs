using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Services.Atlas;

/// <summary>
/// Cloudflare: zones, their DNS names, the Workers, Pages projects and R2 buckets of one account. Services
/// match by external reference (zone:x, dns:x, worker:x, pages:x, r2:x). A discovered Worker or bucket node
/// with the same name takes the reference. A domain whose host sits in one of the zones is verified by it.
/// Everything listed and not registered becomes a discovery; DNS names do not (there are too many).
/// </summary>
public sealed class CloudflareCollector(HttpClient http, string? token, string? accountId) : IAtlasCollector
{
    public const string Api = "https://api.cloudflare.com/client/v4";
    public string Name => "cloudflare";
    public bool Configured => !string.IsNullOrWhiteSpace(token) && !string.IsNullOrWhiteSpace(accountId);

    private sealed record Listed(string Ref, string Name, string Kind, string? Adopts, string[] AdoptNames);

    private async Task<JsonElement> GetAsync(string path, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, Api + path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var body = await AtlasCollect.GetJsonAsync(http, req, ct);
        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("success", out var ok) && ok.ValueKind == JsonValueKind.False)
        {
            var message = body.Items("errors").Select(e => e.Str("message")).FirstOrDefault(m => m is not null);
            throw new HttpRequestException("A Cloudflare recusou a consulta: " + (message ?? "sem detalhe"));
        }
        return body;
    }

    /// <summary>Every page of a listing. Cloudflare says how many pages there are; a listing without that is one page.</summary>
    private async Task<List<JsonElement>> ListAsync(string path, int perPage, CancellationToken ct)
    {
        var items = new List<JsonElement>();
        var separator = path.Contains('?') ? "&" : "?";
        for (var page = 1; page <= 100; page++)
        {
            var body = await GetAsync($"{path}{separator}per_page={perPage}&page={page}", ct);
            if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("result", out var result) && result.ValueKind == JsonValueKind.Array)
                items.AddRange(result.EnumerateArray());
            var total = body.ValueKind == JsonValueKind.Object && body.TryGetProperty("result_info", out var info)
                        && info.TryGetProperty("total_pages", out var t) && t.TryGetInt32(out var n) ? n : 1;
            if (page >= total) break;
        }
        return items;
    }

    private static string? HostOf(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) Uri.TryCreate("https://" + url, UriKind.Absolute, out uri);
        return uri?.Host.ToLowerInvariant();
    }

    public async Task<int> CollectAsync(PitwallDb db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var zones = (await ListAsync("/zones", 50, ct))
            .Select(z => (Id: z.Str("id"), Name: z.Str("name")?.ToLowerInvariant()))
            .Where(z => z.Id is not null && z.Name is not null).ToList();

        var listed = new List<Listed>();
        foreach (var zone in zones)
        {
            listed.Add(new($"zone:{zone.Name}", zone.Name!, "zone", null, []));
            foreach (var record in await ListAsync($"/zones/{zone.Id}/dns_records", 500, ct))
            {
                var recordName = record.Str("name")?.ToLowerInvariant();
                if (recordName is not null) listed.Add(new($"dns:{recordName}", recordName, "dns", null, []));
            }
        }
        foreach (var script in await ListAsync($"/accounts/{accountId}/workers/scripts", 100, ct))
        {
            var workerName = script.Str("id");
            if (workerName is not null) listed.Add(new($"worker:{workerName}", workerName, "worker", "cloudflare-worker", [workerName, "Worker " + workerName]));
        }
        foreach (var project in await ListAsync($"/accounts/{accountId}/pages/projects", 100, ct))
        {
            var pagesName = project.Str("name");
            if (pagesName is not null) listed.Add(new($"pages:{pagesName}", pagesName, "pages", null, []));
        }
        // R2 answers with the buckets inside the result, not as the result itself, and has no pages.
        var buckets = await GetAsync($"/accounts/{accountId}/r2/buckets", ct);
        foreach (var bucket in buckets.Items("result", "buckets"))
        {
            var bucketName = bucket.Str("name");
            if (bucketName is not null) listed.Add(new($"r2:{bucketName}", bucketName, "r2", "r2", [bucketName, "R2 " + bucketName]));
        }
        listed = listed.DistinctBy(l => l.Ref).ToList();

        var services = await db.AtlasServices.Where(s => s.RetiredAt == null).ToListAsync(ct);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var unmatched = new List<AtlasCollect.Found>();
        var evidence = new List<Guid>();
        foreach (var item in listed)
        {
            seen.Add(item.Ref);
            var mine = services.Where(s => s.Provider == "cloudflare" && AtlasCollect.Same(s.ExternalRef, item.Ref)).ToList();
            // A node discovered from a manifest (a worker or a bucket in the repo) with the same name is this resource.
            if (mine.Count == 0 && item.Adopts is not null)
            {
                mine = services.Where(s => s.ExternalRef is null && (s.Provider is null or "cloudflare") && s.Signature == item.Adopts
                                           && item.AdoptNames.Any(n => AtlasCollect.Same(s.Name, n))).ToList();
                foreach (var s in mine)
                {
                    s.ExternalRef = item.Ref;
                    s.Provider = "cloudflare";
                }
            }
            if (mine.Count == 0)
            {
                if (item.Kind != "dns") unmatched.Add(new(item.Ref, item.Ref));
                continue;
            }
            foreach (var s in mine) evidence.Add((await AtlasCollect.VerifyAsync(db, s, Name, "cloudflare", item.Ref, now, ct)).Id);
        }

        // A domain or site whose host is inside one of the account's zones is verified by that zone.
        foreach (var s in services.Where(s => s.Kind is "domain" or "site" && s.Url is not null))
        {
            var host = HostOf(s.Url);
            var zone = zones.FirstOrDefault(z => host is not null && (host == z.Name || host.EndsWith("." + z.Name, StringComparison.Ordinal)));
            if (zone.Name is null) continue;
            evidence.Add((await AtlasCollect.VerifyAsync(db, s, Name, "cloudflare", $"zone:{zone.Name}", now, ct)).Id);
        }

        await AtlasCollect.SyncDiscoveriesAsync(db, Name, "service", unmatched, ct);
        // The listings all finished, so a registered resource that did not show is missing.
        await AtlasCollect.ApplyPresenceAsync(db, Name, "Cloudflare",
            services.Where(s => s.Provider == "cloudflare" && s.ExternalRef is not null),
            s => seen.Contains(s.ExternalRef!), now);
        await AtlasEvidenceWriter.MarkGoneAsync(db, $"collector:{Name}", evidence, now, ct);
        await db.SaveChangesAsync(ct);
        return listed.Count;
    }
}
