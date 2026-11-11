using Microsoft.AspNetCore.Routing;

namespace Pitwall.Services.Atlas;

/// <summary>
/// The Atlas connectors part, registered from Program.cs. Filled in by its own module; empty until then.
/// </summary>
public static class AtlasConnectorsSetup
{
    public static IServiceCollection AddAtlasConnectors(this IServiceCollection services, IConfiguration config) => services;

    public static IEndpointRouteBuilder MapAtlasConnectors(this IEndpointRouteBuilder app) => app;
}
