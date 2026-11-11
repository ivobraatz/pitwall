using Pitwall.Services.Atlas.Sync;

namespace Pitwall.Tests;

/// <summary>The history credits a sync to the tool that sent it, not to Claude by default.</summary>
public class AtlasSyncActorTests
{
    [Theory]
    [InlineData("Ana (Claude)", "cli", null, "Ana (CLI)")]
    [InlineData("Ana (Claude)", "ci", null, "Ana (CI)")]
    [InlineData("Ana (Claude)", "git-hook", null, "Ana (git hook)")]
    [InlineData("Ana (Claude)", "agent", "claude-code", "Ana (claude-code)")]
    [InlineData("Ana (Claude)", "ci", "github-actions", "Ana (github-actions)")]
    [InlineData("Ana (Claude)", "agent", null, "Ana (agente)")]
    [InlineData("Ana (Claude)", "github-scan", null, "Ana (Claude)")]
    [InlineData("Ana", "github-scan", null, "Ana")]
    public void Names_the_sending_tool(string name, string source, string? tool, string expected) =>
        Assert.Equal(expected, AtlasSyncService.ActorName(name, source, tool));
}
