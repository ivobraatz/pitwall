using Microsoft.AspNetCore.Routing;

namespace Pitwall.Services.Atlas;

/// <summary>
/// The Atlas graph part, registered from Program.cs. Filled in by its own module; empty until then.
/// </summary>
public static class AtlasGraphSetup
{
    public static IServiceCollection AddAtlasGraph(this IServiceCollection services, IConfiguration config) => services;

    public static IEndpointRouteBuilder MapAtlasGraph(this IEndpointRouteBuilder app) => app;
}
