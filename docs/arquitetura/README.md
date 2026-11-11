# Arquitetura

## Decisões

**Um serviço interno, não um SaaS.** Uma instância, operada pela equipe. O "tenant" do modelo é o
**sistema** (produto); o cliente final de cada sistema é só um identificador externo
(`customerRef`: o workspace num sistema, a empresa em outro). Sem cadastro público, sem
cobrança, sem isolamento entre organizações que não existem. O código pode virar open source
depois sem mudar nada aqui — os dados ficam na instância, não no código.

**Postgres, não NoSQL.** Chamado → mensagens → anexos → release são relações, e a fila precisa de
filtros e ordenação cruzados ("abertos do Acme aguardando a equipe, por atualização"). O que
varia entre sistemas mora em `jsonb` (diagnóstico do navegador, metadados de gravação,
configurações do sistema).

**Grafo no Postgres, não num banco de grafos.** ~10³ nós, travessias em memória.

**A identidade fica no produto.** O Pitwall não conhece os usuários dos sistemas. O backend do
sistema autentica a pessoa como sempre e afirma ao Pitwall quem ela é (cabeçalho `Pitwall-Actor`),
autenticado pela chave do sistema. O navegador nunca vê a chave e não pode se passar por outra
pessoa.

## Componentes

| Peça | Responsabilidade |
|---|---|
| API (`apps/api`) | Superfície do cliente (`/v1/support`, só via ponte), ingestão (`/v1/ingest/errors`, `/v1/ingest/releases`), changelog público (`/v1/public/{slug}/releases`), superfície da equipe (`/v1/staff`), webhook do GitHub do Atlas (`/v1/hooks/github`, anônimo, com assinatura). Serviços de fundo: despacho de webhooks, retenção, os coletores do Atlas (de hora em hora) e os snapshots do grafo (a cada 6 h). |
| Console (`apps/console`) | Next.js; faz proxy de `/v1` para a API, então a sessão é cookie de primeira parte. |
| SDK navegador | Buffers de diagnóstico (log, requisições, erros, eventos), gravação rrweb (retroativa ~2 min + procedimento até 10 min), instrumentação de `fetch`, e os Web Components (`<pitwall-tickets>`, `<pitwall-ticket>`, `<pitwall-player>`, o diálogo, a barra de gravação, os avisos). Funciona em React, Vue ou HTML puro. |
| SDK servidor / Pitwall.AspNetCore | Ponte, reporter de erros em lote, verificação de webhook. |
| MCP e CLI (`packages/mcp`) | Servidor MCP `pitwall-mcp` (stdio) para o Claude Code: tools sobre o quadro de tarefas (`/v1/staff/tasks`) e sobre o Atlas (`/v1/staff/atlas`). O mesmo pacote traz o binário `pitwall-atlas`, que envia o estado do repositório ao Atlas (`sync`, `state`, `install-hooks`), usado por hooks do git, pelo hook do Claude Code e pela action `atlas-sync` no CI. Autenticado por token pessoal `pwt_…`. Fala com o console, não com a API. |

Os pacotes são públicos: npm `pitwall-sdk` (o produto importa `@pitwall/sdk` por alias, sem token), npm `pitwall-mcp` e NuGet `Pitwall.AspNetCore`. Como integrar, em [integracao.md](../operacao/integracao.md).

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

**Tarefa da equipe.** Numa sessão do Claude Code, o passo manual que sobrou ("configurar o webhook no
painel") vira `create_task` no MCP → `POST /v1/staff/tasks` com o token pessoal (origem `claude`,
autor "Nome (Claude)") → o cartão aparece no quadro do console em até 12 s (polling com delta por
`updatedSince`). A pessoa arrasta entre colunas; ao bloquear, escreve o erro que viu. Na sessão seguinte,
`board_summary` e `list_tasks(blocked)` trazem o que mudou, `get_task` lê a nota e o histórico, e o
Claude comenta o que verificou. Tarefa nunca vira chamado, não dispara webhook e não aparece para
produto nem cliente. Guia: [tarefas-mcp.md](../operacao/tarefas-mcp.md).

**Atlas.** Quatro caminhos alimentam o inventário, e cada afirmação guarda quem a fez (`origin`) e a evidência
(`atlas_evidence`):

1. **Fontes.** Pessoa (console, importação, MCP), scan de manifestos do repositório (CLI, CI ou servidor), relatório
   de agente (`atlas_sync`) e coletores de provedor (Railway, Vercel, Kuma, GitHub, Cloudflare) e webhook do GitHub.
2. **Reconciliação.** O sync aplica o pacote ao inventário: acha ou cria o nó alvo pela chave e pela assinatura, cria
   as evidências, marca como sumidas as que a fonte completa deixou de trazer (nunca apaga nó), e grava o changeset.
3. **Inventário.** Nós (serviços, repositórios), ligações com relação, referências a tarefas e chamados, eventos
   operacionais e histórico de mudanças. A verificação de cada nó é calculada na leitura, nunca gravada.
4. **Projeções.** Um grafo por leitura, com o mesmo inventário lido como mapa de empresa e de produto, detalhe do
   componente, fluxos, operação, atenção e evolução (diff entre snapshots). Insights são regras determinísticas sobre o grafo.

Sessões do Claude Code avisam o que estão fazendo (`start_activity` / `finish_activity`) e o executor de rotinas registra
cada execução. O console lê o mapa de `GET /v1/staff/atlas/graph` a cada 10 s. Guia: [atlas.md](../operacao/atlas.md).

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
team_tasks      product_id?, code (T-XXXXX), title, body, status (todo|doing|blocked|done), position (fracionário),
                priority, labels[], due_date, assignee_id, source (claude|manual), created_by_ref/name,
                blocked_note, checklist jsonb, links jsonb, done_at, archived_at, timestamps…
