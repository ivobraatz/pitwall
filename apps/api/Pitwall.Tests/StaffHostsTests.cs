using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace Pitwall.Tests;

/// <summary>
/// With Pitwall:StaffHosts set, the staff surface exists only on the console's private address:
/// the public hostname the products call says 404, while the product routes keep working there.
/// </summary>
public class StaffHostsTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    [Fact]
    public async Task Staff_routes_answer_only_on_the_configured_hosts()
    {
        var factory = fx.Factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) =>
            c.AddInMemoryCollection(new Dictionary<string, string?> { ["Pitwall:StaffHosts"] = "api, api.railway.internal" })));
        var client = factory.CreateClient();

        async Task<HttpStatusCode> Get(string host, string path)
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, path);
            req.Headers.Host = host;
            return (await client.SendAsync(req)).StatusCode;
        }

        Assert.Equal(HttpStatusCode.NotFound, await Get("api.example.com", "/v1/staff/auth/me"));
        Assert.Equal(HttpStatusCode.NotFound, await Get("api.example.com", "/v1/staff/tickets"));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get("api.railway.internal:8080", "/v1/staff/tickets"));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get("api", "/v1/staff/tickets"));
        Assert.Equal(HttpStatusCode.OK, await Get("api.example.com", "/health"));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get("api.example.com", "/v1/support/config"));
    }
}
