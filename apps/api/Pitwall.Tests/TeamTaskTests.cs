using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Pitwall.Domain;
using static Pitwall.Tests.TeamTaskKit;

namespace Pitwall.Tests;

/// <summary>
/// The team's board through its API: what a create, a patch and a move do to a task, how the board
/// and the delta read, and that the history keeps what people saw.
/// </summary>
public class TeamTaskTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private static string[] Codes(JsonElement column) => column.EnumerateArray().Select(t => t.GetProperty("code").GetString()!).ToArray();

    private static async Task<JsonElement> Board(HttpClient c, string slug, string? since = null) =>
        await (await c.GetAsync($"/v1/staff/tasks/board?product={slug}" + (since is null ? "" : $"&updatedSince={Uri.EscapeDataString(since)}"))).Json();

    private static async Task<JsonElement> Move(HttpClient c, string code, object body, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var res = await c.PostAsJsonAsync($"/v1/staff/tasks/{code}/move", body);
        Assert.Equal(expected, res.StatusCode);
        return await res.Json();
    }

    [Fact]
    public async Task Create_returns_201_with_code_and_top_position()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (c, _) = await SignInAsync(fx);
        var first = await CreateTaskAsync(c, new
        {
            title = "  Configurar callback OAuth  ", body = "Passos:\n1. Abrir o painel", product = product.Slug, priority = "high",
            labels = new[] { "OAuth", "manual" }, dueDate = "2026-11-10",
            checklist = new object[] { new { text = "Salvar domínio", done = true }, new { text = "Testar" } },
            links = new[] { new { label = "Doc", url = "https://example.com/doc" } },
        });
        Assert.Matches("^T-[0-9A-HJKMNP-TV-Z]{5}$", first.GetProperty("code").GetString());
        Assert.Equal("Configurar callback OAuth", first.GetProperty("title").GetString());
        Assert.Equal("todo", first.GetProperty("status").GetString());
        Assert.Equal(product.Slug, first.GetProperty("product").GetProperty("slug").GetString());
        Assert.Equal(["oauth", "manual"], first.GetProperty("labels").EnumerateArray().Select(l => l.GetString()));
        Assert.Equal("2026-11-10", first.GetProperty("dueDate").GetString());
        Assert.Equal(1, first.GetProperty("checklistDone").GetInt32());
        Assert.Equal(2, first.GetProperty("checklistTotal").GetInt32());
        Assert.Equal("c1", first.GetProperty("checklist")[0].GetProperty("id").GetString());
        Assert.Equal("Passos:\n1. Abrir o painel", first.GetProperty("body").GetString());
        Assert.Equal(JsonValueKind.Null, first.GetProperty("assignee").ValueKind);

        var second = await CreateTaskAsync(c, new { title = "Outra", product = product.Slug });
        Assert.True(second.GetProperty("position").GetDouble() < first.GetProperty("position").GetDouble());
        var board = await Board(c, product.Slug);
        Assert.Equal([second.GetProperty("code").GetString()!, first.GetProperty("code").GetString()!], Codes(board.GetProperty("columns").GetProperty("todo")));
    }

    [Fact]
    public async Task Create_requires_title()
    {
        var (c, _) = await SignInAsync(fx);
        var res = await c.PostAsJsonAsync("/v1/staff/tasks", new { title = "   ", body = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace((await res.Json()).GetProperty("message").GetString()));
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/v1/staff/tasks", new { title = "x", labels = new[] { "ação" } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/v1/staff/tasks", new { title = "x", links = new[] { new { url = "javascript:alert(1)" } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/v1/staff/tasks", new { title = "x", status = "blocked" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/v1/staff/tasks", new { title = "x", dueDate = "10/11/2026" })).StatusCode);
    }

    [Fact]
    public async Task Create_with_unknown_product_returns_404()
    {
        var (c, _) = await SignInAsync(fx);
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsJsonAsync("/v1/staff/tasks", new { title = "x", product = "nao-existe" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsJsonAsync("/v1/staff/tasks", new { title = "x", assigneeId = Guid.NewGuid().ToString() })).StatusCode);
    }

    [Fact]
    public async Task Create_via_session_sets_source_manual()
    {
        var (c, staff) = await SignInAsync(fx, "Carla");
        var task = await CreateTaskAsync(c, new { title = "Feita no console" });
        Assert.Equal("manual", task.GetProperty("source").GetString());
        Assert.Equal("Carla", task.GetProperty("createdBy").GetProperty("name").GetString());
        Assert.Equal(staff.Id.ToString(), task.GetProperty("createdBy").GetProperty("ref").GetString());
    }

    [Fact]
    public async Task Body_over_256_kb_returns_413()
    {
        var (c, _) = await SignInAsync(fx);
        var res = await c.PostAsJsonAsync("/v1/staff/tasks", new { title = "grande", body = new string('x', 300 * 1024) });
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
    }

    [Fact]
    public async Task Patch_updates_only_sent_fields()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (c, staff) = await SignInAsync(fx);
        var task = await CreateTaskAsync(c, new { title = "Antes", body = "corpo", product = product.Slug, labels = new[] { "a" }, assigneeId = staff.Id.ToString() });
        var code = task.GetProperty("code").GetString();

        var res = await c.PatchAsJsonAsync($"/v1/staff/tasks/{code}", new { title = "Depois", priority = "low" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var after = await res.Json();
        Assert.Equal("Depois", after.GetProperty("title").GetString());
        Assert.Equal("low", after.GetProperty("priority").GetString());
        Assert.Equal("corpo", after.GetProperty("body").GetString());
        Assert.Equal(["a"], after.GetProperty("labels").EnumerateArray().Select(l => l.GetString()));
        Assert.Equal(product.Slug, after.GetProperty("product").GetProperty("slug").GetString());
        Assert.Equal(staff.Id, after.GetProperty("assignee").GetProperty("id").GetGuid());
        Assert.True(after.GetProperty("updatedAt").GetDateTime() > task.GetProperty("updatedAt").GetDateTime());

        var detail = await (await c.GetAsync($"/v1/staff/tasks/{code}")).Json();
        var updated = detail.GetProperty("events").EnumerateArray().Single(e => e.GetProperty("kind").GetString() == "updated");
        Assert.Equal(["title", "priority"], updated.GetProperty("data").GetProperty("fields").EnumerateArray().Select(f => f.GetString()));
    }

    [Fact]
    public async Task Patch_null_clears_due_date_and_assignee()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (c, staff) = await SignInAsync(fx);
        var task = await CreateTaskAsync(c, new { title = "x", dueDate = "2026-12-01", assigneeId = staff.Id.ToString(), product = product.Slug });
        var code = task.GetProperty("code").GetString();

        var after = await (await c.PatchAsync($"/v1/staff/tasks/{code}",
            JsonContent.Create(JsonDocument.Parse("""{"dueDate":null,"assigneeId":null,"product":null}""").RootElement))).Json();
        Assert.Equal(JsonValueKind.Null, after.GetProperty("dueDate").ValueKind);
        Assert.Equal(JsonValueKind.Null, after.GetProperty("assignee").ValueKind);
        Assert.Equal(JsonValueKind.Null, after.GetProperty("product").ValueKind);
    }

    [Fact]
    public async Task Patch_rejects_status()
    {
        var (c, _) = await SignInAsync(fx);
        var code = (await CreateTaskAsync(c, new { title = "x" })).GetProperty("code").GetString();
        var res = await c.PatchAsJsonAsync($"/v1/staff/tasks/{code}", new { status = "done" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("Use /move para mudar o status.", (await res.Json()).GetProperty("message").GetString());
    }

    [Fact]
    public async Task Patch_with_stale_ifUpdatedAt_returns_409()
    {
        var (c, _) = await SignInAsync(fx);
        var task = await CreateTaskAsync(c, new { title = "x" });
        var code = task.GetProperty("code").GetString();
        var first = task.GetProperty("updatedAt").GetString();

        // The value the API answered with is the one it compares to.
        var ok = await c.PatchAsJsonAsync($"/v1/staff/tasks/{code}", new { title = "y", ifUpdatedAt = first });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var stale = await c.PatchAsJsonAsync($"/v1/staff/tasks/{code}", new { title = "z", ifUpdatedAt = first });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("A tarefa mudou. Recarregue.", (await stale.Json()).GetProperty("message").GetString());
    }

    [Fact]
    public async Task Move_between_columns_orders_by_neighbors()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (c, _) = await SignInAsync(fx);
        var a = (await CreateTaskAsync(c, new { title = "A", product = product.Slug, status = "doing" })).GetProperty("code").GetString()!;
        var b = (await CreateTaskAsync(c, new { title = "B", product = product.Slug, status = "doing" })).GetProperty("code").GetString()!;
        var x = await CreateTaskAsync(c, new { title = "X", product = product.Slug });
        var xCode = x.GetProperty("code").GetString()!;
        Assert.Equal([b, a], Codes((await Board(c, product.Slug)).GetProperty("columns").GetProperty("doing")));

        var moved = await Move(c, xCode, new { status = "doing", beforeId = b, afterId = a });
        Assert.Equal("doing", moved.GetProperty("status").GetString());
        Assert.Equal([b, xCode, a], Codes((await Board(c, product.Slug)).GetProperty("columns").GetProperty("doing")));

        // One neighbour: the other is whoever sits next to it.
        await Move(c, xCode, new { status = "doing", beforeId = a });
        Assert.Equal([b, a, xCode], Codes((await Board(c, product.Slug)).GetProperty("columns").GetProperty("doing")));
        await Move(c, xCode, new { status = "doing", afterId = b });
        Assert.Equal([xCode, b, a], Codes((await Board(c, product.Slug)).GetProperty("columns").GetProperty("doing")));

        // Reordering inside the column is not a move in the history.
        var detail = await (await c.GetAsync($"/v1/staff/tasks/{xCode}")).Json();
        Assert.Single(detail.GetProperty("events").EnumerateArray(), e => e.GetProperty("kind").GetString() == "moved");
    }

    [Fact]
    public async Task Move_to_done_sets_DoneAt_and_back_clears_it()
    {
        var (c, _) = await SignInAsync(fx);
        var code = (await CreateTaskAsync(c, new { title = "x" })).GetProperty("code").GetString()!;
        var done = await Move(c, code, new { status = "done" });
        Assert.NotEqual(JsonValueKind.Null, done.GetProperty("doneAt").ValueKind);
        var back = await Move(c, code, new { status = "doing" });
        Assert.Equal(JsonValueKind.Null, back.GetProperty("doneAt").ValueKind);
    }

    [Fact]
    public async Task Move_to_blocked_requires_note()
    {
        var (c, _) = await SignInAsync(fx);
        var code = (await CreateTaskAsync(c, new { title = "x" })).GetProperty("code").GetString()!;
        await Move(c, code, new { status = "blocked" }, HttpStatusCode.BadRequest);
        await Move(c, code, new { status = "blocked", blockedNote = "  " }, HttpStatusCode.BadRequest);
        await Move(c, code, new { status = "nada" }, HttpStatusCode.BadRequest);
        var blocked = await Move(c, code, new { status = "blocked", blockedNote = "Painel recusa a URL: 'domínio não verificado'" });
        Assert.Equal("Painel recusa a URL: 'domínio não verificado'", blocked.GetProperty("blockedNote").GetString());
    }

    [Fact]
    public async Task Move_out_of_blocked_clears_note_and_keeps_event()
    {
        var (c, _) = await SignInAsync(fx);
        var code = (await CreateTaskAsync(c, new { title = "x" })).GetProperty("code").GetString()!;
        await Move(c, code, new { status = "blocked", blockedNote = "erro 400 ao salvar" });
        // The note can be rewritten while blocked; each version lands in the history.
        var patched = await (await c.PatchAsJsonAsync($"/v1/staff/tasks/{code}", new { blockedNote = "erro 400 ao salvar (de novo)" })).Json();
        Assert.Equal("erro 400 ao salvar (de novo)", patched.GetProperty("blockedNote").GetString());
        var doing = await Move(c, code, new { status = "doing" });
        Assert.Equal(JsonValueKind.Null, doing.GetProperty("blockedNote").ValueKind);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PatchAsJsonAsync($"/v1/staff/tasks/{code}", new { blockedNote = "x" })).StatusCode);

        var events = (await (await c.GetAsync($"/v1/staff/tasks/{code}")).Json()).GetProperty("events").EnumerateArray().ToList();
        var notes = events.Where(e => e.GetProperty("kind").GetString() == "blocked").Select(e => e.GetProperty("data").GetProperty("note").GetString());
        Assert.Equal(["erro 400 ao salvar", "erro 400 ao salvar (de novo)"], notes);
        var moves = events.Where(e => e.GetProperty("kind").GetString() == "moved").Select(e => e.GetProperty("data")).ToList();
        Assert.Equal("blocked", moves[^1].GetProperty("from").GetString());
        Assert.Equal("doing", moves[^1].GetProperty("to").GetString());
    }

    [Fact]
    public async Task Move_with_neighbor_from_other_column_returns_400()
    {
        var (c, _) = await SignInAsync(fx);
        var todo = (await CreateTaskAsync(c, new { title = "na fila" })).GetProperty("code").GetString()!;
        var code = (await CreateTaskAsync(c, new { title = "x" })).GetProperty("code").GetString()!;
        var res = await Move(c, code, new { status = "doing", beforeId = todo }, HttpStatusCode.BadRequest);
        Assert.Contains("outra coluna", res.GetProperty("message").GetString());
        await Move(c, code, new { status = "doing", beforeId = Guid.NewGuid() }, HttpStatusCode.BadRequest);
        await Move(c, "T-00000", new { status = "doing" }, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Move_reindexes_column_when_needed()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (c, _) = await SignInAsync(fx);
        var a = await CreateTaskAsync(c, new { title = "A", product = product.Slug, status = "blocked", blockedNote = "n" });
        var b = await CreateTaskAsync(c, new { title = "B", product = product.Slug, status = "blocked", blockedNote = "n" });
        var x = await CreateTaskAsync(c, new { title = "X", product = product.Slug });
        Guid aId = a.GetProperty("id").GetGuid(), bId = b.GetProperty("id").GetGuid();
        // Worn down by many drops in the same spot: no room left between A and B.
        await WithDbAsync(fx, async db =>
        {
            await db.TeamTasks.Where(t => t.Id == aId).ExecuteUpdateAsync(s => s.SetProperty(t => t.Position, 1e9));
            await db.TeamTasks.Where(t => t.Id == bId).ExecuteUpdateAsync(s => s.SetProperty(t => t.Position, 1e9 + 1e-7));
        });

        var moved = await Move(c, x.GetProperty("code").GetString()!, new { status = "blocked", beforeId = aId, afterId = bId, blockedNote = "travou" });
        var board = await Board(c, product.Slug);
        var column = board.GetProperty("columns").GetProperty("blocked").EnumerateArray().ToList();
        Assert.Equal(["A", "X", "B"], column.Select(t => t.GetProperty("title").GetString()));
        var positions = column.Select(t => t.GetProperty("position").GetDouble()).ToList();
        Assert.True(positions[0] < positions[1] && positions[1] < positions[2]);
        Assert.Equal(0, positions[0] % 1024);
        Assert.Equal(0, positions[2] % 1024);
        Assert.Equal(moved.GetProperty("position").GetDouble(), positions[1]);
    }

    [Fact]
    public async Task Board_returns_four_columns_ordered_and_counts()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (c, _) = await SignInAsync(fx);
        await CreateTaskAsync(c, new { title = "t1", product = product.Slug });
        await CreateTaskAsync(c, new { title = "t2", product = product.Slug, dueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)).ToString("yyyy-MM-dd") });
        await CreateTaskAsync(c, new { title = "d1", product = product.Slug, status = "doing", body = "não vai no quadro" });
        await CreateTaskAsync(c, new { title = "b1", product = product.Slug, status = "blocked", blockedNote = "erro" });
        await CreateTaskAsync(c, new { title = "f1", product = product.Slug, status = "done", dueDate = "2020-01-01" });

        var board = await Board(c, product.Slug);
        var columns = board.GetProperty("columns");
        Assert.Equal(["todo", "doing", "blocked", "done"], columns.EnumerateObject().Select(p => p.Name));
        Assert.Equal(["t2", "t1"], columns.GetProperty("todo").EnumerateArray().Select(t => t.GetProperty("title").GetString()));
        var counts = board.GetProperty("counts");
        Assert.Equal(2, counts.GetProperty("todo").GetInt32());
        Assert.Equal(1, counts.GetProperty("doing").GetInt32());
        Assert.Equal(1, counts.GetProperty("blocked").GetInt32());
        Assert.Equal(1, counts.GetProperty("done").GetInt32());
        Assert.Equal(1, counts.GetProperty("overdue").GetInt32());
        Assert.True(columns.GetProperty("todo")[0].GetProperty("overdue").GetBoolean());
        Assert.False(columns.GetProperty("done")[0].GetProperty("overdue").GetBoolean());
        // The board is light: no body, checklist or links on the cards.
        var card = columns.GetProperty("doing")[0];
        Assert.False(card.TryGetProperty("body", out _));
        Assert.False(card.TryGetProperty("checklist", out _));
        Assert.False(card.TryGetProperty("links", out _));
        Assert.True(card.TryGetProperty("checklistTotal", out _));
        Assert.True(board.TryGetProperty("serverTime", out _));
        Assert.False(board.TryGetProperty("removedIds", out _));
    }

    [Fact]
    public async Task Board_updatedSince_returns_delta_and_removedIds()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (c, _) = await SignInAsync(fx);
        var old = await CreateTaskAsync(c, new { title = "antiga", product = product.Slug });
        var gone = await CreateTaskAsync(c, new { title = "vai arquivar", product = product.Slug });
        var oldId = old.GetProperty("id").GetGuid();
        var goneId = gone.GetProperty("id").GetGuid();
        await WithDbAsync(fx, db => db.TeamTasks.Where(t => t.Id == oldId || t.Id == goneId)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.UpdatedAt, DateTime.UtcNow.AddHours(-1))));

        var serverTime = (await Board(c, product.Slug)).GetProperty("serverTime").GetString()!;
        var fresh = await CreateTaskAsync(c, new { title = "nova", product = product.Slug });
        Assert.Equal(HttpStatusCode.NoContent, (await c.PostAsync($"/v1/staff/tasks/{goneId}/archive", null)).StatusCode);

        var delta = await Board(c, product.Slug, serverTime);
        var ids = delta.GetProperty("columns").EnumerateObject().SelectMany(col => col.Value.EnumerateArray()).Select(t => t.GetProperty("id").GetGuid()).ToList();
        Assert.Contains(fresh.GetProperty("id").GetGuid(), ids);
        Assert.DoesNotContain(oldId, ids);
        Assert.Contains(goneId, delta.GetProperty("removedIds").EnumerateArray().Select(i => i.GetGuid()));
        // Counts are always the whole board's.
        Assert.Equal(2, delta.GetProperty("counts").GetProperty("todo").GetInt32());

        Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync("/v1/staff/tasks/board?updatedSince=ontem")).StatusCode);
    }

    [Fact]
    public async Task List_filters_by_product_status_label_and_q()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (other, _, _, _) = await fx.SeedProductAsync();
        var (c, staff) = await SignInAsync(fx);
        await CreateTaskAsync(c, new { title = "Webhook da Meta", product = product.Slug, labels = new[] { "meta" }, assigneeId = staff.Id.ToString() });
        await CreateTaskAsync(c, new { title = "Login no celular", product = product.Slug, status = "doing", body = "testar no iPhone" });
        await CreateTaskAsync(c, new { title = "Webhook de outro", product = other.Slug, labels = new[] { "meta" } });

        async Task<string[]> Titles(string query) =>
            (await (await c.GetAsync($"/v1/staff/tasks?{query}")).Json()).GetProperty("items").EnumerateArray()
            .Select(t => t.GetProperty("title").GetString()!).Order().ToArray();

        Assert.Equal(["Login no celular", "Webhook da Meta"], await Titles($"product={product.Slug}"));
        Assert.Equal(["Login no celular", "Webhook da Meta"], await Titles($"product={product.Id}"));
        Assert.Equal(["Login no celular"], await Titles($"product={product.Slug}&status=doing,blocked"));
        Assert.Equal(["Webhook da Meta", "Webhook de outro"], (await Titles("label=meta")).Where(t => t.StartsWith("Webhook d")).ToArray());
        Assert.Equal(["Login no celular"], await Titles($"product={product.Slug}&q=iphone"));
        Assert.Equal(["Webhook da Meta"], await Titles($"product={product.Slug}&assignee=me"));
        Assert.Equal(["Login no celular"], await Titles($"product={product.Slug}&assignee=none"));
        Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync("/v1/staff/tasks?status=aberto")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync("/v1/staff/tasks?product=nao-existe")).StatusCode);

        // Paged by cursor, newest change first, nothing repeated or skipped.
        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await (await c.GetAsync($"/v1/staff/tasks?product={product.Slug}&limit=1" + (cursor is null ? "" : $"&cursor={cursor}"))).Json();
            seen.AddRange(page.GetProperty("items").EnumerateArray().Select(t => t.GetProperty("title").GetString()!));
            cursor = page.GetProperty("nextCursor").ValueKind == JsonValueKind.Null ? null : page.GetProperty("nextCursor").GetString();
        } while (cursor is not null);
        Assert.Equal(["Login no celular", "Webhook da Meta"], seen);
    }

    [Fact]
    public async Task Get_by_code_includes_comments_and_events()
    {
        var (c, _) = await SignInAsync(fx, "Dani");
        var task = await CreateTaskAsync(c, new { title = "x", body = "**corpo**", links = new[] { new { label = "PR", url = "https://example.com/pr/1" } } });
        var code = task.GetProperty("code").GetString()!;
        Assert.Equal(HttpStatusCode.Created, (await c.PostAsJsonAsync($"/v1/staff/tasks/{code}/comments", new { body = "Conferi: o login funciona." })).StatusCode);

        var res = await c.GetAsync($"/v1/staff/tasks/{code.ToLowerInvariant()}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var detail = await res.Json();
        Assert.Equal(code, detail.GetProperty("code").GetString());
        Assert.Equal("**corpo**", detail.GetProperty("body").GetString());
        Assert.Equal("PR", detail.GetProperty("links")[0].GetProperty("label").GetString());
        Assert.Equal(1, detail.GetProperty("commentCount").GetInt32());
        var comment = detail.GetProperty("comments").EnumerateArray().Single();
        Assert.Equal("Conferi: o login funciona.", comment.GetProperty("body").GetString());
        Assert.Equal("Dani", comment.GetProperty("authorName").GetString());
        Assert.Equal(["created", "commented"], detail.GetProperty("events").EnumerateArray().Select(e => e.GetProperty("kind").GetString()));

        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync($"/v1/staff/tasks/{task.GetProperty("id").GetGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync("/v1/staff/tasks/T-00000")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync("/v1/staff/tasks/qualquer-coisa")).StatusCode);
    }

    [Fact]
    public async Task Comment_bumps_updatedAt_and_logs_event()
    {
        var (c, _) = await SignInAsync(fx);
        var task = await CreateTaskAsync(c, new { title = "x" });
        var code = task.GetProperty("code").GetString()!;
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync($"/v1/staff/tasks/{code}/comments", new { body = " " })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync($"/v1/staff/tasks/{code}/comments", new { body = new string('x', 10_001) })).StatusCode);
        var res = await c.PostAsJsonAsync($"/v1/staff/tasks/{code}/comments", new { body = "ok" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.Equal("manual", (await res.Json()).GetProperty("source").GetString());

        var detail = await (await c.GetAsync($"/v1/staff/tasks/{code}")).Json();
        Assert.True(detail.GetProperty("updatedAt").GetDateTime() > task.GetProperty("updatedAt").GetDateTime());
        Assert.Contains(detail.GetProperty("events").EnumerateArray(), e => e.GetProperty("kind").GetString() == "commented");
    }

    [Fact]
    public async Task Archive_hides_from_board_and_unarchive_restores()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (c, _) = await SignInAsync(fx);
        var keep = await CreateTaskAsync(c, new { title = "fica", product = product.Slug, status = "doing" });
        var task = await CreateTaskAsync(c, new { title = "arquivada", product = product.Slug, status = "doing" });
        var code = task.GetProperty("code").GetString()!;
        // Make it the bottom card, so restoring it to the top is visible.
        await Move(c, code, new { status = "doing", beforeId = keep.GetProperty("code").GetString() });

        Assert.Equal(HttpStatusCode.NoContent, (await c.PostAsync($"/v1/staff/tasks/{code}/archive", null)).StatusCode);
        Assert.DoesNotContain(code, Codes((await Board(c, product.Slug)).GetProperty("columns").GetProperty("doing")));
        var list = await (await c.GetAsync($"/v1/staff/tasks?product={product.Slug}")).Json();
        Assert.DoesNotContain(code, Codes(list.GetProperty("items")));
        var archived = await (await c.GetAsync($"/v1/staff/tasks?product={product.Slug}&includeArchived=true")).Json();
        Assert.Contains(code, Codes(archived.GetProperty("items")));
        await Move(c, code, new { status = "todo" }, HttpStatusCode.BadRequest);

        var res = await c.PostAsync($"/v1/staff/tasks/{code}/unarchive", null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(JsonValueKind.Null, (await res.Json()).GetProperty("archivedAt").ValueKind);
        Assert.Equal(code, Codes((await Board(c, product.Slug)).GetProperty("columns").GetProperty("doing"))[0]);
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsync("/v1/staff/tasks/T-00000/archive", null)).StatusCode);
    }

    [Fact]
    public async Task ArchiveDone_archives_only_done()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (c, _) = await SignInAsync(fx);
        await CreateTaskAsync(c, new { title = "feita 1", product = product.Slug, status = "done" });
        await CreateTaskAsync(c, new { title = "feita 2", product = product.Slug, status = "done" });
        await CreateTaskAsync(c, new { title = "a fazer", product = product.Slug });

        var recent = await (await c.PostAsJsonAsync("/v1/staff/tasks/archive-done", new { product = product.Slug, olderThanDays = 7 })).Json();
        Assert.Equal(0, recent.GetProperty("archived").GetInt32());
        var res = await c.PostAsJsonAsync("/v1/staff/tasks/archive-done", new { product = product.Slug });
        Assert.Equal(2, (await res.Json()).GetProperty("archived").GetInt32());

        var board = await Board(c, product.Slug);
        Assert.Equal(0, board.GetProperty("columns").GetProperty("done").GetArrayLength());
        Assert.Equal(1, board.GetProperty("columns").GetProperty("todo").GetArrayLength());
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/v1/staff/tasks/archive-done", new { olderThanDays = -1 })).StatusCode);
    }

    [Fact]
    public async Task Meta_lists_products_staff_and_labels()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var (c, staff) = await SignInAsync(fx);
        await CreateTaskAsync(c, new { title = "x", labels = new[] { "meta-rara" } });
        var meta = await (await c.GetAsync("/v1/staff/tasks/meta")).Json();
        Assert.Contains(meta.GetProperty("products").EnumerateArray(), p => p.GetProperty("slug").GetString() == product.Slug);
        Assert.Contains(meta.GetProperty("staff").EnumerateArray(), s => s.GetProperty("id").GetGuid() == staff.Id);
        var label = meta.GetProperty("labels").EnumerateArray().Single(l => l.GetProperty("name").GetString() == "meta-rara");
        Assert.Equal(1, label.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task Tasks_routes_return_404_on_public_host()
    {
        var factory = fx.Factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, cfg) =>
            cfg.AddInMemoryCollection(new Dictionary<string, string?> { ["Pitwall:StaffHosts"] = "api" })));
        var client = factory.CreateClient();

        async Task<HttpStatusCode> Send(HttpMethod method, string host, string path)
        {
            using var req = new HttpRequestMessage(method, path);
            req.Headers.Host = host;
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "pwt_qualquer");
            return (await client.SendAsync(req)).StatusCode;
        }

        Assert.Equal(HttpStatusCode.NotFound, await Send(HttpMethod.Get, "api.example.com", "/v1/staff/tasks/board"));
        Assert.Equal(HttpStatusCode.NotFound, await Send(HttpMethod.Post, "api.example.com", "/v1/staff/tasks"));
        Assert.Equal(HttpStatusCode.Unauthorized, await Send(HttpMethod.Get, "api", "/v1/staff/tasks/board"));
    }
}
