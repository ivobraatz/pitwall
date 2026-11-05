using Pitwall.AspNetCore;
using Pitwall.Services.Webhooks;
using ApiActor = Pitwall.Auth.Actor;

namespace Pitwall.Tests;

/// <summary>The client package and the API must agree byte for byte on what they exchange.</summary>
public class BridgeContractTests
{
    [Fact]
    public void Package_verifies_what_the_api_signs()
    {
        var now = DateTimeOffset.UtcNow;
        var header = WebhookSigner.Sign("pwhs_secret", now.ToUnixTimeSeconds(), "{\"type\":\"ping\"}");
        Assert.True(PitwallWebhooks.Verify("pwhs_secret", header, "{\"type\":\"ping\"}", now));
        Assert.False(PitwallWebhooks.Verify("pwhs_other", header, "{\"type\":\"ping\"}", now));
        Assert.False(PitwallWebhooks.Verify("pwhs_secret", header, "{\"type\":\"pong\"}", now));
        Assert.False(PitwallWebhooks.Verify("pwhs_secret", header, "{\"type\":\"ping\"}", now.AddMinutes(10)));
    }

    [Fact]
    public async Task Bridge_answers_502_quickly_when_Pitwall_connects_and_stays_silent()
    {
        var silent = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        silent.Start();
        try
        {
            var port = ((System.Net.IPEndPoint)silent.LocalEndpoint).Port;
            var services = new Microsoft.Extensions.DependencyInjection.ServiceCollection();
            Microsoft.Extensions.DependencyInjection.LoggingServiceCollectionExtensions.AddLogging(services);
            services.AddPitwall(o =>
            {
                o.BaseUrl = $"http://127.0.0.1:{port}";
                o.ApiKey = "pw_x_key";
                o.SupportReadTimeout = TimeSpan.FromMilliseconds(200);
            });
            await using var provider = Microsoft.Extensions.DependencyInjection.ServiceCollectionContainerBuilderExtensions.BuildServiceProvider(services);

            var http = new Microsoft.AspNetCore.Http.DefaultHttpContext { RequestServices = provider };
            http.Request.Method = "GET";
            http.Response.Body = new MemoryStream();

            var clock = System.Diagnostics.Stopwatch.StartNew();
            await PitwallBridge.ForwardAsync(http, "tickets",
                _ => ValueTask.FromResult<PitwallActor?>(new PitwallActor("ws-7", "Ótica Visão", "u-3", "José", "jose@x.test")));

            Assert.Equal(502, http.Response.StatusCode);
            Assert.True(clock.Elapsed < TimeSpan.FromSeconds(5), $"took {clock.Elapsed}");
        }
        finally
        {
            silent.Stop();
        }
    }

    [Fact]
    public void Api_reads_the_actor_the_package_writes()
    {
        var http = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        http.Request.Headers[ApiActor.Header] = new PitwallActor("ws-7", "Ótica Visão", "u-3", "José", "jose@x.test").Encode();
        Assert.Equal(new ApiActor("ws-7", "Ótica Visão", "u-3", "José", "jose@x.test"), ApiActor.From(http));
    }
}
