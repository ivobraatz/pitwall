using System.Text.RegularExpressions;
using Pitwall.Auth;
using Pitwall.Services;

namespace Pitwall.Tests;

/// <summary>The rules of the team's board that need no database: codes, order, and input shape.</summary>
public class TeamTaskUnitTests
{
    [Fact]
    public void Code_has_expected_format()
    {
        for (var i = 0; i < 1000; i++)
        {
            var code = TeamTaskCodes.New();
            Assert.Matches(new Regex("^T-[0-9A-HJKMNP-TV-Z]{5}$"), code);
            Assert.True(TeamTaskCodes.IsCode(code));
            Assert.True(TeamTaskCodes.IsCode(code.ToLowerInvariant()));
        }
        Assert.False(TeamTaskCodes.IsCode("T-7K2Q"));
        Assert.False(TeamTaskCodes.IsCode("T-7K2QI"));
        Assert.False(TeamTaskCodes.IsCode("20261016-7K3Q"));
        Assert.False(TeamTaskCodes.IsCode(Guid.NewGuid().ToString()));
    }

    [Fact]
    public void Code_never_matches_ticket_regex()
    {
        // Codes alone, and the way they turn up in a commit message.
        for (var i = 0; i < 10_000; i++)
        {
            var code = TeamTaskCodes.New();
            Assert.Empty(TicketCodes.FindIn(code));
            Assert.Empty(TicketCodes.FindIn($"fix(oauth): callback no painel ({code}, 2026)"));
        }
    }

    [Fact]
    public void Position_top_bottom_and_between()
    {
        Assert.Equal(1024, TeamTaskPositions.Top(null));
        Assert.Equal(1024, TeamTaskPositions.Bottom(null));
        Assert.Equal(-1024 + 10, TeamTaskPositions.Top(10));
        Assert.Equal(1034, TeamTaskPositions.Bottom(10));
        Assert.Equal(1536, TeamTaskPositions.Between(1024, 2048));
        Assert.Equal(1536, TeamTaskPositions.Between(2048, 1024));

        Assert.Equal(1024, TeamTaskPositions.Place(null, null));
        Assert.Equal(0, TeamTaskPositions.Place(null, 1024));
        Assert.Equal(3072, TeamTaskPositions.Place(2048, null));
        Assert.Equal(1536, TeamTaskPositions.Place(1024, 2048));
        Assert.Equal([1024d, 2048d, 3072d], TeamTaskPositions.Renumber(3));
    }

    [Fact]
    public void Position_requests_reindex_when_gap_too_small()
    {
        Assert.True(TeamTaskPositions.NeedsReindex(1, 1 + 1e-7));
        Assert.True(TeamTaskPositions.NeedsReindex(5, 5));
        Assert.False(TeamTaskPositions.NeedsReindex(1, 1 + 1e-5));
        Assert.Null(TeamTaskPositions.Place(1, 1 + 1e-7));

        // Halving the same gap over and over must end up asking for a renumbering, not colliding.
        double a = 1024, b = 2048;
        var drops = 0;
        while (TeamTaskPositions.Place(a, b) is { } p)
        {
            Assert.True(p > a && p < b);
            b = p;
            drops++;
        }
        Assert.InRange(drops, 20, 60);
    }

    [Fact]
    public void Labels_are_normalized_and_limited()
    {
        var (labels, error) = TeamTaskInput.Labels(["  OAuth ", "teste no celular", "oauth", "", null, "meta_ads"]);
        Assert.Null(error);
        Assert.Equal(["oauth", "teste-no-celular", "meta-ads"], labels);

        Assert.NotNull(TeamTaskInput.Labels(["configuração"]).Error);
        Assert.NotNull(TeamTaskInput.Labels([new string('a', 33)]).Error);
        Assert.Null(TeamTaskInput.Labels([new string('a', 32)]).Error);
        Assert.NotNull(TeamTaskInput.Labels(Enumerable.Range(0, 11).Select(i => $"l{i}")).Error);
        Assert.Null(TeamTaskInput.Labels(Enumerable.Range(0, 10).Select(i => $"l{i}")).Error);
    }

    [Fact]
    public void Checklist_keeps_ids_and_numbers_new_items()
    {
        var (items, error) = TeamTaskInput.Checklist([
            new("c2", "Salvar domínio", true), new(null, "Testar login", null), new("c2", "Repetido", false),
        ]);
        Assert.Null(error);
        Assert.Equal(["c2", "c3", "c4"], items.Select(i => i.Id));
        Assert.True(items[0].Done);
        Assert.False(items[1].Done);

        Assert.NotNull(TeamTaskInput.Checklist([new(null, "  ", false)]).Error);
        Assert.NotNull(TeamTaskInput.Checklist(Enumerable.Range(0, 51).Select(i => new TeamTaskInput.ChecklistInput(null, $"i{i}", false))).Error);
        Assert.Equal(300, TeamTaskInput.Checklist([new(null, new string('x', 400), false)]).Items[0].Text.Length);
    }

    [Fact]
    public void Links_accept_only_http_and_https()
    {
        var (links, error) = TeamTaskInput.Links([new("PR", "https://example.com/pr/1"), new(null, "http://example.com/doc")]);
        Assert.Null(error);
        Assert.Equal("PR", links[0].Label);
        Assert.Equal("example.com", links[1].Label);

        Assert.NotNull(TeamTaskInput.Links([new("x", "javascript:alert(1)")]).Error);
        Assert.NotNull(TeamTaskInput.Links([new("x", "/relativo")]).Error);
        Assert.NotNull(TeamTaskInput.Links([new("x", "ftp://example.com")]).Error);
    }

    [Fact]
    public void Staff_token_has_its_own_prefix()
    {
        var token = Tokens.NewStaffToken();
        Assert.StartsWith("pwt_", token);
        Assert.Equal(44, token.Length);
        Assert.False(token.StartsWith("pw_", StringComparison.Ordinal));
    }
}
