# Pitwall.AspNetCore

Liga um produto ASP.NET Core ao [Pitwall](https://github.com/ivobraatz/pitwall): a ponte de suporte
(o navegador do cliente fala com a API do próprio produto, que encaminha ao Pitwall), o relatório de
erros do servidor e os webhooks assinados. Suporta .NET 9 e .NET 10.

```bash
dotnet add package Pitwall.AspNetCore
```

## Configuração

```csharp
builder.Services.AddPitwall(builder.Configuration.GetSection("Pitwall"));
// ou
builder.Services.AddPitwall(o =>
{
    o.BaseUrl = "https://pitwall.example.com";   // a API, não o console
    o.ApiKey = builder.Configuration["Pitwall:ApiKey"]!;   // escopos `support` e `errors`
    o.WebhookSecret = builder.Configuration["Pitwall:WebhookSecret"];   // `pwhs_…`
    o.Release = "1.4.2";
    o.Environment = builder.Environment.EnvironmentName;
});
```

`PitwallOptions`:

| Propriedade | Para que serve |
|---|---|
| `BaseUrl` | URL da API do Pitwall. |
| `ApiKey` | Chave do sistema, só no servidor. Nunca vai para o navegador. |
| `WebhookSecret` | Segredo `pwhs_…` usado para verificar os eventos enviados pelo Pitwall. |
| `Release` | Versão em execução, anexada a cada erro reportado. |
| `Environment` | Ambiente, anexado a cada erro reportado. |
| `IsConfigured` | `false` sem `BaseUrl` ou `ApiKey`: a ponte responde 503, os erros são descartados e nada falha na inicialização. |

## Ponte de suporte

```csharp
app.MapPitwallSupport("/api/v1/support", http =>
    ValueTask.FromResult<PitwallActor?>(new PitwallActor(
        CustomerId: http.User.FindFirst("ws")!.Value,
        UserId: http.User.FindFirst(ClaimTypes.NameIdentifier)?.Value,
        UserName: http.User.Identity?.Name)))
    .RequireAuthorization();
```

`MapPitwallSupport` encaminha `{prefixo}/**` para `/v1/support/**` do Pitwall. Quem o `resolveActor`
devolver como `null` recebe 401. `PitwallActor` identifica a conta do cliente (`CustomerId`, que é o
limite de quem vê cada chamado), e opcionalmente a pessoa. Envie o e-mail (`UserEmail`) só se a
equipe deve vê-lo.

## Erros do servidor

```csharp
app.UseExceptionHandler(errApp => errApp.Run(async http =>
{
    var ex = http.Features.Get<IExceptionHandlerFeature>()?.Error;
    if (ex is not null)
    {
        var reporter = http.RequestServices.GetRequiredService<IPitwallErrorReporter>();
        reporter.Report(PitwallServerError.From(http, ex, sanitize: Scrub));
    }
    http.Response.StatusCode = 500;
}));
```

`IPitwallErrorReporter.Report` enfileira o erro e retorna na hora; os envios saem em lotes, em
segundo plano, e nunca lançam exceção para quem chamou. `PitwallServerError.From` monta o relatório
a partir da requisição e da exceção: o `TraceIdentifier` é o mesmo id que o produto já devolve ao
navegador, então um chamado encontra o erro correspondente. Passe `sanitize` para remover segredos,
connection strings e SQL da mensagem e do stack trace antes de sair do processo.

## Webhooks

```csharp
app.MapPitwallWebhook("/pitwall/webhook", (evt, http) =>
{
    // evt.Type: ticket.created, ticket.replied, ticket.status_changed, release.published, ping
    // Trate de forma idempotente por evt.Id: o Pitwall tenta de novo quando a resposta não é 2xx.
    return Task.CompletedTask;
});
```

A assinatura é verificada antes do handler rodar; uma assinatura inválida ou antiga responde 401.

## Licença

MIT. Veja o [repositório](https://github.com/ivobraatz/pitwall).
