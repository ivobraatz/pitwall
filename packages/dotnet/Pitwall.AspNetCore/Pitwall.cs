using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Pitwall.AspNetCore;

/// <summary>Where Pitwall is and how this product proves who it is.</summary>
public sealed class PitwallOptions
{
    /// <summary>https://pitwall.example.com — the API, not the console.</summary>
    public string BaseUrl { get; set; } = "";
    /// <summary>A key with the <c>support</c> and <c>errors</c> scopes. Server-side only; never in a browser bundle.</summary>
    public string ApiKey { get; set; } = "";
    /// <summary>The product's webhook secret (<c>pwhs_…</c>), to verify events Pitwall sends.</summary>
    public string? WebhookSecret { get; set; }
    /// <summary>The running version, stamped on every error report.</summary>
    public string? Release { get; set; }
    public string? Environment { get; set; }

    /// <summary>
    /// False when no Pitwall is configured (a self-hosted install, a developer machine): the bridge
    /// answers 503, error reports are dropped, and nothing throws at startup.
    /// </summary>
    public bool IsConfigured => !string.IsNullOrWhiteSpace(BaseUrl) && !string.IsNullOrWhiteSpace(ApiKey);
}

/// <summary>
/// Who is asking, as this product knows them. <see cref="CustomerId"/> is the boundary in Pitwall:
/// people see the tickets of their customer account and no others. Send the e-mail only if the
/// team should see it.
/// </summary>
public sealed record PitwallActor(
    [property: JsonPropertyName("customerId")] string CustomerId,
    [property: JsonPropertyName("customerName")] string? CustomerName = null,
    [property: JsonPropertyName("userId")] string? UserId = null,
    [property: JsonPropertyName("userName")] string? UserName = null,
    [property: JsonPropertyName("userEmail")] string? UserEmail = null)
{
    public string Encode() =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(this)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public static class PitwallServiceCollectionExtensions
{
    /// <summary>Registers the bridge client, the error reporter and the webhook verifier.</summary>
    public static IServiceCollection AddPitwall(this IServiceCollection services, IConfiguration section)
    {
        services.Configure<PitwallOptions>(section);
        return services.AddPitwallCore();
    }

    public static IServiceCollection AddPitwall(this IServiceCollection services, Action<PitwallOptions> configure)
    {
        services.Configure(configure);
        return services.AddPitwallCore();
    }

    private static IServiceCollection AddPitwallCore(this IServiceCollection services)
    {
        services.AddHttpClient(PitwallBridge.ClientName, (sp, c) =>
        {
            var o = sp.GetRequiredService<IOptions<PitwallOptions>>().Value;
            if (!o.IsConfigured) return;
            c.BaseAddress = new Uri(o.BaseUrl.TrimEnd('/') + "/");
            c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", o.ApiKey);
            c.Timeout = TimeSpan.FromSeconds(120);
        });
        services.AddSingleton<PitwallErrorReporter>();
        services.AddSingleton<IPitwallErrorReporter>(sp => sp.GetRequiredService<PitwallErrorReporter>());
        services.AddHostedService(sp => sp.GetRequiredService<PitwallErrorReporter>());
        return services;
    }
}

/// <summary>
/// The support bridge: the product's browser calls the product's own API (with its own session),
/// and the product's API forwards to Pitwall with its key and the person it already identified.
/// The browser never sees the key, and cannot claim to be anyone else.
/// </summary>
public static class PitwallBridge
{
    public const string ClientName = "pitwall";
    private static readonly HashSet<string> CopiedResponseHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Content-Type", "Content-Disposition", "Content-Length",
    };

    /// <summary>
    /// Maps <c>{prefix}/**</c> to Pitwall's <c>/v1/support/**</c>. Return null from
    /// <paramref name="resolveActor"/> to refuse (401). Chain <c>.RequireAuthorization()</c> on the result.
    /// </summary>
    /// <example>
    /// app.MapPitwallSupport("/api/v1/support", http => ValueTask.FromResult&lt;PitwallActor?&gt;(
    ///     new PitwallActor(http.User.FindFirst("ws")!.Value, userId: ..., userName: ...))).RequireAuthorization();
    /// </example>
    public static RouteGroupBuilder MapPitwallSupport(
        this IEndpointRouteBuilder app, string prefix, Func<HttpContext, ValueTask<PitwallActor?>> resolveActor)
    {
        var group = app.MapGroup(prefix);
        group.MapMethods("/{**path}", ["GET", "POST"], (HttpContext http, string? path) => ForwardAsync(http, path ?? "", resolveActor))
            .DisableAntiforgery();
        return group;
    }

    public static async Task ForwardAsync(HttpContext http, string path, Func<HttpContext, ValueTask<PitwallActor?>> resolveActor)
    {
        if (!http.RequestServices.GetRequiredService<IOptions<PitwallOptions>>().Value.IsConfigured)
        {
            http.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await http.Response.WriteAsJsonAsync(new { message = "Support is not configured on this installation." });
            return;
        }
        var actor = await resolveActor(http);
        if (actor is null || string.IsNullOrWhiteSpace(actor.CustomerId))
        {
            http.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
        // Only plain segments: a "../ingest" would otherwise walk out of the support surface on the
        // product's own key.
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Any(s => s is "." or ".." || s.Contains('%') || s.Contains('\\')))
        {
            http.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }
        var target = "v1/support/" + string.Join('/', segments.Select(Uri.EscapeDataString)) + http.Request.QueryString.Value;

        var client = http.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient(ClientName);
        using var request = new HttpRequestMessage(new HttpMethod(http.Request.Method), target);
        request.Headers.Add("Pitwall-Actor", actor.Encode());
        if (HttpMethods.IsPost(http.Request.Method))
        {
            // Attachments can be 25 MB; lift the product's own body cap for this route.
            var limit = http.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = 27L * 1024 * 1024;
            request.Content = new StreamContent(http.Request.Body);
            if (http.Request.ContentType is { } ct) request.Content.Headers.TryAddWithoutValidation("Content-Type", ct);
            if (http.Request.ContentLength is { } len) request.Content.Headers.ContentLength = len;
        }

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, http.RequestAborted);
        }
        catch (HttpRequestException)
        {
            http.Response.StatusCode = StatusCodes.Status502BadGateway;
            await http.Response.WriteAsJsonAsync(new { message = "Support is unreachable right now." });
            return;
        }
        using (response)
        {
            http.Response.StatusCode = (int)response.StatusCode;
            foreach (var h in response.Content.Headers.Concat(response.Headers))
                if (CopiedResponseHeaders.Contains(h.Key))
                    http.Response.Headers[h.Key] = h.Value.ToArray();
            await response.Content.CopyToAsync(http.Response.Body, http.RequestAborted);
        }
    }
}

