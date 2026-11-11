using Pitwall.Auth;

namespace Pitwall.Services.Atlas;

/// <summary>
/// Who is changing the Atlas in this unit of work, for the history. A request on the Atlas routes
/// fills it in from how the caller signed in; the importer, the collectors and the sync set their own.
/// Anything else (a background job, a test) keeps the system default.
/// </summary>
public sealed class AtlasActor
{
    public const string SystemName = "Sistema";
    public const string SystemSource = "system";

    public string Name { get; set; } = SystemName;
    /// <summary><c>console, mcp, import, collector, sync, system</c>.</summary>
    public string Source { get; set; } = SystemSource;
    public Guid? ChangeSetId { get; set; }

    /// <summary>A token is the MCP acting for the person: "Name (Claude)", source mcp. A session is the console.</summary>
    public void FromRequest(HttpContext http)
    {
        var name = http.StaffName();
        if (http.IsToken())
        {
            Name = Clean.Cut($"{name} (Claude)", 120) ?? name;
            Source = "mcp";
        }
        else
        {
            Name = Clean.Cut(name, 120) ?? name;
            Source = "console";
        }
    }
}
