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

/// <summary>Any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO). The bucket must not be public.</summary>
public sealed class S3BlobStore(IAmazonS3 s3, string bucket) : IBlobStore
{
    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken ct)
    {
        // S3 wants a length or a seekable stream; uploads are capped at 25 MB, so buffering is fine.
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
            // R2 and MinIO reject the streaming-signature extensions the SDK uses by default.
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
        _ => ".bin",
    };

    /// <summary>Images, text, PDFs and the recording formats the SDK produces. Never HTML or SVG: those would execute.</summary>
    public static bool IsAllowedType(string? contentType) => contentType?.ToLowerInvariant() is
        "image/png" or "image/jpeg" or "image/webp" or "image/gif"
        or "application/gzip" or "application/json" or "text/plain" or "text/csv" or "application/pdf";
}
