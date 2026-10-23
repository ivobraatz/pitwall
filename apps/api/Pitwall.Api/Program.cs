using System.Threading.RateLimiting;
using Amazon.Runtime;
using Amazon.S3;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Pitwall;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Endpoints;
using Pitwall.Endpoints.Staff;
using Pitwall.Services;
using Pitwall.Services.Mail;
using Pitwall.Services.Releases;
using Pitwall.Services.Storage;
using Pitwall.Services.Webhooks;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

builder.Services.AddDbContext<PitwallDb>(o => o
    .UseNpgsql(config.GetConnectionString("Pitwall") ?? throw new InvalidOperationException("ConnectionStrings:Pitwall is required."))
    .UseSnakeCaseNamingConvention());
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<Secrets>();
builder.Services.AddHttpClient("webhooks", c =>
{
    c.Timeout = TimeSpan.FromSeconds(15);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Pitwall-Webhooks/1.0");
});

// Attachments: S3-compatible bucket in production, a directory in development.
builder.Services.AddSingleton<IBlobStore>(sp =>
{
    var storage = config.GetSection("Storage");
    if (string.Equals(storage["Provider"], "s3", StringComparison.OrdinalIgnoreCase))
    {
        var s3Config = new AmazonS3Config { ForcePathStyle = true };
        if (!string.IsNullOrWhiteSpace(storage["ServiceUrl"])) s3Config.ServiceURL = storage["ServiceUrl"];
        else s3Config.RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(storage["Region"] ?? "us-east-1");
        var s3 = new AmazonS3Client(new BasicAWSCredentials(storage["AccessKey"], storage["SecretKey"]), s3Config);
        return new S3BlobStore(s3, storage["Bucket"] ?? throw new InvalidOperationException("Storage:Bucket is required."));
    }
    // An empty Path (as appsettings.json ships it) means "the default", not "the working directory".
    var path = string.IsNullOrWhiteSpace(storage["Path"]) ? Path.Combine(builder.Environment.ContentRootPath, "data", "blobs") : storage["Path"]!;
    return new FileSystemBlobStore(path);
});
builder.Services.AddSingleton<AttachmentStore>();
builder.Services.AddSingleton<TeamInbox>();
builder.Services.AddSingleton<IReleaseNoteModel, AnthropicReleaseNoteModel>();
builder.Services.AddScoped<ReleaseWriter>();
builder.Services.AddScoped<ReleasePublisher>();
builder.Services.AddSingleton<WebhookDispatcher>();
if (!builder.Environment.IsEnvironment("Testing"))
{
    builder.Services.AddHostedService(sp => sp.GetRequiredService<WebhookDispatcher>());
    builder.Services.AddHostedService<RetentionService>();
}

builder.Services.AddAuthentication()
    .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions, ProductKeyAuthHandler>(ProductKeyAuthHandler.Scheme, null)
    .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions, StaffSessionAuthHandler>(StaffSessionAuthHandler.Scheme, null);
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Policies.Support, p => p.AddAuthenticationSchemes(ProductKeyAuthHandler.Scheme).RequireClaim(ProductKeyAuthHandler.ScopeClaim, KeyScopes.Support))
    .AddPolicy(Policies.IngestErrors, p => p.AddAuthenticationSchemes(ProductKeyAuthHandler.Scheme).RequireClaim(ProductKeyAuthHandler.ScopeClaim, KeyScopes.Errors))
    .AddPolicy(Policies.IngestReleases, p => p.AddAuthenticationSchemes(ProductKeyAuthHandler.Scheme).RequireClaim(ProductKeyAuthHandler.ScopeClaim, KeyScopes.Releases))
    .AddPolicy(Policies.Staff, p => p.AddAuthenticationSchemes(StaffSessionAuthHandler.Scheme).RequireClaim(StaffSessionAuthHandler.StaffClaim))
    .AddPolicy(Policies.StaffAdmin, p => p.AddAuthenticationSchemes(StaffSessionAuthHandler.Scheme).RequireRole(StaffRoles.Admin));

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Per address: guessing passwords is slow.
    o.AddPolicy("login", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(5) }));
    // Per customer of a product: one noisy account cannot flood the queue.
    o.AddPolicy("support-writes", http => RateLimitPartition.GetFixedWindowLimiter(
        $"{http.User.FindFirst(ProductKeyAuthHandler.ProductClaim)?.Value}:{http.Request.Headers[Actor.Header]}",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1) }));
    // Per product: an error storm is cut off instead of filling the table.
    o.AddPolicy("ingest", http => RateLimitPartition.GetFixedWindowLimiter(
        http.User.FindFirst(ProductKeyAuthHandler.ProductClaim)?.Value ?? "anon",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 600, Window = TimeSpan.FromMinutes(1) }));
});
builder.Services.AddCors(o => o.AddPolicy("public", p => p.AllowAnyOrigin().WithMethods("GET")));
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});
builder.Services.AddProblemDetails();

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();