team_task_comments / team_task_events (created|moved|updated|blocked|archived|unarchived|commented, data jsonb)
staff_tokens    staff_user_id, name, prefix, hash, scopes[] (tasks | atlas), last_used_at, expires_at, revoked_at
atlas_environments  slug, name, position
atlas_services  product_id?, environment_id?, name, kind, engine, signature?, origin (declared|discovered|reported|observed),
                aliases[], key (único, imutável), provider, external_ref, url, monitor_ref, notes, retired_at?, retired_reason?,
                removal_reported_at?, verified_at?, verified_by?, missing_since?, monitor_status, deploy_status, last_deploy_at,
                commit_sha, checked_at, version (concorrência)
atlas_links     from_service_id, to_service_id, label, relation (depends_on, calls, writes_to…), origin, retired_at?,
                verified_at?, updated_at, version (único por from, to, relation)
atlas_repos     product_id?, full_name, external_id (id do GitHub), role?, service_ids[], default_branch, stack jsonb,
                open_pull_requests?, last_run_*, last_sync_at?, last_sync_sha?, last_sync_scope?, last_scan_hash?,
                last_deployed_sha?, commits7d, runs7d, failed_runs7d, open_alerts, checked_at, retired_at?
atlas_routines  product_id?, slug, name, frequency (daily|weekly|monthly), description, prompt, enabled
atlas_routine_runs  routine_id, status (running|ok|failed), started_at, finished_at, summary, links jsonb, actor_name
atlas_activities    product_id?, service_id?, component, description, status, result, actor_name, source, started_at, finished_at,
                    repo?, branch?, head_sha?, tool? (claude-code|codex|cursor|other), last_sync_at?
atlas_discoveries   source, kind (service|repo|monitor), external_ref, name, environment, url, first/last_seen_at, dismissed_at
atlas_evidence  subject_type (service|link|repo), subject_id, source, method, ref, detail?, relation?, scope, commit_sha?,
                change_set_id?, first_seen_at, last_seen_at, gone_at? (único por subject, source, ref)
atlas_changes   at, actor, source (console|mcp|import|collector|sync|system), change_set_id?, entity_type, entity_id,
                product_id?, op (created|updated|retired|restored|renamed|deleted), fields jsonb, summary? (só acrescenta)
atlas_changesets  idempotency_key (único), source (agent|ci|git-hook|cli|github-scan|console), tool?, product_id?, repo_id?,
                  repo?, branch?, commit_sha?, scope, environment?, actor, activity_id?, summary?, task_codes[], status
                  (applied|noop|partial|rejected), bundle_hash?, received_at, applied_at?, result jsonb
atlas_refs      service_id, kind (task|ticket|error), code, note?, source, created_by, created_at (único por serviço, kind, code)
atlas_events    at, source (github|railway|vercel|kuma|cloudflare|agent|routine|sync|github-webhook), type, product_id?,
                service_id?, repo_id?, status?, title, url?, commit_sha?, detail?, external_id (único por source)
atlas_sources   name (PK: railway, github, kuma, vercel, cloudflare, github-webhook, sync), last_run_at?, last_ok_at?,
                last_error?, items_seen?, updated_at
atlas_snapshots taken_at, reason, hash (sha256), node_count, edge_count, data jsonb (só campos estruturais)
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
- **Tokens pessoais.** `pwt_…`, só o hash é guardado e o texto aparece uma vez. Os escopos são `tasks`
  (`/v1/staff/tasks/*`) e `atlas` (`/v1/staff/atlas/*`, menos a importação de arquivo, que é só de admin no console):
  o token alcança essas rotas e nada mais (as outras rotas da equipe só aceitam a sessão, e só a
  sessão cria ou revoga tokens). Revogar vale na hora; desativar a pessoa, em até 1 minuto. Escritas
  com token não precisam do cabeçalho CSRF, porque o navegador não anexa um Bearer sozinho.
- **Gravações.** rrweb grava DOM, não pixels; com "ocultar dados" (padrão) textos de tabela,
  `[data-pw-mask]` e todos os inputs viram asteriscos; senhas nunca. Nada sai do navegador sem a
  pessoa anexar e revisar. Os anexos ficam num bucket privado, servidos só por endpoints autenticados.
- **Minimização.** Mande ao Pitwall o mínimo: ids e nomes. E-mail é opcional. Num sistema com
  dados pessoais sensíveis (de funcionários, de saúde), marque com `data-pw-mask` tudo que for desse tipo (LGPD).
- **Coletores.** Cada token de provedor é só de leitura, fica em variável de ambiente e viaja só no cabeçalho da
  requisição; a mensagem de erro de um coletor traz o status HTTP, nunca o token. Um GitHub App (leitura) tem
  precedência sobre o token pessoal. Um run grava só ao terminar; falha mantém a última leitura boa.
- **Webhook do GitHub.** `POST /v1/hooks/github` é anônimo e só aceita corpo com `X-Hub-Signature-256` válido
  (HMAC-SHA256, comparação em tempo constante) pelo segredo do Atlas; sem segredo, 404. Entrega repetida não
  duplica evento (o id da entrega é a chave). Repositório desconhecido: 202 sem gravar.
- **Sync do Atlas.** `POST /v1/staff/atlas/sync` é de token com escopo `atlas`. Arquivos proibidos (`.env`, chaves,
  `credentials*.json`) são rejeitados; a lista de arquivos é branca e a redação de segredos roda no CLI e no servidor.
  Credenciais aparecem só pelo nome. Texto de repositório e de relatório de agente é dado: nunca dispara ação.
- **Retenção do Atlas.** Eventos saem em 90 dias. Mudanças, changesets e snapshots ficam.
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
