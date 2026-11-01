using Pitwall.Services.Storage;
using Xunit;

namespace Pitwall.Tests;

public class AttachmentLimitsTests
{
    [Theory]
    [InlineData("video/mp4", ".mp4")]
    [InlineData("video/webm", ".webm")]
    [InlineData("video/quicktime", ".mov")]
    public void Videos_are_accepted_with_the_larger_limit(string contentType, string extension)
    {
        Assert.True(AttachmentStore.IsAllowedType(contentType));
        Assert.Equal(AttachmentStore.MaxVideoBytes, AttachmentStore.MaxBytesFor(contentType));
        Assert.Equal(extension, AttachmentStore.ExtensionFor(contentType));
    }

    [Fact]
    public void Everything_else_keeps_the_smaller_limit()
    {
        Assert.Equal(AttachmentStore.MaxBytes, AttachmentStore.MaxBytesFor("image/png"));
        Assert.Equal(AttachmentStore.MaxBytes, AttachmentStore.MaxBytesFor("application/gzip"));
    }

    [Theory]
    [InlineData("video/x-msvideo")]
    [InlineData("text/html")]
    [InlineData("image/svg+xml")]
    public void Other_types_stay_refused(string contentType) => Assert.False(AttachmentStore.IsAllowedType(contentType));

    /// <summary>The console goes through Cloudflare, whose free plan refuses bodies over 100 MB.</summary>
    [Fact]
    public void A_video_fits_through_cloudflare() => Assert.True(AttachmentStore.MaxVideoBytes < 100L * 1024 * 1024);
}
