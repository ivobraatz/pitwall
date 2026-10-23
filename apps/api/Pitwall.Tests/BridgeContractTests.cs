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
    public void Api_reads_the_actor_the_package_writes()
    {
        var http = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        http.Request.Headers[ApiActor.Header] = new PitwallActor("ws-7", "Ótica Visão", "u-3", "José", "jose@x.test").Encode();
        Assert.Equal(new ApiActor("ws-7", "Ótica Visão", "u-3", "José", "jose@x.test"), ApiActor.From(http));
    }
}