/// <summary>One unhandled server error, sanitized by the product before it leaves.</summary>
public sealed record PitwallServerError
{
    public required string TraceId { get; init; }
    public DateTime OccurredAt { get; init; } = DateTime.UtcNow;
    public string? CustomerId { get; init; }
    public string? UserId { get; init; }
    public required string Method { get; init; }
    public required string Path { get; init; }
    public string? RouteTemplate { get; init; }
    public int StatusCode { get; init; } = 500;
    public required string ExceptionType { get; init; }
    public required string Message { get; init; }
    public string? StackTrace { get; init; }
    public string? Release { get; init; }
    public string? Environment { get; init; }

    /// <summary>
    /// The usual shape, from a request that just threw. Pass <paramref name="sanitize"/> to scrub
    /// connection strings, tokens and SQL from the message and stack before they leave the process.
    /// </summary>
    public static PitwallServerError From(HttpContext http, Exception ex, int statusCode = 500,
        string? customerId = null, string? userId = null, Func<string, string>? sanitize = null)
    {
        sanitize ??= s => s;
        return new PitwallServerError
        {
            // The id the product already returns to the browser with the error, so a ticket that
            // carries it finds this report.
            TraceId = http.TraceIdentifier,
            CustomerId = customerId, UserId = userId,
            Method = http.Request.Method,
            Path = http.Request.Path.Value ?? "/",
            RouteTemplate = (http.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText,
            StatusCode = statusCode,
            ExceptionType = ex.GetType().FullName ?? ex.GetType().Name,
            Message = sanitize(ex.Message),
            StackTrace = sanitize(ex.ToString()),
        };
    }
}

public interface IPitwallErrorReporter
{
    /// <summary>Queues the error and returns at once; reports go out in batches, in the background.</summary>
    void Report(PitwallServerError error);
}

/// <summary>
/// Sends error reports in batches of up to 50, every couple of seconds. Never blocks or throws
/// into the request that failed; when Pitwall is down the queue drops the oldest reports rather
/// than grow without bound.
/// </summary>
public sealed class PitwallErrorReporter(IHttpClientFactory http, IOptions<PitwallOptions> options, ILogger<PitwallErrorReporter> logger)
    : BackgroundService, IPitwallErrorReporter
{
    private readonly Channel<PitwallServerError> _queue = Channel.CreateBounded<PitwallServerError>(
        new BoundedChannelOptions(1000) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });

