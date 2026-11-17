using System.Text.RegularExpressions;
using Pitwall.Domain;
using Pitwall.Services;

namespace Pitwall.Tests;

/// <summary>What a note becomes as a task, and how ready it is: pure rules, no database.</summary>
public class NoteToTaskTests
{
    private const string Code = "N-7K2QM";

    private static Note NoteWith(string title, string body, Product? product = null) => new()
    {
        Id = Guid.NewGuid(), Code = Code, Title = title, Body = body, Product = product,
        ProductId = product?.Id, CreatedByRef = "r", CreatedByName = "Ana", UpdatedByName = "Ana",
    };

    private static string Words(int n) => string.Join(' ', Enumerable.Repeat("palavra", n));

    [Fact]
    public void Draft_takes_the_checklist_with_its_done_flags_and_keeps_the_rest_of_the_body()
    {
        var note = NoteWith("Configurar callback OAuth", "Contexto curto.\n\n## Passos\n- [ ] Abrir o painel\n* [x] Salvar o domínio\n\nVer [[N-AB12C]] depois.");
        var draft = NoteToTask.Draft(note);

        Assert.Equal("Configurar callback OAuth", draft.Title);
        Assert.Equal(["Abrir o painel", "Salvar o domínio"], draft.Checklist);
        Assert.Equal([false, true], draft.ChecklistDone);
        Assert.DoesNotContain("- [ ]", draft.Body);
        Assert.DoesNotContain("Salvar o domínio", draft.Body);
        Assert.Contains("Ver [[N-AB12C]] depois.", draft.Body);
        Assert.EndsWith($"\n\n---\nOrigem: anotação {Code}", draft.Body);
    }

    [Fact]
    public void Links_come_from_markdown_first_then_bare_urls_once_each()
    {
        var note = NoteWith("Título com três palavras", "[Doc](https://docs.exemplo.com/a) e https://docs.exemplo.com/a e https://exemplo.com/b. Fim.");
        var links = NoteToTask.Draft(note).Links;

        Assert.Equal(2, links.Length);
        Assert.Equal(new NoteLink("Doc", "https://docs.exemplo.com/a"), links[0]);
        // The bare URL of the first link is not a second entry; the trailing period is not part of the URL.
        Assert.Equal(new NoteLink("exemplo.com", "https://exemplo.com/b"), links[1]);
    }

    [Fact]
    public void Links_stop_at_twenty()
    {
        var body = string.Join(' ', Enumerable.Range(0, 30).Select(i => $"https://exemplo.com/{i}"));
        Assert.Equal(20, NoteToTask.Draft(NoteWith("Muitos links aqui", body)).Links.Length);
    }

    [Fact]
    public void Full_structure_scores_100_and_is_ready()
    {
        var product = new Product { Id = Guid.NewGuid(), Slug = "demo", Name = "Demo" };
        var note = NoteWith("Configurar callback OAuth", $"{Words(40)}\n\n## Passos\n- [ ] Abrir\n\n## Como verificar\nLogin ok.", product);
        var draft = NoteToTask.Draft(note);

        Assert.Equal(100, draft.Readiness.Score);
        Assert.True(draft.Readiness.Ready);
        Assert.Empty(draft.Readiness.Missing);
        Assert.Equal("demo", draft.ProductSlug);
    }

    [Fact]
    public void A_thin_note_scores_zero_and_names_every_gap()
    {
        var draft = NoteToTask.Draft(NoteWith("Ideia solta", ""));

        Assert.Equal(0, draft.Readiness.Score);
        Assert.False(draft.Readiness.Ready);
        Assert.Equal(
            ["Título curto demais: diga a ação no imperativo.",
             "Explique o porquê e o contexto no corpo.",
             "Liste os passos como checklist (- [ ] passo).",
             "Diga como verificar que deu certo (## Como verificar).",
             "Escolha o sistema."],
            draft.Readiness.Missing);
        Assert.Null(draft.ProductSlug);
    }

    [Fact]
    public void Without_steps_the_score_is_75_which_is_ready_and_still_names_the_steps()
    {
        var product = new Product { Id = Guid.NewGuid(), Slug = "demo", Name = "Demo" };
        var draft = NoteToTask.Draft(NoteWith("Configurar callback OAuth", $"{Words(40)}\n\n## Como verificar\nLogin ok.", product));

        Assert.Equal(75, draft.Readiness.Score);
        Assert.True(draft.Readiness.Ready);
        Assert.Equal(["Liste os passos como checklist (- [ ] passo)."], draft.Readiness.Missing);
    }

    [Fact]
    public void A_verification_heading_counts_with_or_without_accents()
    {
        var product = new Product { Id = Guid.NewGuid(), Slug = "demo", Name = "Demo" };
        var draft = NoteToTask.Draft(NoteWith("Configurar callback OAuth", $"{Words(40)}\n\n## Critério de aceite\nOK.", product));

        Assert.DoesNotContain("Diga como verificar que deu certo (## Como verificar).", draft.Readiness.Missing);
    }

    [Fact]
    public void Checklist_stops_at_fifty_items_and_the_rest_stays_in_the_body()
    {
        var lines = string.Join('\n', Enumerable.Range(1, 55).Select(i => $"- [ ] passo {i}"));
        var draft = NoteToTask.Draft(NoteWith("Passos demais aqui", lines));

        Assert.Equal(50, draft.Checklist.Length);
        Assert.Contains("- [ ] passo 51", draft.Body);
        Assert.DoesNotContain("- [ ] passo 50", draft.Body);
    }

    [Fact]
    public void Checklist_text_is_cut_at_300_characters()
    {
        var draft = NoteToTask.Draft(NoteWith("Texto longo do passo", "- [ ] " + new string('x', 400)));
        Assert.Equal(300, draft.Checklist[0].Length);
    }

    [Fact]
    public void A_long_body_is_cut_to_20000_and_the_origin_footer_is_kept()
    {
        var draft = NoteToTask.Draft(NoteWith("Corpo muito grande", new string('a', 30_000)));

        Assert.True(draft.Body.Length <= 20_000);
        Assert.EndsWith($"\n\n---\nOrigem: anotação {Code}", draft.Body);
    }

    [Fact]
    public void Codes_have_their_own_shape_and_never_look_like_a_task_or_a_ticket()
    {
        var shape = new Regex("^N-[0-9A-HJKMNP-TV-Z]{5}$");
        for (var i = 0; i < 1000; i++)
        {
            var code = NoteCodes.New();
            Assert.Matches(shape, code);
            Assert.True(NoteCodes.IsCode(code.ToLowerInvariant()));
            Assert.False(TeamTaskCodes.IsCode(code));
            Assert.Empty(TicketCodes.FindIn(code));
        }
        Assert.Equal(["N-7K2QM"], NoteCodes.LinksIn("[[n-7k2qm]] [[N-7K2QM]] [[T-7K2QM]]"));
    }
}
