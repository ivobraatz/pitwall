using Microsoft.AspNetCore.Routing;
using Pitwall.Auth;
using Pitwall.Services.Atlas.Graph;

namespace Pitwall.Services.Atlas;

/// <summary>
/// The Atlas graph part, registered from Program.cs: the reads of the map (the graph, a node, impact,
/// attention, coverage, insights, history, snapshots and the diff) and the snapshot taking.
/// </summary>
public static class AtlasGraphSetup
{
    public static IServiceCollection AddAtlasGraph(this IServiceCollection services, IConfiguration config)
    {
        // Registered after the no-op of Program.cs, so this one is the trigger the sync gets.
        services.AddSingleton<IAtlasSnapshotTrigger, AtlasSnapshotRequests>();
        services.AddHostedService<AtlasSnapshotService>();
        return services;
    }

    public static IEndpointRouteBuilder MapAtlasGraph(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/v1/staff/atlas").RequireAuthorization(Policies.Atlas).WithTags("Staff");
        group.MapGet("/graph", AtlasGraphEndpoints.Graph);
        group.MapGet("/graph/company", AtlasGraphEndpoints.CompanyGraph);
        group.MapGet("/nodes/{id:guid}", AtlasGraphEndpoints.NodeDetail);
        group.MapGet("/changes", AtlasGraphEndpoints.Changes);
        group.MapGet("/changesets", AtlasGraphEndpoints.ChangeSets);
        group.MapGet("/events", AtlasGraphEndpoints.Events);
        group.MapGet("/snapshots", AtlasGraphEndpoints.Snapshots);
        group.MapGet("/diff", AtlasGraphEndpoints.Diff);
        group.MapGet("/insights", AtlasGraphEndpoints.Insights);
        group.MapGet("/coverage", AtlasGraphEndpoints.Coverage);
        group.MapGet("/sources", AtlasGraphEndpoints.Sources);
        return app;
    }
}