// The staff surface answers only on the hosts the console reaches the API by (its private address),
// so the public hostname the products call cannot be used to try passwords. Empty = any host (dev).
var staffHosts = (config["Pitwall:StaffHosts"] ?? "")
    .Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
if (staffHosts.Length > 0)
{
    app.Use((http, next) =>
    {
        if (http.Request.Path.StartsWithSegments("/v1/staff")
            && !staffHosts.Contains(http.Request.Host.Host, StringComparer.OrdinalIgnoreCase))
        {
            http.Response.StatusCode = StatusCodes.Status404NotFound;
            return Task.CompletedTask;
        }
        return next(http);
    });
}
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapSupportEndpoints();
app.MapIngestEndpoints();
app.MapPublicEndpoints();
app.MapStaffAuthEndpoints();
app.MapStaffTeamEndpoints();
app.MapStaffTicketEndpoints();
app.MapStaffErrorEndpoints();
app.MapStaffProductEndpoints();
app.MapStaffReleaseEndpoints();

if (!app.Environment.IsEnvironment("Testing"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
    await db.Database.MigrateAsync();
    await Bootstrap.EnsureFirstAdminAsync(db, config, app.Logger);
}

// One-off commands instead of serving: `dotnet Pitwall.Api.dll import-datarunner [--dry-run]`.
if (args.Length > 0 && args[0] == "import-datarunner")
{
    using var scope = app.Services.CreateScope();
    var importer = ActivatorUtilities.CreateInstance<Pitwall.Tools.DataRunnerImporter>(scope.ServiceProvider);
    var result = await importer.RunAsync(args.Contains("--dry-run"), CancellationToken.None);
    Console.WriteLine($"tickets {result.Tickets}, messages {result.Messages}, attachments {result.Attachments} " +
                      $"(missing bytes {result.MissingBlobs}), server errors {result.ServerErrors}, skipped {result.Skipped}");
    return;
}

app.Run();

/// <summary>Entry point marker for WebApplicationFactory in tests.</summary>
public partial class Program;

namespace Pitwall
{
    /// <summary>
    /// The first admin, from configuration, only while the team is empty. After that the console
    /// adds people, and these settings are ignored — remove them from the environment.
    /// </summary>
    public static class Bootstrap
    {
        public static async Task EnsureFirstAdminAsync(PitwallDb db, IConfiguration config, ILogger logger)
        {
            if (await db.Staff.AnyAsync()) return;
            var email = config["Pitwall:Bootstrap:Email"]?.Trim().ToLowerInvariant();
            var password = config["Pitwall:Bootstrap:Password"];
            if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            {
                logger.LogWarning("No staff yet. Set Pitwall__Bootstrap__Email and Pitwall__Bootstrap__Password to create the first admin.");
                return;
            }
            db.Staff.Add(new StaffUser
            {
                Id = Guid.NewGuid(), Email = email, Name = config["Pitwall:Bootstrap:Name"] ?? email.Split('@')[0],
                Role = StaffRoles.Admin, PasswordHash = BCrypt.Net.BCrypt.HashPassword(password, 12),
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
            logger.LogInformation("Created the first admin, {Email}.", email);
        }
    }
}
