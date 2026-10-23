# Arquitetura

## Decisões

**Um serviço interno, não um SaaS.** Uma instância, operada pela equipe. O "tenant" do modelo é o
**sistema** (produto); o cliente final de cada sistema é só um identificador externo
(`customerRef`: o workspace no DataRunner, a empresa no RH Flex). Sem cadastro público, sem
cobrança, sem isolamento entre organizações que não existem. O código pode virar open source
depois sem mudar nada aqui — os dados ficam na instância, não no código.

**Postgres, não NoSQL.** Chamado → mensagens → anexos → release são relações, e a fila precisa de
filtros e ordenação cruzados ("abertos do RH Flex aguardando a equipe, por atualização"). O que
varia entre sistemas mora em `jsonb` (diagnóstico do navegador, metadados de gravação,
configurações do sistema). Os três produtos já usam Postgres.

**A identidade fica no produto.** O Pitwall não conhece os usuários dos sistemas. O backend do
sistema autentica a pessoa como sempre e afirma ao Pitwall quem ela é (cabeçalho `Pitwall-Actor`),
autenticado pela chave do sistema. O navegador nunca vê a chave e não pode se passar por outra
pessoa.

## Componentes

| Peça | Responsabilidade |
|---|---|
| API (`apps/api`) | Superfície do cliente (`/v1/support`, só via ponte), ingestão (`/v1/ingest/errors`, `/v1/ingest/releases`), changelog público (`/v1/public/{slug}/releases`), superfície da equipe (`/v1/staff`). Serviços de fundo: despacho de webhooks e retenção. |
| Console (`apps/console`) | Next.js; faz proxy de `/v1` para a API, então a sessão é cookie de primeira parte. |
| SDK navegador | Buffers de diagnóstico (log, requisições, erros, eventos), gravação rrweb (retroativa ~2 min + procedimento até 10 min), instrumentação de `fetch`, e os Web Components (`<pitwall-tickets>`, `<pitwall-ticket>`, `<pitwall-player>`, o diálogo, a barra de gravação, os avisos). Funciona em React, Vue ou HTML puro. |
| SDK servidor / Pitwall.AspNetCore | Ponte, reporter de erros em lote, verificação de webhook. |

Os dois pacotes são públicos: npm `pitwall-sdk` (o produto importa `@pitwall/sdk` por alias, sem token) e NuGet `Pitwall.AspNetCore`. Como integrar, em [integracao.md](integracao.md).

## Fluxos

**Abrir chamado.** Navegador → `POST {produto}/api/.../support/tickets` → backend do produto acrescenta
`Authorization: Bearer pw_…` e `Pitwall-Actor` → Pitwall grava o chamado, liga a assinatura de erro
pelos trace ids (só erros do mesmo cliente), enfileira `ticket.created`, avisa a caixa da equipe.
Gravações e imagens sobem depois, em `/attachments`, pelo mesmo caminho.

**Erro do servidor.** O backend do produto captura o 5xx, sanitiza mensagem e stack, e envia em
lote para `/v1/ingest/errors` com o trace id que também devolveu ao navegador. O Pitwall calcula a
assinatura (tipo + rota normalizada + primeiro frame do próprio código, sem número de linha).

**Responder.** A equipe responde no console → `ticket.replied` (+ `ticket.status_changed`) vai por
webhook ao produto, que avisa a pessoa no sino/e-mail com a própria marca. O cliente vê a resposta
assinada pela equipe (nome configurável), nunca pelo atendente. Notas internas nunca saem do console.

**Release.** O CI do produto manda os commits desde a última tag `notes/*` → o Pitwall resolve os
chamados citados por código ou cujo "corrigido em" bate com um commit/versão (isso acontece mesmo que a
nota falhe) → o Claude Haiku 5.5 escreve a nota (structured outputs, todas as línguas numa chamada) →
publica ou deixa como rascunho → `release.published` por webhook.

## Modelo de dados

