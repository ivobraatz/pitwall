using Microsoft.AspNetCore.Routing;

namespace Pitwall.Services.Atlas;

/// <summary>
/// The Atlas sync part, registered from Program.cs. Filled in by its own module; empty until then.
/// </summary>
public static class AtlasSyncSetup
{
    public static IServiceCollection AddAtlasSync(this IServiceCollection services, IConfiguration config) => services;

    public static IEndpointRouteBuilder MapAtlasSync(this IEndpointRouteBuilder app) => app;
}
