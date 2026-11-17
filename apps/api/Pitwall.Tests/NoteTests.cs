using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Pitwall.Domain;
using static Pitwall.Tests.TeamTaskKit;

namespace Pitwall.Tests;

/// <summary>
/// The team's notes through their API: what a note, its folders and its history do, how a
/// conversion turns it into a task, and what the token scopes allow. Every name is made up.
/// </summary>
public class NoteTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private static readonly Regex CodeShape = new("^N-[0-9A-HJKMNP-TV-Z]{5}$");

    /// <summary>A body with 40+ words of context, the steps as a checklist, a verification section and two links.</summary>
    private const string StructuredBody = """
        Contexto: o login com OAuth falha quando o domínio de retorno não está cadastrado no painel do provedor. Isso acontece depois da troca de domínio e só aparece em produção, por isso a equipe demorou a perceber o problema no atendimento da semana.

        ## Passos
        - [ ] Abrir o painel do provedor
        - [x] Salvar o domínio de retorno
        - [ ] Testar o login no celular

        Veja [Documentação](https://docs.exemplo.com/oauth) e https://status.exemplo.com.

        ## Como verificar
        Login completo no celular, sem erro de redirecionamento.
        """;

    private static async Task<JsonElement> CreateNoteAsync(HttpClient c, object body)
    {
        var res = await c.PostAsJsonAsync("/v1/staff/notes", body);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return await res.Json();
    }

    private static async Task<string> FolderAsync(HttpClient c, string name, string? parentId = null)
    {
        var res = await c.PostAsJsonAsync("/v1/staff/notes/folders", new { name, parentId });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Json()).GetProperty("id").GetString()!;
    }

    private static async Task<JsonElement> DetailAsync(HttpClient c, string code)
    {
        var res = await c.GetAsync($"/v1/staff/notes/{code}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Json();
    }

    [Fact]
    public async Task Create_list_read_and_edit_a_note()
    {
        var (c, _) = await SignInAsync(fx, "Ana");
        var note = await CreateNoteAsync(c, new { title = "  Ideia de cobrança  ", body = "Corpo inicial", labels = new[] { "Pagamentos", "teste no celular" } });
        var code = note.GetProperty("code").GetString()!;
        Assert.Matches(CodeShape, code);
        Assert.Equal("Ideia de cobrança", note.GetProperty("title").GetString());
        Assert.Equal("idea", note.GetProperty("stage").GetString());
        Assert.Equal(["pagamentos", "teste-no-celular"], note.GetProperty("labels").EnumerateArray().Select(l => l.GetString()));
        Assert.Equal("Ana", note.GetProperty("createdBy").GetProperty("name").GetString());
        Assert.Equal("manual", note.GetProperty("source").GetString());
        Assert.Equal(JsonValueKind.Null, note.GetProperty("folder").ValueKind);
        Assert.Equal("", note.GetProperty("folderPath").GetString());

        var list = await (await c.GetAsync("/v1/staff/notes?q=cobran")).Json();
        var item = list.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("code").GetString() == code);
        Assert.False(item.TryGetProperty("body", out _));
        Assert.Equal("Corpo inicial", item.GetProperty("excerpt").GetString());

        var detail = await DetailAsync(c, code.ToLowerInvariant());
        Assert.Equal("Corpo inicial", detail.GetProperty("body").GetString());

        // Append adds to the end, after a blank line; a body and an append in one request is refused.
        var appended = await (await c.PatchAsJsonAsync($"/v1/staff/notes/{code}", new { append = "Achado: o webhook repete o evento." })).Json();
        Assert.Equal("Corpo inicial\n\nAchado: o webhook repete o evento.", appended.GetProperty("body").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PatchAsJsonAsync($"/v1/staff/notes/{code}", new { body = "x", append = "y" })).StatusCode);

        // Someone else saved since the version the editor holds: refused, with the message the console shows.
        var stale = appended.GetProperty("updatedAt").GetDateTime();
        Assert.Equal(HttpStatusCode.OK, (await c.PatchAsJsonAsync($"/v1/staff/notes/{code}", new { pinned = true })).StatusCode);
        var conflict = await c.PatchAsJsonAsync($"/v1/staff/notes/{code}", new { title = "Outra", ifUpdatedAt = stale });
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Equal("A anotação mudou. Recarregue.", (await conflict.Json()).GetProperty("message").GetString());
    }

    [Fact]
    public async Task Stage_converted_is_only_set_by_the_conversion()
    {
        var (c, _) = await SignInAsync(fx);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/v1/staff/notes", new { title = "x", stage = "converted" })).StatusCode);
        var code = (await CreateNoteAsync(c, new { title = "Achado simples" })).GetProperty("code").GetString()!;
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PatchAsJsonAsync($"/v1/staff/notes/{code}", new { stage = "converted" })).StatusCode);
        var shaped = await (await c.PatchAsJsonAsync($"/v1/staff/notes/{code}", new { stage = "shaping" })).Json();
        Assert.Equal("shaping", shaped.GetProperty("stage").GetString());
    }

    [Fact]
    public async Task Folders_nest_refuse_cycles_and_a_fifth_level()
    {
        var (c, _) = await SignInAsync(fx);
        var a = await FolderAsync(c, "Ideias");
        var b = await FolderAsync(c, "Pagamentos", a);
        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsJsonAsync("/v1/staff/notes/folders", new { name = "Pagamentos", parentId = a })).StatusCode);

        // A folder cannot go into itself or into its own subfolder.
        var cycle = await c.PatchAsJsonAsync($"/v1/staff/notes/folders/{a}", new { parentId = b });
        Assert.Equal(HttpStatusCode.BadRequest, cycle.StatusCode);
        Assert.Equal("Uma pasta não pode ir para dentro dela mesma.", (await cycle.Json()).GetProperty("message").GetString());

        // Four levels are fine; the fifth is not.
        var l3 = await FolderAsync(c, "Nível 3", b);
        var l4 = await FolderAsync(c, "Nível 4", l3);
        var fifth = await c.PostAsJsonAsync("/v1/staff/notes/folders", new { name = "Nível 5", parentId = l4 });
        Assert.Equal(HttpStatusCode.BadRequest, fifth.StatusCode);
        Assert.Equal("No máximo 4 níveis de pastas.", (await fifth.Json()).GetProperty("message").GetString());

        // Moving a folder that has three levels under one with two would make five.
        var solo = await FolderAsync(c, "Sozinha");
        var deep = await FolderAsync(c, "Pai", solo);
        await FolderAsync(c, "Filho", deep);
        var moved = await c.PatchAsJsonAsync($"/v1/staff/notes/folders/{deep}", new { parentId = l3 });
        Assert.Equal(HttpStatusCode.BadRequest, moved.StatusCode);

        // The list shows the tree with counts, and the note's folder path follows it.
        var code = (await CreateNoteAsync(c, new { title = "Nota na pasta", folderId = l4 })).GetProperty("code").GetString()!;
        Assert.Equal("Ideias / Pagamentos / Nível 3 / Nível 4", (await DetailAsync(c, code)).GetProperty("folderPath").GetString());
        var folders = await (await c.GetAsync("/v1/staff/notes/folders")).Json();
        Assert.Equal(1, folders.GetProperty("items").EnumerateArray().Single(f => f.GetProperty("id").GetString() == l4).GetProperty("noteCount").GetInt32());
    }

    [Fact]
    public async Task Deleting_a_folder_moves_its_notes_and_subfolders_up()
    {
        var (c, _) = await SignInAsync(fx);
        var parent = await FolderAsync(c, "Equipe");
        var doomed = await FolderAsync(c, "Antiga", parent);
        var child = await FolderAsync(c, "Filha", doomed);
        // A sibling already called "Filha" under the parent: the moved one gets a suffix.
        await FolderAsync(c, "Filha", parent);
        var archivedCode = (await CreateNoteAsync(c, new { title = "Arquivada", folderId = doomed })).GetProperty("code").GetString()!;
        await c.PostAsync($"/v1/staff/notes/{archivedCode}/archive", null);

        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/v1/staff/notes/folders/{doomed}")).StatusCode);

        Assert.Equal("Equipe", (await DetailAsync(c, archivedCode)).GetProperty("folderPath").GetString());
        var folders = (await (await c.GetAsync("/v1/staff/notes/folders")).Json()).GetProperty("items").EnumerateArray().ToList();
        var moved = folders.Single(f => f.GetProperty("id").GetString() == child);
        Assert.Equal(parent, moved.GetProperty("parentId").GetString());
        Assert.Equal("Filha (2)", moved.GetProperty("name").GetString());
        Assert.DoesNotContain(folders, f => f.GetProperty("id").GetString() == doomed);
    }

    [Fact]
    public async Task A_revision_is_kept_when_someone_else_changes_the_body_and_restore_brings_it_back()
    {
        var (ana, _) = await SignInAsync(fx, "Ana");
        var (bia, _) = await SignInAsync(fx, "Bia");
        var code = (await CreateNoteAsync(ana, new { title = "Procedimento", body = "Original" })).GetProperty("code").GetString()!;

        // The same person, in the same session: no revision of its own.
        await ana.PatchAsJsonAsync($"/v1/staff/notes/{code}", new { body = "Primeira versão" });
        Assert.Equal(0, (await (await ana.GetAsync($"/v1/staff/notes/{code}/revisions")).Json()).GetProperty("items").GetArrayLength());

        // Another person: the version before the change is kept, with the author who wrote it.
        await bia.PatchAsJsonAsync($"/v1/staff/notes/{code}", new { body = "Versão da Bia" });
        var revisions = (await (await ana.GetAsync($"/v1/staff/notes/{code}/revisions")).Json()).GetProperty("items");
        Assert.Equal(1, revisions.GetArrayLength());
        var revision = revisions[0];
        Assert.Equal("Ana", revision.GetProperty("authorName").GetString());
        var kept = await (await ana.GetAsync($"/v1/staff/notes/{code}/revisions/{revision.GetProperty("id").GetString()}")).Json();
        Assert.Equal("Primeira versão", kept.GetProperty("body").GetString());

        var restored = await ana.PostAsync($"/v1/staff/notes/{code}/revisions/{revision.GetProperty("id").GetString()}/restore", null);
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        Assert.Equal("Primeira versão", (await restored.Json()).GetProperty("body").GetString());
        // The restore kept what the note said just before it, so it can be undone too.
        Assert.Equal(2, (await (await ana.GetAsync($"/v1/staff/notes/{code}/revisions")).Json()).GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Backlinks_and_links_follow_the_note_codes_in_the_body()
    {
        var (c, _) = await SignInAsync(fx);
        var target = (await CreateNoteAsync(c, new { title = "Alvo da referência" })).GetProperty("code").GetString()!;
        var source = (await CreateNoteAsync(c, new { title = "Quem cita", body = $"Veja [[{target}]] e [[N-ZZZZZ]]." })).GetProperty("code").GetString()!;

        var sourceDetail = await DetailAsync(c, source);
        var linked = sourceDetail.GetProperty("linked").EnumerateArray().ToList();
        Assert.Equal(2, linked.Count);
        Assert.Equal(target, linked[0].GetProperty("code").GetString());
        Assert.False(linked[0].GetProperty("missing").GetBoolean());
        Assert.True(linked[1].GetProperty("missing").GetBoolean());

        var targetDetail = await DetailAsync(c, target);
        var backlinks = targetDetail.GetProperty("backlinks").EnumerateArray().ToList();
        Assert.Single(backlinks);
        Assert.Equal(source, backlinks[0].GetProperty("code").GetString());
        Assert.Equal("Quem cita", backlinks[0].GetProperty("title").GetString());
    }

    [Fact]
    public async Task Tasks_only_token_cannot_read_notes()
    {
        var staff = await SeedStaffAsync(fx);
        var (token, _) = await SeedTokenAsync(fx, staff.Id, scopes: [StaffTokenScopes.Tasks]);
        var res = await TokenClient(fx, token).GetAsync("/v1/staff/notes");
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Contains("notes", (await res.Json()).GetProperty("message").GetString());
    }

    [Fact]
    public async Task Converting_with_a_token_also_needs_the_tasks_scope()
    {
        var (session, staff) = await SignInAsync(fx);
        var code = (await CreateNoteAsync(session, new { title = "Achado com token", body = StructuredBody })).GetProperty("code").GetString()!;

        var (notesOnly, _) = await SeedTokenAsync(fx, staff.Id, scopes: [StaffTokenScopes.Notes]);
        var mcp = TokenClient(fx, notesOnly);
        Assert.Equal(HttpStatusCode.OK, (await mcp.GetAsync($"/v1/staff/notes/{code}")).StatusCode);
        var refused = await mcp.PostAsJsonAsync($"/v1/staff/notes/{code}/convert", new { });
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("O token precisa do escopo tasks para criar a tarefa.", (await refused.Json()).GetProperty("message").GetString());

        var (both, _) = await SeedTokenAsync(fx, staff.Id, scopes: [StaffTokenScopes.Notes, StaffTokenScopes.Tasks]);
        var converted = await TokenClient(fx, both).PostAsJsonAsync($"/v1/staff/notes/{code}/convert", new { });
        Assert.Equal(HttpStatusCode.Created, converted.StatusCode);
        Assert.NotNull((await converted.Json()).GetProperty("task").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Converting_turns_the_note_into_a_structured_task()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (c, _) = await SignInAsync(fx, "Carla");
        var code = (await CreateNoteAsync(c, new
        {
            title = "Configurar callback OAuth no painel", body = StructuredBody, product = product.Slug, labels = new[] { "oauth" },
        })).GetProperty("code").GetString()!;

        var preview = await (await c.GetAsync($"/v1/staff/notes/{code}/task-preview")).Json();
        Assert.Equal(100, preview.GetProperty("readiness").GetProperty("score").GetInt32());
        Assert.True(preview.GetProperty("readiness").GetProperty("ready").GetBoolean());

        var res = await c.PostAsJsonAsync($"/v1/staff/notes/{code}/convert", new { priority = "high", dueDate = "2026-12-01" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var body = await res.Json();
        var taskCode = body.GetProperty("task").GetProperty("code").GetString()!;
        Assert.Matches("^T-", taskCode);
        Assert.Equal("todo", body.GetProperty("task").GetProperty("status").GetString());
        Assert.Equal("converted", body.GetProperty("note").GetProperty("stage").GetString());
        Assert.Equal(taskCode, body.GetProperty("note").GetProperty("task").GetProperty("code").GetString());

        var task = await (await c.GetAsync($"/v1/staff/tasks/{taskCode}")).Json();
        Assert.Equal("Configurar callback OAuth no painel", task.GetProperty("title").GetString());
        Assert.Equal("high", task.GetProperty("priority").GetString());
        Assert.Equal(product.Slug, task.GetProperty("product").GetProperty("slug").GetString());
        Assert.Equal(["oauth"], task.GetProperty("labels").EnumerateArray().Select(l => l.GetString()));
        var checklist = task.GetProperty("checklist").EnumerateArray().ToList();
        Assert.Equal(["Abrir o painel do provedor", "Salvar o domínio de retorno", "Testar o login no celular"],
            checklist.Select(i => i.GetProperty("text").GetString()));
        Assert.Equal([false, true, false], checklist.Select(i => i.GetProperty("done").GetBoolean()));
        var links = task.GetProperty("links").EnumerateArray().ToList();
        Assert.Equal(["https://docs.exemplo.com/oauth", "https://status.exemplo.com"], links.Select(l => l.GetProperty("url").GetString()));
        Assert.Equal("Documentação", links[0].GetProperty("label").GetString());
        Assert.Contains($"Origem: anotação {code}", task.GetProperty("body").GetString());

        var created = task.GetProperty("events").EnumerateArray().Single(e => e.GetProperty("kind").GetString() == "created");
        Assert.Equal(code, created.GetProperty("data").GetProperty("fromNote").GetString());

        // A converted note is not converted again, and its stage does not move back.
        var again = await c.PostAsJsonAsync($"/v1/staff/notes/{code}/convert", new { });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal($"A anotação já virou a tarefa {taskCode}.", (await again.Json()).GetProperty("message").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PatchAsJsonAsync($"/v1/staff/notes/{code}", new { stage = "idea" })).StatusCode);
    }

    [Fact]
    public async Task A_thin_note_is_not_converted_without_force()
    {
        var (c, _) = await SignInAsync(fx);
        var code = (await CreateNoteAsync(c, new { title = "Ideia solta" })).GetProperty("code").GetString()!;

        var res = await c.PostAsJsonAsync($"/v1/staff/notes/{code}/convert", new { });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Json();
        Assert.Equal(5, body.GetProperty("missing").GetArrayLength());
        Assert.StartsWith("A anotação ainda não está estruturada:", body.GetProperty("message").GetString());

        var forced = await c.PostAsJsonAsync($"/v1/staff/notes/{code}/convert", new { force = true });
        Assert.Equal(HttpStatusCode.Created, forced.StatusCode);
    }

    [Fact]
    public async Task Duplicate_and_delete_follow_the_archive_rule()
    {
        var (c, _) = await SignInAsync(fx);
        var code = (await CreateNoteAsync(c, new { title = "Original", body = "Corpo" })).GetProperty("code").GetString()!;

        var copy = await c.PostAsync($"/v1/staff/notes/{code}/duplicate", null);
        Assert.Equal(HttpStatusCode.Created, copy.StatusCode);
        Assert.Equal("Cópia de Original", (await copy.Json()).GetProperty("title").GetString());

        Assert.Equal(HttpStatusCode.BadRequest, (await c.DeleteAsync($"/v1/staff/notes/{code}")).StatusCode);
        await c.PostAsync($"/v1/staff/notes/{code}/archive", null);
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/v1/staff/notes/{code}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync($"/v1/staff/notes/{code}")).StatusCode);
    }

    [Fact]
    public async Task Body_over_512_kb_returns_413()
    {
        var (c, _) = await SignInAsync(fx);
        var res = await c.PostAsJsonAsync("/v1/staff/notes", new { title = "grande", body = new string('x', 600 * 1024) });
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
        Assert.Equal("Corpo da requisição acima de 512 KB.", (await res.Json()).GetProperty("message").GetString());
    }
}
