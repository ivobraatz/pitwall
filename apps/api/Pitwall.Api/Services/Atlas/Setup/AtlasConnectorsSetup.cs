using Microsoft.AspNetCore.Routing;

namespace Pitwall.Services.Atlas;

/// <summary>
/// The Atlas connectors part, registered from Program.cs after the collectors of the first versions. Here:
/// the Cloudflare collector, the GitHub credential (the App when it is configured, else the token), the
/// repository list for the console, and the GitHub webhook.
/// </summary>
public static class AtlasConnectorsSetup
{
    public static IServiceCollection AddAtlasConnectors(this IServiceCollection services, IConfiguration config)
    {
        // Registered after the token's own: the last registration wins, so every resolution of the credential gets the App when it is set.
        services.AddSingleton<IAtlasGitHubAuth>(sp => ChooseGitHubAuth(config, AtlasHttp(sp)));
        services.AddSingleton<IAtlasCollector>(sp => new CloudflareCollector(AtlasHttp(sp), config["Atlas:Cloudflare:Token"], config["Atlas:Cloudflare:AccountId"]));
        return services;
    }

    /// <summary>The App when its three settings are there; otherwise the personal token. The key is never printed.</summary>
    public static IAtlasGitHubAuth ChooseGitHubAuth(IConfiguration config, HttpClient http)
    {
        var app = new AppGitHubAuth(http, config["Atlas:GitHub:AppId"], config["Atlas:GitHub:PrivateKey"], config["Atlas:GitHub:InstallationId"]);
        return app.Configured ? app : new PatGitHubAuth(config["Atlas:GitHub:Token"]);
    }

    public static IEndpointRouteBuilder MapAtlasConnectors(this IEndpointRouteBuilder app)
    {
        app.MapGitHubWebhook();
        app.MapStaffGitHubRepos();
        return app;
    }

    private static HttpClient AtlasHttp(IServiceProvider sp) => sp.GetRequiredService<IHttpClientFactory>().CreateClient("atlas");
}