```
products        id, slug, name, description, webhook_url, webhook_secret_sealed, settings jsonb
product_keys    product_id, name, prefix, hash, scopes[] (support | errors | releases), last_used_at, revoked_at
tickets         product_id, code, customer_ref/name, opened_by_ref/name/email, title, body, category, severity,
                status, assignee_id, route, diagnostics_json jsonb, trace_ids[], error_signature, fixed_in,
                resolution_note, timestamps…
ticket_messages ticket_id, from_team, internal, author_ref/name, body
ticket_attachments ticket_id, message_id, kind (image|file|recording), storage_key, meta_json jsonb
server_errors   product_id, trace_id, customer_ref, user_ref, method, path, route_template, status_code,
                exception_type, message, stack_trace, signature, release, environment, occurred_at
releases        product_id, version, status (draft|published|silent), change_kind, commit_shas[], ticket_codes[]
release_notes   release_id, locale, slug, title, summary, new_items[], improvements[], body_markdown
staff / staff_sessions / webhook_deliveries
```

## Segurança e dados

- **Isolamento.** Toda consulta da superfície do cliente filtra por `product_id` (da chave) **e**
  `customer_ref` (do actor). Um trace id de outro cliente não revela nada; o "já sabemos" mostra só
  o status de chamados alheios, nunca título, texto ou link.
- **Chaves com escopo.** O backend usa `support + errors`; o CI usa só `releases`. Só o hash é
  guardado; a chave aparece uma vez. Revogação vale em até 1 minuto (cache).
- **Ponte fechada.** A ponte só aceita segmentos simples (`.`, `..`, `%` e `\` são recusados), então a
  chave do produto não alcança outras rotas por ela.
- **Segredos lacrados.** Segredo de webhook e semente TOTP são cifrados com AES-GCM pela
  `Pitwall:SecretKey`; um dump do banco não permite forjar webhooks nem gerar códigos.
- **Console.** Cookie opaco `HttpOnly`, `SameSite=Strict`, expira em 12h ociosa / 7 dias; escritas
  exigem `X-Pitwall-Staff: 1` (CSRF). Senha bcrypt, TOTP (obrigatório com `Pitwall:RequireTotp`),
  rate limit no login. Recomendado: console atrás de Cloudflare Access ou Tailscale. Com
  `Pitwall:StaffHosts`, `/v1/staff` só responde pelo endereço privado que o console usa; o hostname
  público, o dos sistemas, devolve 404.
- **Gravações.** rrweb grava DOM, não pixels; com "ocultar dados" (padrão) textos de tabela,
  `[data-pw-mask]` e todos os inputs viram asteriscos; senhas nunca. Nada sai do navegador sem a
  pessoa anexar e revisar. Os anexos ficam num bucket privado, servidos só por endpoints autenticados.
- **Minimização.** Mande ao Pitwall o mínimo: ids e nomes. E-mail é opcional. No RH Flex,
  marque com `data-pw-mask` tudo que for dado de funcionário (LGPD).
- **Retenção.** Erros do servidor: 30 dias (o chamado guarda a assinatura). Gravações: 90 dias após o
  chamado fechar. Registro de webhooks (entregues ou falhos, não os pendentes): 30 dias. Sessões expiradas:
  removidas de hora em hora.

## Webhooks

`POST` para a URL do sistema, corpo JSON `{ id, type, createdAt, product: {id, slug}, data }`,
cabeçalhos `Pitwall-Event`, `Pitwall-Delivery` e `Pitwall-Signature: t=<unix>,v1=<hex>` onde
`v1 = HMAC-SHA256(segredo, "<t>.<corpo>")`. Recuse assinaturas com mais de 5 minutos. Qualquer
resposta não-2xx é reenviada com backoff (30 s → 6 h, 10 tentativas); falhas definitivas podem ser
reenviadas pelo console. Seja idempotente em `id`.

| Evento | `data` |
|---|---|
| `ticket.created` | `ticket` |
| `ticket.replied` | `ticket`, `message { id, body, createdAt, teamName }` |
| `ticket.status_changed` | `ticket`, `from`, `to`, `reason` (`team` · `customer` · `release`) |
| `release.published` | `id`, `version`, `changeKind`, `publishedAt`, `notes { pt: {title, summary, slug, new[], improvements[], bodyMarkdown}, en: … }` |
| `ping` | `by` |

`ticket` = `{ id, code, title, status, category, severity, fixedIn, customerId, openedByUserId, createdAt, updatedAt }`.
