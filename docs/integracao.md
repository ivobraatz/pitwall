# Ligando um sistema ao Pitwall

Este guia diz o que um sistema precisa implementar para usar o Pitwall (chamados, erros de servidor,
avisos e novidades). O [produto demo](../examples/demo-product) implementa tudo isso em um arquivo,
e é a referência para testar. Os sistemas reais estão na seção [Sistemas já integrados](#sistemas-já-integrados-referência).

- [Visão geral](#visão-geral)
- [Checklist: ligar um sistema novo](#checklist-ligar-um-sistema-novo)
- [Por stack](#por-stack)
- [Contrato HTTP](#contrato-http)
- [Sistemas já integrados (referência)](#sistemas-já-integrados-referência)
- [Referência rápida do SDK](#referência-rápida-do-sdk)
- [Problemas comuns](#problemas-comuns)

---

## Visão geral

Um sistema implementa quatro coisas. Nenhuma delas fala com o navegador sobre o Pitwall diretamente:

```
navegador (SDK @pitwall/sdk)
   │  Pitwall.init · <pitwall-tickets> · <pitwall-ticket> · "Relatar um problema"
   │  envia a sessão do sistema (cookie, ou bearer se o front usar token)
   ▼
backend do sistema
   │  1. ponte  /api/.../support/**   → autentica a pessoa, acrescenta a chave e o Pitwall-Actor
   │  2. erros  5xx em lote           → mesmo trace id que vai na resposta ao navegador
   ▼
Pitwall API  (/v1/support · /v1/ingest · /v1/public)
   │
   └── 3. webhooks assinados (ticket.*, release.published) ──► backend do sistema
                                                               4. novidades: o CI manda os
                                                                  commits (action release-notes)
```

1. **Ponte.** O backend do sistema expõe um prefixo próprio (`/api/v1/support`) que o navegador chama
   com a sessão normal. O backend confere quem é a pessoa, e repassa a requisição ao Pitwall com a chave
   do sistema e o cabeçalho `Pitwall-Actor`. O navegador nunca vê a chave.
2. **Erros.** Todo 5xx que o backend produz vai para `/v1/ingest/errors`, com o trace id que também foi
   devolvido ao navegador. Assim um chamado aberto a partir do erro encontra o stack trace.
3. **Webhooks.** O Pitwall avisa o backend quando a equipe responde, quando um chamado muda de situação
   e quando uma versão é publicada. O backend avisa as pessoas do jeito do produto.
4. **Navegador e novidades.** `Pitwall.init` depois do login liga o diagnóstico e as telas de chamado.
   Um workflow de CI envia os commits do release para o Pitwall escrever a nota.

### Pacotes

- **npm:** `pitwall-sdk`, público. O produto instala com um alias para continuar importando `@pitwall/sdk`:

  ```json
  "@pitwall/sdk": "npm:pitwall-sdk@^0.1.0"
  ```

  Sem token e sem `.npmrc`.
- **NuGet:** `Pitwall.AspNetCore` (público; mira `net9.0` e `net10.0`). Como referenciar, em
  desenvolvimento e em produção, está em [Por stack → ASP.NET Core](#asp-net-core).

Publicar uma nova versão dos pacotes é feito pelo workflow `.github/workflows/release.yml`, ao criar a tag `v<versão>`.

---

## Checklist: ligar um sistema novo

Faça na ordem. Cada passo termina com uma forma de verificar antes de seguir.

### 1. Cadastrar o sistema no console

- **Faça:** no console, *Sistemas → Novo sistema*. Preencha **Nome**, **Identificador** (minúsculas, aparece
  nas chaves e no changelog público, ex.: `datarunner`) e **O que é** (uma ou duas frases; o redator das
  novidades lê isso para saber quem são os leitores).
  Depois, na página do sistema, configure:
  - **Nome da equipe para o cliente**: quem assina as respostas. Padrão: o nome do sistema.
  - **Tela do chamado no sistema**: para o link "ver no sistema" nos e-mails da equipe. Use `{id}`.
  - **Marcadores do código próprio**: um por linha, ex.: `DataRunner.` ou `/apps/api/src/`. A assinatura
    de um erro usa o primeiro frame do stack que contém um desses marcadores, então um frame de framework
    no topo não divide um bug em vários.
- **Verifique:** o sistema aparece na lista de *Sistemas* e a página abre sem erro.

### 2. Gerar as chaves

- **Faça:** na página do sistema, card **Chaves → Nova chave**:
  - backend do sistema: escopos `support` e `errors` (são os dois marcados por padrão);
  - CI (só para as novidades): escopo `releases`, e nada mais.
  
  A chave aparece uma vez. Ela tem a forma `pw_<identificador>_…`. Guarde no cofre de segredos do backend
  ou do CI, nunca no código do front.
- **Verifique:** a chave aparece na lista com o prefixo e os escopos. Uma chave sem `support` faz a ponte
  responder 403 (passo 3).

### 3. Configurar as variáveis de ambiente do backend

Use os nomes abaixo. Com ASP.NET Core, o `GetSection("Pitwall")` lê `Pitwall__BaseUrl` etc.:

```
# ASP.NET Core
Pitwall__BaseUrl=https://pitwall.suaempresa.com      # a API, não o console
Pitwall__ApiKey=pw_<identificador>_…                 # support + errors
Pitwall__WebhookSecret=pwhs_…                        # card Webhook → Gerar segredo
Pitwall__Release=1.4.2                               # opcional: versão que aparece nos erros
Pitwall__Environment=production                      # opcional

# Node (o demo e o metrifree usam estes nomes)
PITWALL_URL=https://pitwall.suaempresa.com
PITWALL_KEY=pw_<identificador>_…
PITWALL_WEBHOOK_SECRET=pwhs_…
```

Esses valores ficam só no backend. Nenhum deles vai para o bundle do navegador.

- **Verifique:** com o backend no ar e uma pessoa logada, `GET` no caminho da ponte (passo 4) responde o
  JSON de `/v1/support/config`. Sem a configuração, a ponte do ASP.NET responde 503.

### 4. Ponte: o backend repassa `…/support/**` ao Pitwall

- **Faça:** registre a ponte com um prefixo do seu backend e uma função que diz quem é a pessoa.
  A função lê a sessão do *seu* sistema. Nunca aceite cliente ou pessoa vindos do corpo ou da URL. Ela
  devolve `null` quando não há sessão, e a ponte responde 401. Detalhes por stack em
  [Por stack](#por-stack).
  - `customerId` é a fronteira: a pessoa vê os chamados do próprio cliente (workspace, empresa, organização)
    e de nenhum outro. Use o id estável do cliente no seu sistema.
  - `userEmail` só se a equipe precisa dele para responder. É opcional.
- **Verifique:** logada, a pessoa acessa `GET /api/v1/support/config` no seu front e recebe `product`,
  `teamName`, `categories`, `severities`, `statuses` e `maxAttachmentBytes`. Sem sessão, recebe 401.

### 5. Erros de servidor: reportar 5xx com o mesmo trace id

- **Faça:** no tratador de exceções do backend, para cada resposta 5xx, envie o erro com o trace id da
  requisição. Devolva esse mesmo id ao navegador, no cabeçalho `X-Trace-Id` e/ou no corpo como `traceId`.
  O SDK lê os dois. Sanitize mensagem e stack antes de enviar (senhas, connection strings, tokens, SQL).
  Só erros do próprio sistema contam; 4xx são do chamador.
- **Verifique:** provoque um 500 numa tela (no demo, o botão "Rodar relatório"). A resposta traz o `traceId`
  e, no console do Pitwall, em *Erros*, aparece o mesmo trace id com o cliente e o usuário certos.

### 6. Webhook: receber e tratar os eventos

- **Faça:** no card **Webhook** da página do sistema, informe a URL (ex.: `https://api.seusistema.com/api/v1/webhooks/pitwall`)
  e clique em **Gerar segredo** (copie o `pwhs_…` na hora; ele não é mostrado de novo). O endpoint:
  1. lê o **corpo cru** (texto), antes de qualquer parse de JSON;
  2. verifica `Pitwall-Signature` contra esse corpo (ver [Contrato HTTP → Webhooks](#webhooks)); assinatura inválida, ausente ou com mais de 5 minutos: responde 401;
  3. guarda `id` do evento e pula eventos já tratados. O Pitwall reenvia tudo que não recebeu 2xx, então o
     tratamento tem que ser idempotente. O demo do metrifree faz isso com um insert com `onConflictDoNothing`
     em uma tabela de chaves;
  4. responde 2xx **rápido**. O Pitwall espera 15 s no máximo; trabalho pesado vai para uma fila.

  O que fazer por evento:

  | Evento | Ação típica |
  |---|---|
  | `ticket.created` | avisar os administradores do cliente de que alguém abriu um chamado |
  | `ticket.replied` | avisar a pessoa que abriu, com `message.body`, assinado por `message.teamName` |
  | `ticket.status_changed` | avisar a pessoa em `fixed_pending_deploy` ("correção a caminho") e `resolved`. Ignore `reason: "customer"`, quem mudou foi ela |
  | `release.published` | gravar `data.notes.pt` e `data.notes.en` como o changelog do produto |
  | `ping` | nada; é o teste do console |

- **Verifique:** clique em **Testar** no card Webhook. A entrega aparece como `delivered` no histórico. Com
  um segredo errado no backend, a entrega fica pendente, com `HTTP 401` como último erro, e é tentada de novo.

### 7. Navegador: `Pitwall.init`, o botão e as telas

- **Faça:** chame `Pitwall.init` uma vez, **depois do login**. Passe `endpoint` (a ponte do passo 4), o que
  identifica o cliente se o front não usa cookie (`headers`), `locale`, `ticketHref` e `navigate` (o
  roteador do produto). Por stack, em [Por stack](#por-stack).
  - Botão **"Relatar um problema"** em qualquer lugar: `Pitwall.current.openNewTicket()`.
  - Página de lista: `<pitwall-tickets>`. Página de um chamado: `<pitwall-ticket ticket-id="…">`.
  - Tema: defina as variáveis `--pw-*` no CSS global do sistema (lista na [referência](#referência-rápida-do-sdk)).
  - Privacidade na gravação: marque com `data-pw-mask` (ou `.pw-mask`) o texto que nunca deve sair, e com
    `data-pw-block` o elemento que nunca deve ser gravado. Tabelas e inputs já são mascarados por padrão.
- **Verifique:** o botão abre o formulário; um chamado enviado aparece na fila do console. O diagnóstico vai
  junto só se a pessoa mantiver o anexo marcado, e a gravação da tela só sobe se ela anexar.

### 8. Novidades: o release vira nota

- **Faça:** um workflow no repositório do sistema chama a action `release-notes`. Ela pega os commits desde a
  última tag `notes/*`, manda ao Pitwall, que escreve a nota com o Claude e publica (ou deixa rascunho,
  conforme a opção *Publicar novidades sozinho* na página do sistema). Veja `.github/actions/release-notes/action.yml`
  para todas as entradas.

  ```yaml
  name: Novidades
  on:
    workflow_dispatch:
    push:
      branches: [main]
  permissions:
    contents: write            # a action empurra a tag de marcação notes/*
  jobs:
    notes:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
          with: { fetch-depth: 0 }
        - uses: ivobraatz/pitwall/.github/actions/release-notes@v0.1.0
          with:
            pitwall-url: ${{ vars.PITWALL_URL }}
            release-key: ${{ secrets.PITWALL_RELEASE_KEY }}
            version-from: apps/console/package.json
  ```

  Configure no repositório do sistema: a variável `PITWALL_URL` (Settings → Variables) e o segredo
  `PITWALL_RELEASE_KEY` (a chave com escopo `releases`). Commits com menos de 30 min (`settle-minutes`)
  ficam para a próxima execução. Para ver a nota sem publicar, rode uma vez com `dry-run: 'true'`.
  Commits só de manutenção (`docs`, `test`, `ci`, `build`, `chore`, `style`, `refactor`) não entram.
- **Verifique:** a execução com `dry-run` mostra a nota no log, sem publicar. A execução real faz aparecer
  o release em `GET /v1/public/<identificador>/releases`, e `release.published` chega ao webhook (passo 6).

### 9. Testar de ponta a ponta, localmente

Veja [Testes](#testes-de-ponta-a-ponta) logo abaixo.

---

## Por stack

Os trechos abaixo usam exatamente os nomes da API dos pacotes. Os nomes das suas claims, do seu
banco e das suas funções são placeholders para trocar.

### ASP.NET Core

**1. Referência ao pacote, com checkout local quando existir.** Use este bloco no `.csproj` da API, como
faz o DataRunner (`apps/api/DataRunner.Api/DataRunner.Api.csproj`). Com um checkout do Pitwall ao lado do
repositório, o cliente é compilado do código-fonte. Sem ele (CI, Railway), o pacote NuGet é usado. Ajuste o
número de `..` para a profundidade do seu `.csproj`; o caminho aponta para `…\pitwall\packages\dotnet\Pitwall.AspNetCore\Pitwall.AspNetCore.csproj`:

```xml
  <PropertyGroup>
    <PitwallClientProject>$(MSBuildThisFileDirectory)..\..\..\..\pitwall\packages\dotnet\Pitwall.AspNetCore\Pitwall.AspNetCore.csproj</PitwallClientProject>
  </PropertyGroup>
  <ItemGroup Condition="Exists('$(PitwallClientProject)')">
    <ProjectReference Include="$(PitwallClientProject)" />
  </ItemGroup>
  <ItemGroup Condition="!Exists('$(PitwallClientProject)')">
    <PackageReference Include="Pitwall.AspNetCore" Version="0.1.*" />
  </ItemGroup>
```

**2. Registro, ponte e webhook** (`Program.cs`):

```csharp
using System.Security.Claims;
using Pitwall.AspNetCore;

builder.Services.AddPitwall(builder.Configuration.GetSection("Pitwall"));
// ...
app.MapPitwallSupport("/api/v1/support", ResolveActorAsync).RequireAuthorization();
app.MapPitwallWebhook("/api/v1/webhooks/pitwall", HandlePitwallEventAsync);

// Quem o sistema já autenticou. Nunca leia cliente ou pessoa do corpo da requisição.
static ValueTask<PitwallActor?> ResolveActorAsync(HttpContext http)
{
    var user = http.User;
    var customerId = user.FindFirst("tenant_id")?.Value;          // troque pela claim do seu sistema
    if (string.IsNullOrWhiteSpace(customerId)) return ValueTask.FromResult<PitwallActor?>(null);
    return ValueTask.FromResult<PitwallActor?>(new PitwallActor(
        CustomerId: customerId,
        CustomerName: user.FindFirst("empresa")?.Value,
        UserId: user.FindFirst(ClaimTypes.NameIdentifier)?.Value,
        UserName: user.FindFirst(ClaimTypes.Name)?.Value,
        UserEmail: user.FindFirst(ClaimTypes.Email)?.Value));
}

static async Task HandlePitwallEventAsync(PitwallEvent evt, HttpContext http)
{
    // O Pitwall reenvia até receber 2xx: pule evt.Id que já foi tratado (recibo no seu banco).
    var data = evt.Data;
    switch (evt.Type)
    {
        case "ticket.replied":
            var code = data.GetProperty("ticket").GetProperty("code").GetString();
            var teamName = data.GetProperty("message").GetProperty("teamName").GetString();
            // avise a pessoa em ticket.openedByUserId com "{teamName} respondeu o chamado {code}"
            break;
        case "release.published":
            var pt = data.GetProperty("notes").GetProperty("pt");   // title, summary, slug, new, improvements, bodyMarkdown
            // grave pt (e en) como o changelog do produto
            break;
    }
}
```

`MapPitwallSupport` mapeia `GET` e `POST` em `{prefixo}/{**path}`. Sem configuração (`Pitwall:BaseUrl` ou
`Pitwall:ApiKey` vazios), a ponte responde 503 e nada quebra na inicialização. `MapPitwallWebhook` verifica
a assinatura antes do seu código e responde 401 quando ela está errada, ausente ou fora da janela.

**3. Reporte de erros 5xx** (middleware):

```csharp
public sealed class ErrorHandlingMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, IPitwallErrorReporter errors)
    {
        try { await next(context); }
        catch (Exception ex)
        {
            // mantenha aqui o seu log
            const int status = StatusCodes.Status500InternalServerError;
            errors.Report(PitwallServerError.From(context, ex, status,
                customerId: context.User.FindFirst("tenant_id")?.Value,
                sanitize: Sanitizer.Clean));   // seu sanitizador: tira senhas, connection strings e tokens
            context.Response.StatusCode = status;
            context.Response.Headers["X-Trace-Id"] = context.TraceIdentifier;
            await context.Response.WriteAsJsonAsync(new { error = "Erro interno do servidor.", traceId = context.TraceIdentifier });
        }
    }
}
```

Registre com `app.UseMiddleware<ErrorHandlingMiddleware>();`. `PitwallServerError.From` usa
`http.TraceIdentifier` como trace id, o mesmo valor que o middleware devolve. O reporter agrupa por lotes em
segundo plano e nunca lança exceção na requisição.

### Node / Next.js (route handler)

A ponte, o reporter de erros e a verificação de webhook são do pacote `@pitwall/sdk/server`:

```ts
// app/api/support/[[...path]]/route.ts
import { createSupportBridge } from '@pitwall/sdk/server';
import { currentUser } from '@/lib/session';                      // seu sistema

const bridge = createSupportBridge({
  baseUrl: process.env.PITWALL_URL!,
  apiKey: process.env.PITWALL_KEY!,                               // chave com support; só no servidor
  resolveActor: async (req: Request) => {
    const user = await currentUser(req);
    return user
      ? { customerId: user.companyId, customerName: user.companyName, userId: user.id, userName: user.name, userEmail: user.email }
      : null;                                                      // null = 401
  },
});

type Ctx = { params: Promise<{ path?: string[] }> };

async function forward(req: Request, ctx: Ctx) {
  const { path = [] } = await ctx.params;
  return bridge.handle(req, path);
}

export { forward as GET, forward as POST };
```

Erros de 5xx e webhook, no mesmo projeto:

```ts
// lib/pitwall-server.ts
import { createErrorReporter, verifyWebhook } from '@pitwall/sdk/server';

export const errors = createErrorReporter({
  baseUrl: process.env.PITWALL_URL!,
  apiKey: process.env.PITWALL_KEY!,
  release: process.env.APP_VERSION,
});

// No catch do handler, para status 5xx:
//   const traceId = crypto.randomUUID().replaceAll('-', '');
//   errors.reportError(err, { traceId, method: req.method, path: new URL(req.url).pathname, statusCode: 500 });
//   return Response.json({ message: 'Erro interno', traceId }, { status: 500, headers: { 'x-trace-id': traceId } });
```

```ts
// app/api/webhooks/pitwall/route.ts
import { verifyWebhook } from '@pitwall/sdk/server';

export async function POST(req: Request) {
  const raw = await req.text();                                    // o corpo cru, antes de qualquer JSON.parse
  const evt = verifyWebhook(process.env.PITWALL_WEBHOOK_SECRET!, req.headers.get('pitwall-signature'), raw);
  if (!evt) return Response.json({ message: 'assinatura inválida' }, { status: 401 });
  // trate evt.id uma vez; evt.type e evt.data (ver a tabela do passo 6)
  return Response.json({ ok: true });
}
```

`verifyWebhook` devolve o evento tipado, ou `null` quando a assinatura não bate ou passou de 5 minutos.

### Fastify

O plugin registra a ponte no escopo que você escolher. O corpo passa cru, então multipart (anexos) chega intacto:

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pitwallSupport } from '@pitwall/sdk/fastify';
import { createErrorReporter, verifyWebhook } from '@pitwall/sdk/server';

export async function registerPitwall(app: FastifyInstance) {
  await app.register(pitwallSupport, {
    prefix: '/api/support',
    baseUrl: process.env.PITWALL_URL!,
    apiKey: process.env.PITWALL_KEY!,
    resolveActor: async (req: FastifyRequest) => {
      const user = await resolveUser(req);                         // seu sistema
      return user ? { customerId: user.orgId, userId: user.id, userName: user.name } : null;
    },
  });

  const errors = createErrorReporter({ baseUrl: process.env.PITWALL_URL!, apiKey: process.env.PITWALL_KEY!, release: process.env.APP_VERSION });
  app.setErrorHandler(async (err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) return reply.code(status).send({ error: err.message });
    errors.reportError(err, { traceId: req.id, method: req.method, path: req.url.split('?')[0], routeTemplate: req.routeOptions.url, statusCode: status });
    return reply.code(status).header('x-trace-id', req.id).send({ error: 'erro interno', traceId: req.id });
  });

  // Webhook num escopo próprio, com o corpo lido como texto (a assinatura cobre o corpo exato).
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    scope.post('/api/webhooks/pitwall', async (req, reply) => {
      const raw = typeof req.body === 'string' ? req.body : '';
      const evt = verifyWebhook(process.env.PITWALL_WEBHOOK_SECRET!, req.headers['pitwall-signature'] as string | undefined, raw);
      if (!evt) return reply.code(401).send({ error: 'assinatura inválida' });
      // evt.id já tratado? responda 200 sem repetir o efeito
      return { ok: true };
    });
  });
}
```

Para o trace id funcionar, gere o id da requisição como o metrifree faz: `genReqId: () => randomUUID().replaceAll('-', '')`
na criação do Fastify. O id precisa ser único entre reinícios, porque é o trace id que o Pitwall guarda.

### Vue

`vite.config.ts`: diga ao compilador que as tags `pitwall-*` são custom elements:

```ts
vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('pitwall-') } } })
```

Inicialize depois do login (e destrua no logout com `Pitwall.current.destroy()`):

```ts
import { Pitwall } from '@pitwall/sdk';

Pitwall.init({
  endpoint: '/api/support',
  headers: () => ({ 'x-org-id': currentOrgId() }),              // o que o seu backend usa para achar o cliente
  locale: 'pt',
  ticketHref: (id) => `/suporte/${id}`,
  navigate: (href) => void router.push(href),
});
```

As telas são só as tags:

```vue
<!-- SupportView.vue -->
<template>
  <pitwall-tickets />
</template>

<!-- TicketView.vue -->
<template>
  <pitwall-ticket :ticket-id="id" />
</template>
<script setup lang="ts">
defineProps<{ id: string }>();
</script>
```

O botão "Relatar um problema" chama `Pitwall.current.openNewTicket()`.

### React (Next.js)

**Tipagem JSX dos elementos.** Copie o arquivo de tipos do DataRunner (`apps/console/components/support/pitwall-elements.d.ts`):

```ts
import type * as React from 'react';

type Element<P = object> = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & P;

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'pitwall-tickets': Element<{ 'no-header'?: boolean | '' }>;
      'pitwall-ticket': Element<{ 'ticket-id'?: string }>;
    }
  }
}
```

**Inicialização só no cliente.** O pacote raiz (`@pitwall/sdk`) registra elementos Lit e mexe no DOM ao ser
importado. Por isso o import é dinâmico, dentro de um efeito. O `cancelled` evita iniciar um SDK que já foi
desmontado (StrictMode monta duas vezes em desenvolvimento):

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { PitwallInstance } from '@pitwall/sdk';

export function PitwallBoot() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    let started: PitwallInstance | null = null;
    void import('@pitwall/sdk').then(({ Pitwall }) => {
      if (cancelled) return;
      started = Pitwall.init({
        endpoint: '/api/support',
        locale: 'pt',
        ticketHref: (id) => `/suporte/${id}`,
        navigate: (href) => router.push(href),
      });
    });
    return () => { cancelled = true; started?.destroy(); };
  }, [router]);
  return null;
}
```

As telas:

```tsx
// app/suporte/page.tsx
export default function SupportPage() {
  return <pitwall-tickets />;
}

// app/suporte/[id]/page.tsx
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <pitwall-ticket ticket-id={id} />;
}
```

**Diagnóstico em código que roda no servidor.** `@pitwall/sdk/diagnostics` não usa o DOM, então pode ser
importado em qualquer módulo, inclusive o que roda no SSR ou no build estático. Os buffers são os mesmos que o
SDK lê quando a pessoa abre um chamado:

```ts
import { recordLog, recordRequest } from '@pitwall/sdk/diagnostics';

recordLog('warn', ['importação parcial', { linhas: 120 }]);   // (nível, lista de argumentos)
recordRequest({ method: 'GET', path: '/api/reports', status: 500, ms: 84, traceId });
```

O cliente HTTP do produto alimenta esses buffers. Se o produto já liga o `fetch` por conta própria, use
`captureFetch: false` na inicialização e chame `recordRequest` e `pitwall.reportServerFailure` você mesmo, como
o DataRunner faz em `apps/console/lib/pitwall.ts`.

### Outra linguagem

O contrato é HTTP e está em [Contrato HTTP](#contrato-http). Você precisa de três coisas: a ponte (chamar
`/v1/support/**` com `Authorization: Bearer` e `Pitwall-Actor`), o envio de erros em lote para
`/v1/ingest/errors` e a verificação do webhook (HMAC-SHA256 sobre `t.corpo`). O demo em
[`examples/demo-product/server.mjs`](../examples/demo-product/server.mjs) faz os três com `node:http` puro, sem
framework, em cerca de 90 linhas.

---

## Contrato HTTP

Base: a URL da API do Pitwall (`Pitwall__BaseUrl` / `PITWALL_URL`). A API não é a do console.

### Autenticação das chamadas do produto

```
Authorization: Bearer pw_<identificador>_<segredo>
```

| Escopo | Usado por | Permite |
|---|---|---|
| `support` | ponte (backend do produto) | `/v1/support/**` |
| `errors` | reporte de erros (backend do produto) | `POST /v1/ingest/errors` |
| `releases` | CI (action `release-notes`) | `POST /v1/ingest/releases` |

Chave ausente, desconhecida ou revogada: **401** `A valid product key is required.`. Chave de outro
escopo: **403** `This key does not have the scope this endpoint needs.`. Revogação vale em até um minuto
(cache). Chaves são guardadas só como hash; o plaintext não pode ser recuperado depois de criado.

### Identidade: `Pitwall-Actor`

Obrigatório em todas as rotas de `/v1/support`, enviado pelo backend do produto (nunca pelo navegador):

```
Pitwall-Actor: base64url( JSON )
```

```json
{ "customerId": "ws-123", "customerName": "Acme Ltda", "userId": "u-42", "userName": "Ana Souza", "userEmail": "ana@acme.test" }
```

| Campo | Regra |
|---|---|
| `customerId` | obrigatório, até 100 caracteres. É a fronteira: a pessoa só vê chamados deste cliente |
| `customerName` | até 200. Nome que a equipe vê na fila |
| `userId` | até 100. Id da pessoa no produto |
| `userName` | até 200 |
| `userEmail` | até 320. Só se a equipe precisa; opcional |

Cabeçalho ausente, inválido ou acima de 4096 caracteres: **400** `The Pitwall-Actor header is missing or invalid.`
Base64url: sem padding obrigatório; `+` e `/` viram `-` e `_`.

### Limites de taxa

| Política | Limite | Chave da contagem |
|---|---|---|
| `support-writes` (POSTs de `/v1/support`) | 60 por minuto | produto + `Pitwall-Actor` |
| `ingest` (`/v1/ingest/*`) | 600 por minuto | produto |
| `login` (console) | 10 a cada 5 minutos | IP |

Estourou: **429**.

### Ponte: `/v1/support`

Todas as rotas exigem chave com escopo `support` e `Pitwall-Actor`. Tudo é filtrado pelo produto da chave
e pelo `customerId` do actor. Um id de chamado de outro cliente responde **404**.

| Método | Caminho | Corpo / parâmetros | Resposta |
|---|---|---|---|
| `GET` | `/config` | — | `{ product: {slug, name}, teamName, categories, severities, statuses, retroactiveRecording, maxAttachmentBytes }` |
| `GET` | `/tickets` | `status`: `open` (ativos), `done` (resolvido ou fechado), `all` ou um status; `search` (título ou código); `page` (padrão 1); `pageSize` (1 a 100, padrão 25) | `{ items, total, page, pageSize }`. Cada item: `id, code, title, category, severity, status, openedBy, createdAt, updatedAt, lastTeamMessageAt, lastCustomerMessageAt, messageCount, hasRecording, fixedIn` |
| `GET` | `/tickets/{id}` | — | Detalhe: `id, code, title, body, category, severity, status, route, fixedIn`, datas, `openedBy {id,name}`, `traceIds`, `diagnostics`, `messages[]`, `attachments[]`. Notas internas não aparecem. Resposta da equipe vem com `author: {id: "team", name: teamName}` |
| `POST` | `/tickets` | JSON: `title` (obrigatório, até 200); `body` (obrigatório, até 20.000); `category` (`bug`, `question`, `feature`, `billing`, `other`; padrão `bug`); `severity` (`low`, `normal`, `high`, `critical`; padrão `normal`); `route` (começa com `/`, até 512); `diagnostics` (objeto JSON; acima de 512 KB é descartado sem erro); `traceIds` (até 20, até 64 caracteres cada) | **201** `{ id, code }`. `code` tem a forma `20261016-7K3Q` |
| `POST` | `/tickets/{id}/messages` | JSON: `body` (obrigatório, até 20.000) | **201** `{ id }`. Se o chamado estava `waiting_customer` ou `resolved`, volta para `in_progress`; se estava `closed`, volta para `open` |
| `POST` | `/tickets/{id}/attachments` | multipart: `file` (obrigatório, até 25 MB); `kind` (`image`, `file` ou `recording`; padrão pelo tipo); `messageId` (opcional, de uma mensagem deste chamado); `meta` (JSON, até 512 KB) | **201** anexo. Tipos aceitos: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/gzip`, `application/json`, `text/plain`, `text/csv`, `application/pdf`. Gravação (`recording`) só em `application/json` ou `application/gzip`. Acima do limite: **413**; tipo recusado: **400** |
| `GET` | `/tickets/{id}/attachments/{attachmentId}` | `download=true` força download | Bytes. Imagens e PDF abrem na página; o resto baixa |
| `POST` | `/tickets/{id}/close` | — | **204** |
| `POST` | `/tickets/{id}/reopen` | — | **204**; **400** se o chamado já está aberto |
| `GET` | `/known-issue` | `traceId` | `{ "known": false }` ou `{ known: true, status, fixedIn, ticketId, ticketCode }`. `ticketId` e `ticketCode` só vêm para chamado do próprio cliente. Outro cliente só recebe o status |

Status de chamado: `open`, `in_progress`, `waiting_customer`, `fixed_pending_deploy`, `resolved`, `closed`.

Erros da ponte, quando o problema está no caminho até o Pitwall:

- **503** (só ASP.NET): o produto não tem `Pitwall__BaseUrl` ou `Pitwall__ApiKey`.
- **401** sem corpo (ASP.NET) ou `{ message: "Not signed in." }` (Node): `resolveActor` devolveu `null`.
- **400** `Invalid path.`: segmento `.`, `..`, `%` ou `\` no caminho.
- **502** `Support is unreachable right now.`: o Pitwall não respondeu.

### Ingestão de erros: `POST /v1/ingest/errors`

Escopo `errors`. Lote de 1 a 100 erros:

```json
{ "errors": [{
  "traceId": "3f2a…",              // obrigatório, até 64: o mesmo que foi devolvido ao navegador
  "exceptionType": "System.InvalidOperationException",  // obrigatório
  "path": "/api/reports/42/run",   // obrigatório, até 512
  "method": "POST",
  "routeTemplate": "/api/reports/{id}/run",
  "statusCode": 500,
  "message": "Sequence contains no elements",          // até 2000
  "stackTrace": "…",                                    // até 16.000
  "customerId": "ws-123", "userId": "u-42",
  "occurredAt": "2026-10-22T14:03:00Z",                // ignorado se a diferença for de dois dias ou mais
  "release": "1.4.2", "environment": "production"
}] }
```

Resposta: `{ "accepted": n, "rejected": m }`. Registros inválidos (sem `traceId`, `exceptionType` ou `path`)
são rejeitados. A assinatura do erro é calculada pelo Pitwall, nunca enviada pelo produto.

### Ingestão de versões: `POST /v1/ingest/releases`

Escopo `releases`. Chamado pela action `release-notes`:

```json
{ "version": "1.4.2", "commits": [{ "sha": "abcdef1234567", "subject": "fix: export (20261016-7K3Q)", "body": null }],
  "dryRun": false, "context": "esta versão é sobre importação", "publishedAt": null, "announce": true }
```

`version` é obrigatório, até 60. Resposta: `{ status, releaseId, reason, resolvedTickets, draft }`.
`status` é `published`, `draft`, `skipped` (sem commits ou sem nada que o cliente perceba), `exists` (a versão
já foi enviada; nada muda, então uma nova execução é segura), `dry-run` ou `failed`. `resolvedTickets` são os
códigos de chamado resolvidos por este release, mesmo quando a nota não foi escrita. Se o modelo não respondeu,
o status é `failed`, mas os chamados citados ainda são resolvidos.

### Changelog público: `GET /v1/public/{slug}/releases`

Sem chave. Aceita `GET` de qualquer origem (CORS). Só mostra releases publicados.

| Caminho | Parâmetros | Resposta |
|---|---|---|
| `/v1/public/{slug}/releases` | `locale` (`pt`, `en`; o primeiro idioma do produto por padrão), `limit` (1 a 100, padrão 20), `before` (data ISO) | `{ product, locale, items[] }`, cache de 5 minutos |
| `/v1/public/{slug}/releases/{version}` | `locale` | um item |

Item: `version, changeKind, publishedAt, releaseId, locale, slug, title, summary, new, improvements, bodyMarkdown`.

### Webhooks

Pitwall faz `POST` na URL do produto, com corpo JSON:

```json
{ "id": "5b1c…", "type": "ticket.replied", "createdAt": "2026-10-22T14:03:00Z",
  "product": { "id": "…", "slug": "datarunner" },
  "data": { "ticket": { "id": "…", "code": "20261016-7K3Q", "status": "in_progress", "customerId": "ws-123", "openedByUserId": "u-42", "…": "…" },
            "message": { "id": "…", "body": "Já corrigimos.", "createdAt": "…", "teamName": "Equipe DataRunner" } } }
```

Cabeçalhos:

| Cabeçalho | Valor |
|---|---|
| `Pitwall-Event` | o tipo do evento |
| `Pitwall-Delivery` | igual ao `id` do corpo (a entrega e o evento são o mesmo registro) |
| `Pitwall-Signature` | `t=<unix em segundos>,v1=<hex>` |

**Assinatura:** `v1 = HMAC-SHA256(segredo, "<t>.<corpo cru>")` em hexadecimal minúsculo. Calcule sobre o corpo
exatamente como chegou, antes de qualquer parse. Recuse se `|agora − t| > 300` segundos. Compare em tempo constante.

```
esperado = hex( HMAC_SHA256( segredo, t + "." + corpo_cru ) )
aceitar  = |agora − t| ≤ 300  e  v1 == esperado
```

Com o pacote, use `verifyWebhook` (Node) ou `MapPitwallWebhook` (ASP.NET), que fazem isso.

**Entrega:** qualquer resposta que não seja 2xx conta como falha. O timeout é de 15 segundos. Cada falha dobra
a espera antes da próxima tentativa (30 s, 1 min, 2 min…), com teto de 6 h. Ao todo são 10 tentativas, que
cabem em cerca de 4 horas. Depois da última, a entrega fica como `failed` no console, onde a equipe pode
**reenviar** (botão *reenviar*). Histórico de entregas: 30 dias.

**Idempotência:** trate cada `id` uma vez. Reentregas usam o mesmo `id`.

Eventos e o formato de cada `data` estão em [arquitetura.md → Webhooks](arquitetura.md#webhooks).

---

## Sistemas já integrados (referência)

Use estes como exemplos reais. Os caminhos são relativos a cada repositório.

### DataRunner

Repositório `DataRunner`, branch `feat/pitwall`.

- `apps/api/DataRunner.Api/Support/PitwallSupport.cs`: registra o cliente (`AddPitwall`), mapeia a ponte e o webhook. `ResolveActorAsync` lê o workspace do token e busca o nome e o e-mail no banco.
- `apps/api/DataRunner.Api/Support/PitwallEventHandler.cs`: trata cada evento uma vez (recibo por `evt.Id`) e avisa as pessoas pelo sistema de notificações do próprio DataRunner. `release.published` vira um post de changelog.
- `apps/api/DataRunner.Api/Middleware/ErrorHandlingMiddleware.cs`: envia cada 5xx ao `IPitwallErrorReporter` e devolve o `traceId` no corpo.
- `apps/console/lib/pitwall.ts`: `startSupport` (inicia o SDK com `captureFetch: false`, porque o cliente HTTP próprio alimenta os buffers) e as funções que o resto do console usa.
- `apps/console/components/shell/SupportBridge.tsx`: monta o SDK no shell, liga as falhas de API ao `reportServerFailure` e registra eventos de tempo real.
- `apps/console/components/support/`: `SupportTicketsPage.tsx`, `SupportTicketPage.tsx` e `pitwall-elements.d.ts` (tipagem JSX).

### RH Flex

Repositório `rhflex`. Em integração: ainda não está em produção.

- `apps/api/RhFlex.Api/Modules/Suporte/SuporteModule.cs`: a ponte (`MapPitwallSupport`) e o webhook. Substitui o módulo antigo de suporte.
- `apps/api/RhFlex.Api/Common/Middleware/ExceptionMiddleware.cs`: reporta o 500 com o trace id e o devolve no cabeçalho `X-Trace-Id` e no corpo.
- `apps/console/app/api/suporte/chamados/[[...path]]/route.ts`: proxy que repassa o corpo cru e o `Content-Type`, para anexos multipart e gravações.
- `apps/console/components/support/PitwallSupport.tsx`: `Pitwall.init` no console, com `endpoint: "/api/suporte/chamados"`, e a função `relatarProblema`.

### metrifree

Repositório `metrifree`.

- `apps/api/src/routes/support.ts`: a ponte (`pitwallSupport`) e o webhook com idempotência por `pitwall:event:<id>`.
- `apps/api/src/app.ts`: `createErrorReporter` no `setErrorHandler`, com `genReqId` como trace id.
- `apps/web/src/lib/support.ts`: `Pitwall.init` depois do login, com `x-org-id`, e `destroy` no logout.
- `apps/web/src/views/SupportView.vue` e `TicketView.vue`: `<pitwall-tickets />` e `<pitwall-ticket :ticket-id>`.

---

## Referência rápida do SDK

### `Pitwall`

| Item | Para quê |
|---|---|
| `Pitwall.init(config)` | Inicia o diagnóstico e a gravação retroativa, monta o diálogo, a barra de gravação e os avisos, e define os custom elements. Chame uma vez, depois do login. Chamar de novo substitui a instância anterior. |
| `Pitwall.current` | A instância ativa. Lança erro se `init` não foi chamado. |
| `pitwall.openNewTicket({ title?, body?, traceId?, attachRetroactive?, route? })` | Abre o formulário "Relatar um problema". `traceId` liga o chamado a uma falha de API. |
| `pitwall.startRecording()` / `stopRecording()` | Grava os passos fora do formulário; ao parar, abre o formulário com a gravação. |
| `pitwall.reportServerFailure({ method, path, status, traceId? })` | Mostra "já sabemos" ou oferece o chamado para uma falha de API. Use quando o cliente HTTP não é o `fetch` global. |
| `pitwall.log`, `recordRequest`, `recordEvent`, `recordBoundaryError` | Alimentam o diagnóstico a partir do código do produto (ex.: error boundary). |
| `pitwall.destroy()` | Desliga os recorders e os interceptadores. |

Opções de `Pitwall.init`:

| Opção | Padrão | Para quê |
|---|---|---|
| `endpoint` | — | a ponte do produto, ex.: `/api/v1/support` |
| `headers` | — | cabeçalhos extras, ex.: `Authorization: Bearer …` (cookies vão sempre) |
| `fetch` | `window.fetch` | cliente HTTP do SDK |
| `app` | — | `{ version, commit, channel, extra() }`, carimbado em cada diagnóstico |
| `locale` | navegador | `'pt'` ou `'en'`, ou uma função |
| `captureConsole` | `true` | copia `console.*` para o diagnóstico |
| `captureFetch` | mesma origem | `true`, `false` ou `{ match, traceHeaders }` |
| `recording` | — | `{ maskSelector, blockSelector, retroactive }` |
| `errorPrompt` | `true` | oferece o chamado (ou "já sabemos") em falha 5xx |
| `ticketHref` | — | `(id) => '/suporte/' + id` |
| `navigate` | `location.assign` | como ir para a tela de um chamado (ex.: `router.push`) |

### Pacotes e subcaminhos

| Import | Para quê |
|---|---|
| `@pitwall/sdk` | `Pitwall`, tipos e os custom elements (registrados por `init`) |
| `@pitwall/sdk/diagnostics` | `recordLog(level, args[])`, `recordRequest(entry)`, `recordError(kind, msg, stack?)`, `recordEvent(kind, detail)`, `snapshotDiagnostics()`. Sem DOM: seguro no SSR |
| `@pitwall/sdk/server` | `createSupportBridge`, `encodeActor`, `bridgeTarget`, `createErrorReporter`, `verifyWebhook`, `signWebhook` |
| `@pitwall/sdk/fastify` | `pitwallSupport` (plugin) |
| `@pitwall/sdk/player` | Registra `<pitwall-player>` (propriedades `events` e `diagnostics`, não atributos) |

### Custom elements e eventos

| Elemento | Atributos | Eventos |
|---|---|---|
| `<pitwall-tickets>` | `no-header` (oculta o cabeçalho) | `pitwall-open-ticket` com `detail: { id }`, quando se clica num chamado |
| `<pitwall-ticket>` | `ticket-id` | — |
| `<pitwall-player>` | — | — |

Ao criar um chamado pelo formulário, `window` recebe `pitwall:ticket-created` com o chamado.

### Masking e tema

| Marcador | Efeito |
|---|---|
| `data-pw-mask` ou `.pw-mask` | o texto sai mascarado na gravação. Tabelas e inputs já são mascarados quando "ocultar dados" está ligado (padrão) |
| `data-pw-block` ou `.pw-block` | o elemento nunca é gravado |
| `recording.maskSelector` / `blockSelector` | seletores extras do produto, ex.: `[data-dr-mask]` |

Variáveis de tema (herdam para dentro do Shadow DOM):

`--pw-accent`, `--pw-accent-fg`, `--pw-bg`, `--pw-border`, `--pw-danger`, `--pw-fg`, `--pw-fg-muted`, `--pw-fg-subtle`,
`--pw-font`, `--pw-mono`, `--pw-muted-bg`, `--pw-radius`, `--pw-success`, `--pw-surface`, `--pw-warning`, `--pw-z`.

---

## Testes de ponta a ponta

Tudo roda na sua máquina, sem nada na nuvem.

**1. Suba o ambiente.** Na raiz do repositório `pitwall`:

```bash
corepack pnpm dev
```

O script sobe o Postgres (`docker compose`, porta 5434), a API (`http://localhost:5180`), o console
(`http://localhost:3200`) e o demo (`http://localhost:4300`). Na primeira vez, ele também cadastra o sistema
demo com `examples/demo-product/setup.mjs`, que grava o `.env` do demo com chave e segredo de webhook. Ctrl+C
encerra o que ele iniciou. Quem já tem a API no ar reaproveita a instância.

**2. Use o demo como um cliente.** Abra `http://localhost:4300`:

- Troque a pessoa no seletor: Ana e Bruno são do mesmo cliente; Carla é de outro. Isso testa o isolamento.
- **Relatar um problema** abre o formulário e envia um chamado (aparece em `#/support`).
- **Rodar relatório** responde 500 com o `traceId`. O Pitwall recebe o erro com o mesmo id: confira em *Erros* no console.
- `#/webhooks` mostra os eventos que o Pitwall enviou ao demo, com a assinatura verificada.

**3. Responda pelo console.** Entre em `http://localhost:3200` com o admin de desenvolvimento definido em
`apps/api/Pitwall.Api/appsettings.Development.json`. Responda o chamado e mude a situação dele. Volte ao demo
e veja `ticket.replied` e `ticket.status_changed` em `#/webhooks`.

**4. Rode o smoke test.** Com a API no ar:

```bash
node scripts/smoke.mjs
```

O script cria um produto novo e confere, em sequência: escopos das chaves, identidade obrigatória, isolamento
entre clientes, upload de gravação e recusa de HTML, a equipe vendo o fornecedor do erro, `known-issue` e
o release que resolve o chamado pelo código. Ele para na primeira falha. Ele não precisa de chave da Anthropic:
sem ela, a nota falha, mas os chamados continuam sendo resolvidos.

**5. Testes automatizados.**

```bash
corepack pnpm test       # dotnet test Pitwall.slnx + testes do SDK
```

Os testes de integração da API sobem o próprio Postgres com Testcontainers, então precisam de Docker.

**6. Seu sistema contra o Pitwall local.** Cadastre o sistema no console local (`http://localhost:3200`) com a
API em `http://localhost:5180` e aponte o webhook para o seu backend. Como a API roda na mesma máquina, a URL
do webhook pode ser `http://localhost:<porta>/…`.

---

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Ponte responde **503** (ASP.NET) | `Pitwall__BaseUrl` ou `Pitwall__ApiKey` vazios | Defina as variáveis do backend. Em instalação sem Pitwall, o 503 é o comportamento esperado |
| Ponte responde **502** (Node) | `PITWALL_URL` vazio ou o Pitwall fora do ar | Verifique a variável e a URL com `curl <url>/health` |
| **401** em `/support/*` | `resolveActor` devolveu `null`: sem sessão, ou `customerId` vazio | Confira a sessão do sistema. A ponte não tem como saber quem é a pessoa |
| **400** `The Pitwall-Actor header is missing or invalid.` | `customerId` vazio ou actor acima de 4096 caracteres | Confira o JSON antes do base64url. Nomes longos são cortados pelo Pitwall, mas o `customerId` não |
| **403** de escopo | a chave não tem `support` (ou `errors` no reporte) | Crie uma chave com os escopos certos e troque a variável |
| **401** `A valid product key is required.` | chave errada, revogada, ou de produto desativado | A revogação leva até um minuto para valer |
| CORS: o `fetch` do SDK falha ao chamar a ponte | a ponte está em outra origem | O SDK envia com `credentials: 'include'` e pode mandar `Authorization`. Sua API precisa de origem explícita (não `*`), `AllowCredentials` e `Authorization` entre os cabeçalhos permitidos. O DataRunner faz isso em `Program.cs` |
| Trace id não liga o chamado ao erro | `X-Trace-Id` não é visível ao navegador em outra origem | Exponha o cabeçalho (`Access-Control-Expose-Headers: X-Trace-Id`) ou devolva `traceId` no corpo 5xx. O SDK lê os dois |
| Erro nunca aparece em *Erros* | status menor que 500 (não é reportado de propósito), chave sem `errors`, ou limite de 600 por minuto | Confira o status e o escopo. Um 429 no reporte significa muitos erros de uma vez |
| Webhook responde **401** no teste | segredo errado, segredo trocado (**Trocar segredo** invalida o antigo), ou relógio com mais de 5 minutos de diferença | Copie o segredo atual para `Pitwall__WebhookSecret`. Sincronize o relógio do servidor (NTP). Sem segredo configurado no produto, o ASP.NET também responde 401 |
| Webhook verificado, mas efeito duplicado | falta idempotência | Guarde `id` e pule os já tratados |
| Entrega `failed` no console | o endpoint respondeu não-2xx por 10 tentativas | Corrija o endpoint e clique em **reenviar** |
| `<pitwall-tickets>` ou `<pitwall-ticket>` aparece vazia ou sem estilo (o elemento não foi registrado) | `Pitwall.init` ainda não rodou, ou o bundler removeu o import: o pacote declara só `@pitwall/sdk/player` com efeito colateral (`sideEffects`), então um import sem uso pode sair do bundle | Chame `Pitwall.init` (ele registra esses elementos) antes de renderizar a tela. Para `<pitwall-player>`, importe `@pitwall/sdk/player` |
| Vue: aviso "Failed to resolve component: pitwall-tickets" | o compilador não sabe que é custom element | Adicione `isCustomElement` em `vite.config.ts` (ver [Vue](#vue)) |
| React/Next: erro de hidratação ou `window is not defined` | `@pitwall/sdk` importado no servidor | Importe `@pitwall/sdk` dentro de `useEffect`. Só `@pitwall/sdk/diagnostics` pode ser importado no servidor |
| Novidade não sai no changelog | `dry-run` ligado; a nota ficou em *rascunho*; "nada que o cliente perceba"; versão já enviada (`exists`); ou o modelo não respondeu (`failed`) | Veja o `status` e o `reason` na resposta da action. Para rascunho, publique pelo console |
| O workflow não encontra a action `ivobraatz/pitwall/.github/actions/release-notes@v0.1.0` | a tag `v0.1.0` do Pitwall ainda não foi criada | Use uma tag `v<versão>` que exista no repositório do Pitwall (o `release.yml` cria as tags) |
