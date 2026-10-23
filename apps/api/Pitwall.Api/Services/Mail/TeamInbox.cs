using System.Net;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using Pitwall.Domain;

namespace Pitwall.Services.Mail;

/// <summary>
/// Tells the team's inbox that a customer wrote. The customer's own notifications (bell, e-mail)
/// are the product's job, through webhooks — the product knows the person's address, language
/// and preferences; Pitwall deliberately does not.
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
            var consoleUrl = (config["Pitwall:ConsoleUrl"] ?? "").TrimEnd('/');
            var link = $"{consoleUrl}/tickets/{ticket.Id}";
            var subject = isNew
                ? $"[{product.Name}] Novo chamado {ticket.Code}: {ticket.Title}"
                : $"[{product.Name}] Resposta do cliente em {ticket.Code}: {ticket.Title}";
            var who = $"{ticket.OpenedByName ?? "—"} · {ticket.CustomerName ?? ticket.CustomerRef}";
            var html = $"""
                <div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
                  <p style="color:#666;margin:0 0 4px">{WebUtility.HtmlEncode(product.Name)} · {WebUtility.HtmlEncode(ticket.Code)} · {WebUtility.HtmlEncode(ticket.Category)} · {WebUtility.HtmlEncode(ticket.Severity)}</p>
                  <h2 style="margin:0 0 8px;font-size:18px">{WebUtility.HtmlEncode(ticket.Title)}</h2>
                  <p style="color:#666;margin:0 0 12px">{WebUtility.HtmlEncode(who)}</p>
                  <div style="white-space:pre-wrap;border-left:3px solid #ddd;padding-left:12px">{WebUtility.HtmlEncode(body.Length > 4000 ? body[..4000] + "…" : body)}</div>
                  <p style="margin-top:16px"><a href="{WebUtility.HtmlEncode(link)}">Abrir no Pitwall</a></p>
                </div>
                """;
            await SendAsync(config["Pitwall:InboxEmail"]!, subject, html, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Team inbox mail for ticket {Code} failed.", ticket.Code);
        }
    }

    private async Task SendAsync(string to, string subject, string html, CancellationToken ct)
    {
        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(config["Smtp:From"] ?? "pitwall@localhost"));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = subject;
        message.Body = new TextPart("html") { Text = html };

        using var smtp = new SmtpClient();
        var port = int.TryParse(config["Smtp:Port"], out var p) ? p : 587;
        await smtp.ConnectAsync(config["Smtp:Host"], port, port == 465 ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTlsWhenAvailable, ct);
        if (!string.IsNullOrWhiteSpace(config["Smtp:User"]))
            await smtp.AuthenticateAsync(config["Smtp:User"], config["Smtp:Password"], ct);
        await smtp.SendAsync(message, ct);
        await smtp.DisconnectAsync(true, ct);
    }
}
