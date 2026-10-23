# pitwall-sdk

SDK do [Pitwall](https://github.com/ivobraatz/pitwall): chamados dentro do próprio produto, com
diagnóstico, gravação de tela e a ponte com o backend. Funciona no navegador (qualquer framework ou
HTML puro) e no Node.

## Instalação

O pacote se chama `pitwall-sdk` no npm. Instale com um alias para continuar importando
`@pitwall/sdk`:

```json
"dependencies": {
  "@pitwall/sdk": "npm:pitwall-sdk@^0.1.0"
}
```

## No navegador

```ts
import { Pitwall } from '@pitwall/sdk';

const pitwall = Pitwall.init({
  endpoint: '/api/v1/support',             // a ponte do próprio produto (veja abaixo)
  app: { version: '0.3.120', commit: 'abc1234' },
  ticketHref: (id) => `/support/view?id=${id}`,
});

pitwall.openNewTicket();                   // a partir de um botão "Relatar problema"
```

`Pitwall.init` começa a capturar diagnóstico e a gravação contínua, e monta o diálogo de chamado, a
barra de gravação e os avisos em `document.body`. Chame uma vez, depois do login, porque a ponte
precisa de uma sessão. Chamar de novo substitui a instância anterior. A instância também expõe
`startRecording`, `log`, `recordRequest`, `recordEvent`, `toast` e `openTicket`.

Nas páginas de suporte do produto, use os Web Components:

- `<pitwall-tickets></pitwall-tickets>`: lista de chamados do cliente.
- `<pitwall-ticket ticket-id="…"></pitwall-ticket>`: um chamado, com a conversa.
- `<pitwall-player>`: reprodução de uma gravação (também em `@pitwall/sdk/player`).

Funciona igual em React, Vue ou HTML puro. No Vue, avise o compilador:
`isCustomElement: (tag) => tag.startsWith('pitwall-')`.

## No servidor (Node)

`@pitwall/sdk/server` é a ponte entre o navegador do cliente e a API do Pitwall. A chave do
sistema fica só no servidor, e a pessoa é identificada pela sessão que o próprio produto já tem.

```ts
import { createSupportBridge, createErrorReporter, verifyWebhook } from '@pitwall/sdk/server';

const bridge = createSupportBridge({
  baseUrl: process.env.PITWALL_URL!,
  apiKey: process.env.PITWALL_KEY!,                  // escopo `support`
  resolveActor: async (req) => {
    const s = await session(req);                     // a sessão do produto
    return s && { customerId: s.companyId, userId: s.userId, userName: s.name };
  },
});

// Rota do Next.js (app/api/support/[[...path]]/route.ts)
export const GET = (req: Request, ctx) => bridge.handle(req, (await ctx.params).path ?? []);
export const POST = GET;

// Erros do servidor (escopo `errors`): enfileira e envia em lotes, sem lançar exceção
const errors = createErrorReporter({ baseUrl: process.env.PITWALL_URL!, apiKey: process.env.PITWALL_ERRORS_KEY!, release: '1.0.0' });

// Webhooks do Pitwall: confira a assinatura antes de usar o corpo
const evt = verifyWebhook(process.env.PITWALL_WEBHOOK_SECRET!, req.headers.get('pitwall-signature'), rawBody);
```

`bridge.handle` recusa com 401 quando `resolveActor` devolve nada. `verifyWebhook` devolve o evento
ou `null` quando a assinatura não confere ou está fora da tolerância de 5 minutos.

## Fastify

```ts
import pitwallSupport from '@pitwall/sdk/fastify';

await app.register(pitwallSupport, {
  baseUrl: process.env.PITWALL_URL!,
  apiKey: process.env.PITWALL_KEY!,
  resolveActor: (request) => ({ customerId: request.session.companyId, userId: request.session.userId }),
});
```

## Diagnóstico

`@pitwall/sdk/diagnostics` expõe o buffer de diagnóstico (logs, requisições, erros e eventos
recentes) para quem quiser ler ou anexar o contexto por conta própria, por exemplo com
`snapshotDiagnostics()`.

## Licença

MIT. Veja o [repositório](https://github.com/ivobraatz/pitwall).
