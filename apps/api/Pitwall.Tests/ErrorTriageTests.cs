using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Pitwall.Domain;
using static Pitwall.Tests.TeamTaskKit;

namespace Pitwall.Tests;

/// <summary>
/// The errors a triage routine reads through the MCP: grouped by signature, within a period, with
/// a flag for what the team already has on them. Names are made up (Acme, Globex).
/// </summary>
public class ErrorTriageTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private const string Recent = "/v1/staff/errors/recent";

    private static string Id(string prefix) => $"{prefix}-{Guid.NewGuid():N}"[..(prefix.Length + 9)];

    private async Task<HttpClient> TokenWithAsync(params string[] scopes)
    {
        var staff = await SeedStaffAsync(fx, "Bia");
        var (token, _) = await SeedTokenAsync(fx, staff.Id, scopes);
        return TokenClient(fx, token);
    }

    private static ServerError Error(Product product, string signature, string trace, DateTime at, string type = "NullReferenceException", string? route = "/api/orders/{id}") => new()
    {
        Id = Guid.NewGuid(), ProductId = product.Id, TraceId = trace, CustomerRef = "cust-" + trace, Method = "POST",
        Path = "/api/orders/42", RouteTemplate = route, StatusCode = 500, ExceptionType = type, Message = "Object reference not set",
        Signature = signature, OccurredAt = at, ReceivedAt = at,
    };

    private async Task<Product> ProductAsync(string name = "Acme")
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        await WithDbAsync(fx, async db =>
        {
            var row = await db.Products.FindAsync(product.Id);
            row!.Name = name;
            await db.SaveChangesAsync();
        });
        return product;
    }

    private static async Task<JsonElement> ItemsAsync(HttpResponseMessage res)
    {
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return (await res.Json()).GetProperty("items");
    }

    [Fact]
    public async Task Errors_are_grouped_by_signature_with_a_sample_and_the_count()
    {
        var acme = await ProductAsync();
        var now = DateTime.UtcNow;
        var a = Id("sigA");
        var b = Id("sigB");
        await WithDbAsync(fx, async db =>
        {
            db.ServerErrors.AddRange(
                Error(acme, a, "t-a1", now.AddHours(-5)),
                Error(acme, a, "t-a2", now.AddHours(-3)),
                Error(acme, a, "t-a3", now.AddHours(-1)),
                Error(acme, b, "t-b1", now.AddHours(-2), type: "TimeoutException", route: null));
            await db.SaveChangesAsync();
        });

        var items = (await ItemsAsync(await (await TokenWithAsync(StaffTokenScopes.Errors)).GetAsync($"{Recent}?product={acme.Slug}"))).EnumerateArray().ToList();
        Assert.Equal(2, items.Count);
        var first = items[0];
        Assert.Equal(a, first.GetProperty("signature").GetString());
        Assert.Equal(3, first.GetProperty("count").GetInt32());
        Assert.Equal(3, first.GetProperty("customers").GetInt32());
        Assert.Equal(acme.Slug, first.GetProperty("product").GetProperty("slug").GetString());
        Assert.Equal("Acme", first.GetProperty("product").GetProperty("name").GetString());
        Assert.Equal("/api/orders/{id}", first.GetProperty("route").GetString());
        Assert.Equal("NullReferenceException", first.GetProperty("exceptionType").GetString());
        Assert.Equal("Object reference not set", first.GetProperty("message").GetString());
        Assert.Equal("t-a3", first.GetProperty("traceId").GetString());
        Assert.True(first.GetProperty("firstSeen").GetDateTime() < first.GetProperty("lastSeen").GetDateTime());
        // Without a route template the raw path names the group.
        Assert.Equal("/api/orders/42", items[1].GetProperty("route").GetString());
        Assert.False(first.GetProperty("tracked").GetBoolean());
    }

    [Fact]
    public async Task The_period_defaults_to_a_day_and_takes_hours_or_a_date()
    {
        var acme = await ProductAsync();
        var now = DateTime.UtcNow;
        var recent = Id("sigR");
        var old = Id("sigO");
        await WithDbAsync(fx, async db =>
        {
            db.ServerErrors.AddRange(Error(acme, recent, "t-r", now.AddHours(-2)), Error(acme, old, "t-o", now.AddHours(-30)));
            await db.SaveChangesAsync();
        });
        var client = await TokenWithAsync(StaffTokenScopes.Errors);
        string[] Sigs(JsonElement items) => items.EnumerateArray().Select(i => i.GetProperty("signature").GetString()!).ToArray();

        Assert.Equal([recent], Sigs(await ItemsAsync(await client.GetAsync($"{Recent}?product={acme.Slug}"))));
        Assert.Equal([recent, old], Sigs(await ItemsAsync(await client.GetAsync($"{Recent}?product={acme.Slug}&since=48"))));
        var iso = Uri.EscapeDataString(now.AddHours(-31).ToString("O"));
        Assert.Equal(2, (await ItemsAsync(await client.GetAsync($"{Recent}?product={acme.Slug}&since={iso}"))).GetArrayLength());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"{Recent}?since=ontem")).StatusCode);
    }

    [Fact]
    public async Task The_product_filter_and_the_limit_apply()
    {
        var acme = await ProductAsync("Acme");
        var globex = await ProductAsync("Globex");
        var now = DateTime.UtcNow;
        await WithDbAsync(fx, async db =>
        {
            db.ServerErrors.AddRange(
                Error(acme, Id("sigX"), "t-x1", now.AddHours(-1)), Error(acme, Id("sigY"), "t-y1", now.AddHours(-1)),
                Error(globex, Id("sigZ"), "t-z1", now.AddHours(-1)));
            await db.SaveChangesAsync();
        });
        var client = await TokenWithAsync(StaffTokenScopes.Errors);

        var onlyGlobex = await ItemsAsync(await client.GetAsync($"{Recent}?product={globex.Slug}"));
        Assert.Equal(1, onlyGlobex.GetArrayLength());
        Assert.Equal(globex.Slug, onlyGlobex[0].GetProperty("product").GetProperty("slug").GetString());
        Assert.Equal(1, (await ItemsAsync(await client.GetAsync($"{Recent}?product={acme.Slug}&limit=1"))).GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{Recent}?product=nao-existe")).StatusCode);
    }

    [Fact]
    public async Task A_group_says_whether_a_ticket_or_a_task_already_references_it()
    {
        var acme = await ProductAsync();
        var now = DateTime.UtcNow;
        var withTicket = Id("sigT");
        var withTask = Id("sigK");
        var viaTrace = Id("sigV");
        var untouched = Id("sigU");
        var traceV = "trace-" + Guid.NewGuid().ToString("N")[..8];
        await WithDbAsync(fx, async db =>
        {
            db.ServerErrors.AddRange(
                Error(acme, withTicket, "t-t1", now.AddHours(-1)), Error(acme, withTask, "t-k1", now.AddHours(-1)),
                Error(acme, viaTrace, traceV, now.AddHours(-1)), Error(acme, untouched, "t-u1", now.AddHours(-1)));
            db.Tickets.Add(new Ticket
            {
                Id = Guid.NewGuid(), ProductId = acme.Id, Code = "20261110-" + Guid.NewGuid().ToString("N")[..4].ToUpperInvariant(),
                CustomerRef = "cust-1", Title = "Pedido não fecha", Body = "O pedido não fecha.", ErrorSignature = withTicket, Status = TicketStatuses.Open,
                CreatedAt = now, UpdatedAt = now,
            });
            db.Tickets.Add(new Ticket
            {
                Id = Guid.NewGuid(), ProductId = acme.Id, Code = "20261110-" + Guid.NewGuid().ToString("N")[..4].ToUpperInvariant(),
                CustomerRef = "cust-2", Title = "Erro ao pagar", Body = "Erro ao pagar.", TraceIds = [traceV], Status = TicketStatuses.Open,
                CreatedAt = now, UpdatedAt = now,
            });
            db.TeamTasks.Add(new TeamTask
            {
                Id = Guid.NewGuid(), ProductId = acme.Id, Code = "T-" + Guid.NewGuid().ToString("N")[..5].ToUpperInvariant(),
                Title = "Investigar erro de pedido", Body = $"Assinatura {withTask}, vista em produção.",
                CreatedByRef = "s1", CreatedByName = "Bia", CreatedAt = now, UpdatedAt = now,
            });
            await db.SaveChangesAsync();
        });
        var client = await TokenWithAsync(StaffTokenScopes.Errors);

        var items = (await ItemsAsync(await client.GetAsync($"{Recent}?product={acme.Slug}"))).EnumerateArray()
            .ToDictionary(i => i.GetProperty("signature").GetString()!);
        Assert.True(items[withTicket].GetProperty("tracked").GetBoolean());
        Assert.Equal(1, items[withTicket].GetProperty("tickets").GetProperty("open").GetInt32());
        Assert.Equal(0, items[withTicket].GetProperty("tasks").GetProperty("total").GetInt32());
        Assert.True(items[withTask].GetProperty("tracked").GetBoolean());
        Assert.Equal(1, items[withTask].GetProperty("tasks").GetProperty("total").GetInt32());
        Assert.StartsWith("T-", items[withTask].GetProperty("tasks").GetProperty("codes")[0].GetString());
        Assert.True(items[viaTrace].GetProperty("tracked").GetBoolean());
        Assert.Equal(1, items[viaTrace].GetProperty("tickets").GetProperty("total").GetInt32());
        Assert.False(items[untouched].GetProperty("tracked").GetBoolean());
    }

    [Fact]
    public async Task Only_a_token_with_the_errors_scope_reads_them_and_only_this_route()
    {
        var plain = await TokenWithAsync(StaffTokenScopes.Tasks, StaffTokenScopes.Atlas);
        var refused = await plain.GetAsync(Recent);
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Contains("errors", (await refused.Json()).GetProperty("message").GetString());

        var reader = await TokenWithAsync(StaffTokenScopes.Errors);
        Assert.Equal(HttpStatusCode.OK, (await reader.GetAsync(Recent)).StatusCode);
        // The scope opens nothing else: not the board, the Atlas, nor the console's own error routes.
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.GetAsync("/v1/staff/tasks/board")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.GetAsync("/v1/staff/atlas")).StatusCode);
        Assert.True((await reader.GetAsync("/v1/staff/errors/groups")).StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden);

        var (session, _) = await SignInAsync(fx);
        Assert.Equal(HttpStatusCode.OK, (await session.GetAsync(Recent)).StatusCode);
    }

    [Fact]
    public async Task A_token_is_created_with_the_errors_scope_and_unknown_ones_are_refused()
    {
        var (session, _) = await SignInAsync(fx);
        var created = await session.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "Triagem", scopes = new[] { "tasks", "errors" } });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(["tasks", "errors"], (await created.Json()).GetProperty("scopes").EnumerateArray().Select(s => s.GetString()));
        var bad = await session.PostAsJsonAsync("/v1/staff/me/tokens", new { name = "Outro", scopes = new[] { "errors", "tudo" } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }
}
