using System.Net;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using Pitwall.Domain;

namespace Pitwall.Services.Mail;

/// <summary>
/// Tells the team's inbox that a customer wrote. The customer's own notifications (bell, e-mail)
/// are the product's job, through webhooks — the product knows the person's address, language
/// and preferences; Pitwall deliberately does not. The exception is a contact from a public
/// form: there is no product screen to answer on, so the mail's Reply-To is the person's address.
///
/// Never fails the request that triggered it: a ticket that was saved but not announced is still
/// a ticket, and the console's queue shows it either way.
/// </summary>
public sealed class TeamInbox(IConfiguration config, ILogger<TeamInbox> logger)
{
    public bool Enabled => !string.IsNullOrWhiteSpace(config["Smtp:Host"]) && !string.IsNullOrWhiteSpace(config["Pitwall:InboxEmail"]);

    public async Task TicketActivityAsync(Product product, Ticket ticket, bool isNew, string body, CancellationToken ct)
    {
        if (!Enabled) return;
        try
        {
            await SendAsync(Compose(product, ticket, isNew, body), ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Team inbox mail for ticket {Code} failed.", ticket.Code);
        }
    }

    internal MimeMessage Compose(Product product, Ticket ticket, bool isNew, string body)
    {
        var consoleUrl = (config["Pitwall:ConsoleUrl"] ?? "").TrimEnd('/');
        var link = $"{consoleUrl}/tickets/{ticket.Id}";
        var contact = ticket.Category == TicketCategories.Contact;
        var subject = (isNew, contact) switch
        {
            (true, true) => $"[{product.Name}] Novo contato {ticket.Code}: {ticket.Title}",
            (true, false) => $"[{product.Name}] Novo chamado {ticket.Code}: {ticket.Title}",
            _ => $"[{product.Name}] Resposta do cliente em {ticket.Code}: {ticket.Title}",
        };
        var who = $"{ticket.OpenedByName ?? "—"} · {ticket.CustomerName ?? ticket.CustomerRef}";
        var hint = contact ? "<p style=\"color:#666;margin:16px 0 0\">Responder este e-mail vai para quem escreveu.</p>" : "";
        var html = $"""
            <div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
              <p style="color:#666;margin:0 0 4px">{WebUtility.HtmlEncode(product.Name)} · {WebUtility.HtmlEncode(ticket.Code)} · {WebUtility.HtmlEncode(ticket.Category)} · {WebUtility.HtmlEncode(ticket.Severity)}</p>
              <h2 style="margin:0 0 8px;font-size:18px">{WebUtility.HtmlEncode(ticket.Title)}</h2>
              <p style="color:#666;margin:0 0 12px">{WebUtility.HtmlEncode(who)}</p>
              <div style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:12px">{WebUtility.HtmlEncode(body.Length > 4000 ? body[..4000] + "…" : body)}</div>
              <p style="margin-top:16px"><a href="{WebUtility.HtmlEncode(link)}">Abrir no Pitwall</a></p>{hint}
            </div>
            """;

        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(config["Smtp:From"] ?? "pitwall@localhost"));
        message.To.Add(MailboxAddress.Parse(config["Pitwall:InboxEmail"]!));
        if (contact && MailboxAddress.TryParse(ticket.OpenedByEmail, out var person))
        {
            if (!string.IsNullOrWhiteSpace(ticket.OpenedByName)) person.Name = ticket.OpenedByName;
            message.ReplyTo.Add(person);
        }
        message.Subject = subject;
        message.Body = new TextPart("html") { Text = html };
        return message;
    }

    private async Task SendAsync(MimeMessage message, CancellationToken ct)
    {
        using var smtp = new SmtpClient();
        var port = int.TryParse(config["Smtp:Port"], out var p) ? p : 587;
        await smtp.ConnectAsync(config["Smtp:Host"], port, port == 465 ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTlsWhenAvailable, ct);
        if (!string.IsNullOrWhiteSpace(config["Smtp:User"]))
            await smtp.AuthenticateAsync(config["Smtp:User"], config["Smtp:Password"], ct);
        await smtp.SendAsync(message, ct);
        await smtp.DisconnectAsync(true, ct);
    }
}
