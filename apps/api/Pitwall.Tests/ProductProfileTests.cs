using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Pitwall.Auth;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Storage;

namespace Pitwall.Tests;

/// <summary>What the team fills in about a product (site, colour, owner, logo) and how the console reads the logo back.</summary>
public class ProductProfileTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==");

    private async Task<(HttpClient Client, Guid AdminId)> SignInAsAdminAsync()
    {
        var email = $"admin-{Guid.NewGuid():N}@pitwall.test";
        var admin = new StaffUser
        {
            Id = Guid.NewGuid(), Email = email, Name = "Ana Admin", Role = StaffRoles.Admin,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("senha-de-teste", 4), CreatedAt = DateTime.UtcNow,
        };
        using (var scope = fx.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
            db.Staff.Add(admin);
            await db.SaveChangesAsync();
        }
        var client = fx.Factory.CreateClient();
        client.DefaultRequestHeaders.Add(StaffSessionAuthHandler.CsrfHeader, "1");
        var login = await client.PostAsJsonAsync("/v1/staff/auth/login", new { email, password = "senha-de-teste" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return (client, admin.Id);
    }

    private static MultipartFormDataContent Upload(byte[] bytes, string contentType, string name)
    {
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return new MultipartFormDataContent { { file, "file", name } };
    }

    [Fact]
    public async Task Site_colour_and_owner_are_saved_and_checked()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (admin, adminId) = await SignInAsAdminAsync();

        var res = await admin.PatchAsJsonAsync($"/v1/staff/products/{product.Id}",
            new { websiteUrl = "https://acme.example", color = "#2CC4C9", ownerId = adminId.ToString() });
        var view = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("https://acme.example", view.GetProperty("websiteUrl").GetString());
        Assert.Equal("#2cc4c9", view.GetProperty("color").GetString());
        Assert.Equal("Ana Admin", view.GetProperty("owner").GetProperty("name").GetString());

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PatchAsJsonAsync($"/v1/staff/products/{product.Id}", new { color = "red" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PatchAsJsonAsync($"/v1/staff/products/{product.Id}", new { websiteUrl = "javascript:alert(1)" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PatchAsJsonAsync($"/v1/staff/products/{product.Id}", new { ownerId = Guid.NewGuid().ToString() })).StatusCode);

        // An empty string clears; a field left out stays.
        view = await (await admin.PatchAsJsonAsync($"/v1/staff/products/{product.Id}", new { color = "" })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, view.GetProperty("color").ValueKind);
        Assert.Equal("https://acme.example", view.GetProperty("websiteUrl").GetString());
        Assert.Equal("Ana Admin", view.GetProperty("owner").GetProperty("name").GetString());
    }

    [Fact]
    public async Task A_logo_is_stored_served_under_a_versioned_url_and_removed()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (admin, _) = await SignInAsAdminAsync();

        var put = await admin.PutAsync($"/v1/staff/products/{product.Id}/logo", Upload(Png, "image/png", "logo.png"));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var logoUrl = (await put.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("logoUrl").GetString();
        Assert.StartsWith($"/v1/staff/products/{product.Id}/logo?v=", logoUrl);

        var get = await admin.GetAsync(logoUrl);
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        Assert.Equal("image/png", get.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Png, await get.Content.ReadAsByteArrayAsync());
        Assert.Contains("immutable", get.Headers.CacheControl?.ToString());

        // Only someone signed in to the console reads it.
        Assert.Equal(HttpStatusCode.Unauthorized, (await fx.Factory.CreateClient().GetAsync(logoUrl)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/v1/staff/products/{product.Id}/logo")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync(logoUrl)).StatusCode);
    }

    [Fact]
    public async Task A_logo_is_judged_by_its_bytes_not_by_its_label()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (admin, _) = await SignInAsAdminAsync();
        var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"u8.ToArray();

        var res = await admin.PutAsync($"/v1/staff/products/{product.Id}/logo", Upload(svg, "image/png", "logo.png"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);

        var big = new byte[ProductLogos.MaxBytes + 1];
        Png.CopyTo(big, 0);
        res = await admin.PutAsync($"/v1/staff/products/{product.Id}/logo", Upload(big, "image/png", "logo.png"));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
    }

    [Theory]
    [InlineData(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0 }, "image/png")]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }, "image/jpeg")]
    [InlineData(new byte[] { 0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50 }, "image/webp")]
    [InlineData(new byte[] { 0x3C, 0x73, 0x76, 0x67 }, null)]
    [InlineData(new byte[] { 0x47, 0x49, 0x46, 0x38 }, null)]
    public void Sniff_knows_only_png_jpeg_and_webp(byte[] head, string? expected) =>
        Assert.Equal(expected, ProductLogos.Sniff(head));
}
