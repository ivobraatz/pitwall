using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;

namespace Pitwall.Services.Webhooks;

public static class WebhookEvents
{
    /// <summary>A customer opened a ticket. The product may tell the customer's admins.</summary>
    public const string TicketCreated = "ticket.created";
    /// <summary>The team answered (not an internal note). The product tells the person, in its own voice.</summary>
    public const string TicketReplied = "ticket.replied";
    /// <summary>The ticket moved: fix on its way, resolved, waiting for the customer…</summary>
    public const string TicketStatusChanged = "ticket.status_changed";
    /// <summary>A release note went public. The product rings its "what's new" bell.</summary>
    public const string ReleasePublished = "release.published";
    /// <summary>Sent from the console to check the wiring.</summary>
    public const string Ping = "ping";
}

/// <summary>
/// Puts events in the outbox. Called before the caller's SaveChanges, so the event is written in
/// the same transaction as the change it announces: no change without its event, no event for a
/// change that rolled back.
/// </summary>
public static class WebhookOutbox
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void Enqueue(PitwallDb db, Product product, string type, object data)
    {
        if (string.IsNullOrWhiteSpace(product.WebhookUrl)) return;
        var now = DateTime.UtcNow;
        var id = Guid.NewGuid();
        var envelope = new
        {
            id, type, createdAt = now,
            product = new { product.Id, product.Slug },
            data,
        };
        db.WebhookDeliveries.Add(new WebhookDelivery
        {
            Id = id, ProductId = product.Id, Event = type,
            PayloadJson = JsonSerializer.Serialize(envelope, Json),
            Status = WebhookStatuses.Pending, NextAttemptAt = now, CreatedAt = now,
        });
    }

    /// <summary>What a product needs to act on a ticket event without calling back.</summary>
    public static object TicketData(Ticket t) => new
    {
        t.Id, t.Code, t.Title, t.Status, t.Category, t.Severity, t.FixedIn,
        customerId = t.CustomerRef,
        openedByUserId = t.OpenedByRef,
        t.CreatedAt, t.UpdatedAt,
    };
}

/// <summary>
/// <c>Pitwall-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256 of "t.body"&gt;</c> — the
/// timestamp is signed with the body so a captured delivery cannot be replayed later; receivers
/// reject anything older than five minutes.
/// </summary>
public static class WebhookSigner
{
    public static string Sign(string secret, long timestamp, string body)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var mac = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{body}"));
        return $"t={timestamp},v1={Convert.ToHexString(mac).ToLowerInvariant()}";
    }
}

/// <summary>
/// Sends the outbox. One loop, a few deliveries at a time, exponential backoff from 30 seconds to
/// six hours; after ten attempts (about four hours) a delivery is marked failed and stays in the log
/// for the team to retry from the console.
/// </summary>
public sealed class WebhookDispatcher(
    IServiceScopeFactory scopes,
    IHttpClientFactory http,
    ILogger<WebhookDispatcher> logger) : BackgroundService
{
    public const int MaxAttempts = 10;
    private static readonly TimeSpan Idle = TimeSpan.FromSeconds(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var sent = 0;
            try { sent = await DispatchBatchAsync(stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Webhook dispatch loop failed; retrying shortly.");
            }
            if (sent == 0)
            {
                try { await Task.Delay(Idle, stoppingToken); } catch (OperationCanceledException) { break; }
            }
        }
    }

    public async Task<int> DispatchBatchAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        var secrets = scope.ServiceProvider.GetRequiredService<Secrets>();
        var now = DateTime.UtcNow;
        var due = await db.WebhookDeliveries
            .Where(w => w.Status == WebhookStatuses.Pending && w.NextAttemptAt <= now)
            .OrderBy(w => w.NextAttemptAt).Take(20).ToListAsync(ct);
        if (due.Count == 0) return 0;

        var productIds = due.Select(d => d.ProductId).Distinct().ToList();
        var products = await db.Products.AsNoTracking().Where(p => productIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var client = http.CreateClient("webhooks");

        foreach (var delivery in due)
        {
            delivery.Attempts++;
            if (!products.TryGetValue(delivery.ProductId, out var product)
                || string.IsNullOrWhiteSpace(product.WebhookUrl) || product.WebhookSecretSealed is null)
            {
                delivery.Status = WebhookStatuses.Failed;
                delivery.LastError = "The product has no webhook URL or secret.";
                continue;
            }
            try
            {
                var secret = secrets.Open(product.WebhookSecretSealed);
                var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                using var req = new HttpRequestMessage(HttpMethod.Post, product.WebhookUrl)
                {
                    Content = new StringContent(delivery.PayloadJson, Encoding.UTF8, "application/json"),
                };
                req.Headers.Add("Pitwall-Event", delivery.Event);
                req.Headers.Add("Pitwall-Delivery", delivery.Id.ToString());
                req.Headers.Add("Pitwall-Signature", WebhookSigner.Sign(secret, ts, delivery.PayloadJson));
                var sw = Stopwatch.StartNew();
                using var res = await client.SendAsync(req, ct);
                delivery.LastStatusCode = (int)res.StatusCode;
                if (res.IsSuccessStatusCode)
                {
                    delivery.Status = WebhookStatuses.Delivered;
                    delivery.DeliveredAt = DateTime.UtcNow;
                    delivery.LastError = null;
                    logger.LogInformation("Webhook {Event} → {Product} delivered in {Ms} ms", delivery.Event, product.Slug, sw.ElapsedMilliseconds);
                    continue;
                }
                var body = await res.Content.ReadAsStringAsync(ct);
                Retry(delivery, $"HTTP {(int)res.StatusCode}: {Clean.Cut(body, 300)}");
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                Retry(delivery, ex.Message);
            }
        }
        await db.SaveChangesAsync(ct);
        return due.Count;
    }

    private static void Retry(WebhookDelivery d, string error)
    {
        d.LastError = Clean.Cut(error, 1000);
        if (d.Attempts >= MaxAttempts)
        {
            d.Status = WebhookStatuses.Failed;
            return;
        }
        var delay = TimeSpan.FromSeconds(Math.Min(30 * Math.Pow(2, d.Attempts - 1), 6 * 3600));
        d.NextAttemptAt = DateTime.UtcNow + delay;
    }
}
