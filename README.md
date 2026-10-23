# Pitwall

Chamados, erros e novidades de todos os sistemas, num lugar só.

O pitwall é o muro dos boxes: de lá a equipe acompanha todos os carros ao mesmo tempo — a
telemetria (erros do servidor), o rádio (chamados), a câmera onboard (gravações de tela) e o
boletim (changelog). Aqui, os carros são o **DataRunner**, o **RH Flex** e o **metrifree** — e
qualquer sistema que vier depois.

O Pitwall é um serviço de suporte open source para quem mantém vários sistemas: o cliente abre o
chamado dentro do próprio produto, com o contexto técnico já anexado, e a equipe responde tudo
num único console.

- **Chamados de dentro do sistema.** O cliente abre o chamado no próprio produto, que já anexa o
  contexto: a tela, o log do navegador, as requisições que falharam com seus trace ids, e — se a
  pessoa quiser — uma gravação DOM (rrweb) do que ela fazia, com dados mascarados.
- **Erros do servidor.** Cada backend reporta suas exceções 5xx. O Pitwall agrupa o mesmo bug por
  assinatura entre clientes e liga cada chamado ao stack trace pelo trace id.
- **"Já sabemos disso".** Quando uma requisição falha, o navegador pergunta se o erro já é
  conhecido e, se for, diz que a correção está a caminho em vez de abrir mais um chamado.
- **Novidades escritas sozinhas.** O CI de cada sistema manda os commits; o Claude Haiku 5.5
  escreve a nota em pt e en; ela vai para o changelog público e para o sino do produto. Commits que
  citam um código de chamado (`fix: … (20261016-7K3Q)`) resolvem o chamado e avisam o cliente.
- **Um console para a equipe.** Fila única de todos os sistemas, dossiê com gravação + stack trace,
  erros agrupados, revisão das novidades, cadastro de sistemas, chaves e webhooks.

O cliente nunca fala com o Pitwall: ele usa o sistema de sempre, e o backend do sistema faz a
ponte. A equipe usa o console do Pitwall.

```
 navegador do cliente ──► backend do sistema ──(chave do sistema + quem é a pessoa)──► Pitwall API ◄── console da equipe
        (SDK)                (ponte, erros)                                              │
                                    ◄───────────── webhooks assinados (respostas, status, novidades) ┘
```

## Estrutura

| Pasta | O que é |
|---|---|
| `apps/api` | API em .NET 10 + Postgres (EF Core). Chamados, erros, novidades, sistemas, equipe, webhooks. |
| `apps/console` | Console da equipe em Next.js 16. |
| `packages/sdk` | `@pitwall/sdk` (publicado como `pitwall-sdk`): navegador (diagnóstico, gravação, Web Components) e servidor Node (ponte, erros, webhooks, plugin Fastify). |
| `packages/dotnet/Pitwall.AspNetCore` | O mesmo do lado .NET (`Pitwall.AspNetCore` no NuGet): `MapPitwallSupport`, `IPitwallErrorReporter`, `MapPitwallWebhook`. |
| `.github/actions/release-notes` | Action que cada repositório chama para gerar as novidades. |
| `examples/demo-product` | Um produto de mentira ligado de ponta a ponta — o exemplo mais curto de integração. |

## Pacotes

- **npm:** [`pitwall-sdk`](https://www.npmjs.com/package/pitwall-sdk). O código-fonte fica em
  `packages/sdk` com o nome interno `@pitwall/sdk`; para usar no seu projeto, instale com alias para
  continuar importando `@pitwall/sdk`:

  ```json
  "dependencies": {
    "@pitwall/sdk": "npm:pitwall-sdk@^0.1.0"
  }
  ```

- **NuGet:** [`Pitwall.AspNetCore`](https://www.nuget.org/packages/Pitwall.AspNetCore) para ASP.NET Core
  (`dotnet add package Pitwall.AspNetCore`).

## Ligar um sistema

O guia de integração (ponte de suporte, relatório de erros, webhooks e o SDK do navegador) está em
[docs/integracao.md](docs/integracao.md). O exemplo mais curto é o
[produto demo](examples/demo-product).

## Rodar localmente

Requisitos: .NET 10 SDK, Node 22+, Docker.

```bash
corepack pnpm install
corepack pnpm dev        # Postgres + API + console + produto demo, tudo de uma vez (Ctrl+C para)
```

Sobe o Postgres (localhost:5434), a API (http://localhost:5180, migra o banco e cria o admin de dev),
o console (http://localhost:3200) e o produto demo (http://localhost:4300, cadastrado sozinho na
primeira vez). O que já estiver rodando numa dessas portas é reaproveitado. Sem o demo:
`corepack pnpm dev:stack`.

Por partes, se preferir: `docker compose up -d`, `dotnet run --project apps/api/Pitwall.Api` e
`corepack pnpm --filter @pitwall/console dev`.

Entre com `admin@pitwall.local` / `pitwall-dev-password` (só em desenvolvimento, veja
`appsettings.Development.json`).

Para ver tudo funcionando, abra o demo em http://localhost:4300.

Clique em **Rodar relatório** (falha de propósito), aceite o convite para avisar a equipe, revise a
gravação e envie. O chamado aparece no console com a gravação e o stack trace; responda e veja a
resposta chegar no demo e o webhook em **Webhooks**.

## Testes

```bash
dotnet test Pitwall.slnx                       # unitários + integração (Postgres via Testcontainers)
corepack pnpm --filter @pitwall/sdk test       # ponte, assinatura de webhook
```

## Deploy

- Railway: [docs/deploy-railway.md](docs/deploy-railway.md)
- VPS com Docker Compose: [docs/deploy-vps.md](docs/deploy-vps.md)
- Oracle Cloud Always Free (VM ARM gratuita): [docs/deploy-oracle.md](docs/deploy-oracle.md)

`docker-compose.prod.yml` sobe Postgres, API e console (copie `.env.example` para `.env`).

## Documentação

- [docs/arquitetura.md](docs/arquitetura.md): segurança, dados e como as partes conversam.
- [docs/integracao.md](docs/integracao.md): ligar um sistema ao Pitwall.
- [CONTRIBUTING.md](CONTRIBUTING.md): como contribuir.
- [SECURITY.md](SECURITY.md): como reportar vulnerabilidades.

## Licença

Licença: [MIT](LICENSE). Copyright (c) 2026 Ivo Braatz.