    public void Report(PitwallServerError error)
    {
        var o = options.Value;
        if (!o.IsConfigured) return;
        _queue.Writer.TryWrite(error with { Release = error.Release ?? o.Release, Environment = error.Environment ?? o.Environment });
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.IsConfigured) return;
        var batch = new List<PitwallServerError>(50);
        while (await _queue.Reader.WaitToReadAsync(stoppingToken))
        {
            while (batch.Count < 50 && _queue.Reader.TryRead(out var e)) batch.Add(e);
            try
            {
                var client = http.CreateClient(PitwallBridge.ClientName);
                using var res = await client.PostAsJsonAsync("v1/ingest/errors", new { errors = batch }, stoppingToken);
                if (!res.IsSuccessStatusCode) logger.LogWarning("Pitwall refused {Count} error report(s): {Status}", batch.Count, (int)res.StatusCode);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Could not send {Count} error report(s) to Pitwall.", batch.Count);
            }
            batch.Clear();
            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
    }
}

/// <summary>An event Pitwall sent: <c>ticket.created</c>, <c>ticket.replied</c>, <c>ticket.status_changed</c>, <c>release.published</c>, <c>ping</c>.</summary>
public sealed record PitwallEvent(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("createdAt")] DateTime CreatedAt,
    [property: JsonPropertyName("data")] JsonElement Data);

public static class PitwallWebhooks
{
    public static readonly TimeSpan Tolerance = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Maps the endpoint Pitwall posts events to. The signature is checked before the handler
    /// runs; a bad or stale one is a 401. Pitwall retries anything but a 2xx, so the handler
    /// should be idempotent on <see cref="PitwallEvent.Id"/>.
    /// </summary>
    public static RouteHandlerBuilder MapPitwallWebhook(
        this IEndpointRouteBuilder app, string pattern, Func<PitwallEvent, HttpContext, Task> handler) =>
        app.MapPost(pattern, async (HttpContext http, IOptions<PitwallOptions> options) =>
        {
            using var reader = new StreamReader(http.Request.Body, Encoding.UTF8);
            var body = await reader.ReadToEndAsync(http.RequestAborted);
            var secret = options.Value.WebhookSecret;
            if (string.IsNullOrEmpty(secret) || !Verify(secret, http.Request.Headers["Pitwall-Signature"].ToString(), body, DateTimeOffset.UtcNow))
                return Results.Unauthorized();
            var evt = JsonSerializer.Deserialize<PitwallEvent>(body);
            if (evt is null) return Results.BadRequest();
            await handler(evt, http);
            return Results.Ok();
        }).AllowAnonymous().DisableAntiforgery();

    public static bool Verify(string secret, string header, string body, DateTimeOffset now)
    {
        string? t = null, v1 = null;
        foreach (var part in header.Split(','))
        {
            var kv = part.Split('=', 2);
            if (kv.Length != 2) continue;
            if (kv[0].Trim() == "t") t = kv[1].Trim();
            else if (kv[0].Trim() == "v1") v1 = kv[1].Trim();
        }
        if (!long.TryParse(t, out var ts) || v1 is null) return false;
        if ((now - DateTimeOffset.FromUnixTimeSeconds(ts)).Duration() > Tolerance) return false;
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expected = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes($"{ts}.{body}"))).ToLowerInvariant();
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(v1));
    }
}
