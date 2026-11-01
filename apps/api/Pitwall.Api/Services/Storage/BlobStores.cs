using Amazon.S3;
using Amazon.S3.Model;

namespace Pitwall.Services.Storage;

/// <summary>Where attachment bytes live. Private by construction: nothing here produces a public URL.</summary>
public interface IBlobStore
{
    Task PutAsync(string key, Stream content, string contentType, CancellationToken ct);
    Task<Stream?> GetAsync(string key, CancellationToken ct);
    Task DeleteAsync(string key, CancellationToken ct);
}

/// <summary>A directory on disk. For development and single-box installs with a persistent volume.</summary>
public sealed class FileSystemBlobStore(string root) : IBlobStore
{
    private string PathFor(string key)
    {
        // Keys are built by AttachmentStore from GUIDs; this is a guard, not the validation.
        if (key.Contains("..", StringComparison.Ordinal) || Path.IsPathRooted(key))
            throw new ArgumentException("Invalid storage key.", nameof(key));
        return Path.Combine(root, key.Replace('/', Path.DirectorySeparatorChar));
    }

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken ct)
    {
        var path = PathFor(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var file = File.Create(path);
        await content.CopyToAsync(file, ct);
    }

    public Task<Stream?> GetAsync(string key, CancellationToken ct)
    {
        var path = PathFor(key);
        return Task.FromResult<Stream?>(File.Exists(path) ? File.OpenRead(path) : null);
    }

    public Task DeleteAsync(string key, CancellationToken ct)
    {
        var path = PathFor(key);
        if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }
}

/// <summary>Any S3-compatible bucket (SeaweedFS, AWS S3, Cloudflare R2). The bucket must not be public.</summary>
public sealed class S3BlobStore(IAmazonS3 s3, string bucket) : IBlobStore
{
    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken ct)
    {
        // S3 wants a length or a seekable stream. Uploads arrive seekable (the form is buffered to disk); this is the fallback.
        Stream body = content;
        if (!content.CanSeek)
        {
            var buffer = new MemoryStream();
            await content.CopyToAsync(buffer, ct);
            buffer.Position = 0;
            body = buffer;
        }
        await s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = bucket, Key = key, InputStream = body, ContentType = contentType,
            // R2 rejects the streaming-signature extensions the SDK uses by default.
            UseChunkEncoding = false,
        }, ct);
    }

    public async Task<Stream?> GetAsync(string key, CancellationToken ct)
    {
        try
        {
            var res = await s3.GetObjectAsync(bucket, key, ct);
            return res.ResponseStream;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public Task DeleteAsync(string key, CancellationToken ct) => s3.DeleteObjectAsync(bucket, key, ct);

    /// <summary>
    /// Creates the bucket when it is missing, for the SeaweedFS that ships with the compose file. Waits for
    /// the server, which may still be starting. Failing here stops the API on purpose: better than
    /// looking healthy and losing every attachment.
    /// </summary>
    public async Task EnsureBucketAsync(ILogger logger, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await s3.PutBucketAsync(new PutBucketRequest { BucketName = bucket }, ct);
                logger.LogInformation("Created the attachments bucket {Bucket}.", bucket);
                return;
            }
            catch (AmazonS3Exception ex) when (ex.ErrorCode is "BucketAlreadyOwnedByYou" or "BucketAlreadyExists") { return; }
            catch (Exception ex) when (ex is not OperationCanceledException && attempt < 30)
            {
                logger.LogInformation("Bucket {Bucket} not ready yet ({Reason}); trying again.", bucket, ex.Message);
                await Task.Delay(TimeSpan.FromSeconds(2), ct);
            }
        }
    }
}

/// <summary>
/// Ticket evidence on top of the blob store: the key layout, the allowed types, the size cap.
/// A recording shows a customer's screen, so it is stored like the rest of their data — under
/// the product and ticket it belongs to, readable only through an endpoint that checked both.
/// </summary>
public sealed class AttachmentStore(IBlobStore blobs, ILogger<AttachmentStore> logger)
{
    /// <summary>25 MB. A two-minute DOM recording gzips to well under 2 MB; this leaves room for screenshots and logs.</summary>
    public const long MaxBytes = 25L * 1024 * 1024;

    /// <summary>90 MB for a video. The console sits behind Cloudflare, whose free plan refuses bodies over 100 MB.</summary>
    public const long MaxVideoBytes = 90L * 1024 * 1024;

    public static bool IsVideo(string? contentType) => contentType?.ToLowerInvariant() is "video/mp4" or "video/webm" or "video/quicktime";

    public static long MaxBytesFor(string? contentType) => IsVideo(contentType) ? MaxVideoBytes : MaxBytes;

    /// <summary>Recordings are purged this long after the ticket closes; the conversation stays.</summary>
    public static readonly TimeSpan RecordingRetentionAfterClose = TimeSpan.FromDays(90);

    public static string Key(Guid productId, Guid ticketId, Guid attachmentId, string? contentType) =>
        $"tickets/{productId:N}/{ticketId:N}/{attachmentId:N}{ExtensionFor(contentType)}";

    public Task PutAsync(string key, Stream content, string contentType, CancellationToken ct) =>
        blobs.PutAsync(key, content, contentType, ct);

    public Task<Stream?> GetAsync(string key, CancellationToken ct) => blobs.GetAsync(key, ct);

    /// <summary>Best effort: the row goes first, and an orphaned object is only wasted space.</summary>
    public async Task DeleteAsync(string key, CancellationToken ct)
    {
        try { await blobs.DeleteAsync(key, ct); }
        catch (Exception ex) { logger.LogWarning(ex, "Could not delete attachment {Key}.", key); }
    }

    public static string ExtensionFor(string? contentType) => contentType?.ToLowerInvariant() switch
    {
        "image/png" => ".png",
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "application/gzip" => ".json.gz",
        "application/json" => ".json",
        "text/plain" => ".txt",
        "text/csv" => ".csv",
        "application/pdf" => ".pdf",
        "video/mp4" => ".mp4",
        "video/webm" => ".webm",
        "video/quicktime" => ".mov",
        _ => ".bin",
    };

    /// <summary>Images, videos, text, PDFs and the recording formats the SDK produces. Never HTML or SVG: those would execute.</summary>
    public static bool IsAllowedType(string? contentType) => IsVideo(contentType) || contentType?.ToLowerInvariant() is
        "image/png" or "image/jpeg" or "image/webp" or "image/gif"
        or "application/gzip" or "application/json" or "text/plain" or "text/csv" or "application/pdf";
}

/// <summary>
/// A product's logo on top of the blob store. Raster only, checked by its first bytes rather than
/// by what the browser claims: an SVG could carry script, and the console shows logos on every page.
/// </summary>
public static class ProductLogos
{
    /// <summary>512 KB. A logo is shown at 64px at most; anything bigger is a photo by mistake.</summary>
    public const long MaxBytes = 512 * 1024;

    public static string Key(Guid productId) => $"products/{productId:N}/logo";

    /// <summary>The image type the bytes actually are (PNG, JPEG or WebP), or null for anything else.</summary>
    public static string? Sniff(ReadOnlySpan<byte> head)
    {
        if (head.StartsWith((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return "image/png";
        if (head.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF])) return "image/jpeg";
        if (head.Length >= 12 && head[..4].SequenceEqual("RIFF"u8) && head[8..12].SequenceEqual("WEBP"u8)) return "image/webp";
        return null;
    }
}
