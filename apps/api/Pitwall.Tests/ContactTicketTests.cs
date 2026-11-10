using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Pitwall.Auth;
using Pitwall.Domain;
using Pitwall.Services.Mail;

namespace Pitwall.Tests;

/// <summary>A contact from a site's public form: a ticket the team answers by e-mail.</summary>
public class ContactTicketTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    [Fact]
    public async Task A_site_form_opens_a_contact_ticket_that_the_product_widget_does_not_offer()
    {
        var (_, supportKey, _, _) = await fx.SeedProductAsync();
        var site = fx.Client(supportKey, new Actor("ana@acme.test", "Acme Ltda", "ana@acme.test", "Ana Souza", "ana@acme.test"));

        var config = await site.GetFromJsonAsync<JsonElement>("/v1/support/config");
        var choices = config.GetProperty("categories").EnumerateArray().Select(c => c.GetString()).ToList();
        Assert.DoesNotContain(TicketCategories.Contact, choices);
        Assert.Contains(TicketCategories.Bug, choices);

        var res = await site.PostAsJsonAsync("/v1/support/tickets", new { title = "Briefing: portal", body = "Precisamos de um portal.", category = "contact" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var id = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        var ticket = await site.GetFromJsonAsync<JsonElement>($"/v1/support/tickets/{id}");
        Assert.Equal(TicketCategories.Contact, ticket.GetProperty("category").GetString());
    }

    private static TeamInbox Inbox() => new(
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Smtp:From"] = "pitwall@acme.test", ["Pitwall:InboxEmail"] = "equipe@acme.test", ["Pitwall:ConsoleUrl"] = "https://pitwall.acme.test/",
        }).Build(),
        NullLogger<TeamInbox>.Instance);

    private static Ticket Ticket(string category) => new()
    {
        Id = Guid.NewGuid(), Code = "20261110-7K3Q", Title = "Briefing: portal", Body = "Precisamos de um portal.",
        CustomerRef = "ana@acme.test", CustomerName = "Acme Ltda", OpenedByName = "Ana Souza", OpenedByEmail = "ana@acme.test",
        Category = category,
    };

    [Fact]
    public void The_team_mail_for_a_contact_replies_to_the_person()
    {
        var mail = Inbox().Compose(new Product { Name = "Site" }, Ticket(TicketCategories.Contact), isNew: true, "Precisamos de um portal.");
        Assert.StartsWith("[Site] Novo contato 20261110-7K3Q", mail.Subject);
        var reply = Assert.Single(mail.ReplyTo.Mailboxes);
        Assert.Equal("ana@acme.test", reply.Address);
        Assert.Equal("Ana Souza", reply.Name);
        Assert.Equal("equipe@acme.test", Assert.Single(mail.To.Mailboxes).Address);
    }

    [Fact]
    public void A_product_ticket_mail_keeps_the_team_in_the_console()
    {
        var mail = Inbox().Compose(new Product { Name = "Site" }, Ticket(TicketCategories.Bug), isNew: true, "Erro ao exportar");
        Assert.StartsWith("[Site] Novo chamado", mail.Subject);
        Assert.Empty(mail.ReplyTo);
    }
}
