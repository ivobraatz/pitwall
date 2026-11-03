# Tarefas da equipe (kanban interno + MCP)

> Plano de implementação das tarefas **T1..T18**. **Implementado** (2026-11-03). Onde o código
> precisou divergir do plano, a seção 9 diz o que mudou e por quê; ela vale sobre o texto acima dela.

## Regras para quem executa

1. **Uma tarefa por vez.** Termine a T*n*, rode a verificação dela e marque o checkbox. Só então comece a próxima.
2. **Mexa só nos arquivos listados na tarefa.** Se precisar de outro arquivo, pare e relate o motivo.
3. **Se o código divergir deste documento, pare e relate.** Isso vale para nomes, assinaturas, um helper que não existe ou um padrão diferente. Não improvise. O documento é corrigido primeiro.
4. **Não altere testes que já existem.** Crie arquivos de teste novos. Se um teste antigo quebrar, o erro está no código novo.
5. **Não faça commit.** Commit só quando o usuário pedir. Quando pedir, use Conventional Commits como em `CONTRIBUTING.md` (`feat(api): …`, `feat(console): …`, `feat(mcp): …`, `docs: …`).
6. **Antes de tocar no console, leia `apps/console/node_modules/next/dist/docs`**, como manda `apps/console/AGENTS.md`. O Next 16 muda APIs que o modelo acha que conhece.
7. **Versões exatas, sem `^` nem `~`,** nas dependências novas. Antes de fixar, confira com `npm view <pacote> version` e use a versão estável mais recente que tenha pelo menos duas semanas.
8. **Repositório público.** Não escreva domínio de produção, e-mail pessoal, nome de cliente nem dado real em código, teste ou doc. Use `PITWALL_URL`, `https://<seu-dominio>`, `demo`, `ana@example.com`.
9. Mensagens de erro da API para a equipe são em português, no formato que já existe: `{ "message": "…" }`.

---

## 1. Objetivo

Dar à equipe um quadro de tarefas internas, separado dos chamados de cliente (Tickets).

- O Claude, numa sessão de código, registra por MCP as tarefas manuais que sobraram. Exemplos: "configurar o webhook no painel da Meta" ou "testar o login no celular".
- A pessoa arrasta os cartões entre colunas e escreve no cartão o erro que viu.
- Na sessão seguinte, a pessoa pede ao Claude para conferir. O Claude lê o quadro, verifica e comenta.
- O quadro tem de ser rápido e dinâmico: arrastar dentro da coluna e entre colunas, edição otimista, atalhos de teclado e atualização sozinha.

### Fora do escopo

- Tarefas visíveis para clientes, ligação com Ticket e notificações por e-mail ou webhook de tarefa.
- Tempo real por WebSocket ou SSE (ver D10).
- Subtarefas como entidades próprias. Checklist em `jsonb` basta.
- Anexos em tarefa. Por ora, links bastam.
- Permissões por tarefa. Toda a equipe vê o quadro inteiro.
- OAuth no MCP. O "login" é um token pessoal (ver D13).

---

## 2. Decisões

### D1 — Entidade própria, não um Ticket

`TeamTask` é uma tabela nova. Ticket exige `CustomerRef`, tem ciclo de vida de atendimento e dispara webhooks para o produto. Nada disso serve aqui. Assim, uma tarefa nunca vaza para o produto, para o cliente nem para o changelog.

### D2 — Campos de `TeamTask`

| Campo | Tipo | Regra |
|---|---|---|
| `Id` | `Guid` | PK |
| `ProductId` | `Guid?` | FK `Product`, `OnDelete(SetNull)`. Nulo = tarefa geral da equipe |
| `Code` | `string(12)` | Único. Formato em D3 |
| `Title` | `string(200)` | Obrigatório, sem espaços nas pontas |
| `Body` | `string(20000)` | Markdown, default `""` |
| `Status` | `string(16)` | `todo` \| `doing` \| `blocked` \| `done` (classe `TeamTaskStatuses`) |
| `Position` | `double` | Ordem dentro da coluna (D4) |
| `Priority` | `string(8)` | `low` \| `normal` \| `high`, default `normal` (classe `TeamTaskPriorities`) |
| `Labels` | `string[]` (`text[]`) | Até 10, cada uma com até 32 caracteres, minúsculas, `[a-z0-9-]` |
| `DueDate` | `DateOnly?` | Prazo. Fica atrasado quando `DueDate < hoje` e `Status != done` |
| `AssigneeId` | `Guid?` | FK `StaffUser`, `OnDelete(SetNull)` |
| `Source` | `string(8)` | `claude` \| `manual`. Vem do autenticador (D7), nunca do corpo |
| `CreatedByRef` | `string(64)` | Id do staff (`StaffContext.StaffId`) |
| `CreatedByName` | `string(120)` | Nome do staff no momento. Se veio do MCP: `"<nome> (Claude)"` |
| `BlockedNote` | `string(2000)?` | Motivo do bloqueio (D9) |
| `Checklist` | `jsonb` | `[{ "id": "c1", "text": "…", "done": false }]`, até 50 itens de até 300 caracteres |
| `Links` | `jsonb` | `[{ "label": "PR", "url": "https://…" }]`, até 20. Só `http`/`https` |
| `CreatedAt`, `UpdatedAt` | `DateTimeOffset` | `UpdatedAt` muda em toda escrita, inclusive comentário e move |
| `DoneAt` | `DateTimeOffset?` | Preenchido ao entrar em `done` e limpo ao sair |
| `ArchivedAt` | `DateTimeOffset?` | Arquivada sai do quadro, mas continua na busca com `includeArchived=true` |

`Checklist` e `Links` são `List<…>` mapeados com `OwnsMany(...).ToJson()`, no mesmo padrão do `OwnsOne(...ToJson())` que já está em `PitwallDb`. Se o EF não aceitar `OwnsMany` com `ToJson` nesse caso, pare e relate. A alternativa é `HasColumnType("jsonb")` com `List<T>` e conversor.

### D3 — Código da tarefa: `T-` + 5 caracteres

O formato é `T-` seguido de 5 caracteres do alfabeto de `TicketCodes` (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`). Exemplo: `T-7K2QM`. Fica em `Services/TeamTaskCodes.cs`.

Ele **não pode** casar com `TicketCodes.FindIn` (`\b20\d{6}-[0-9A-HJKMNP-TV-Z]{4}\b`). Commits de release resolvem chamados por esse padrão, e uma tarefa citada num commit não pode fechar um chamado. Um teste garante isso.

A unicidade vem de um índice único em `code`. A colisão é tratada como em `SupportEndpoints.CreateTicket`: `catch DbUpdateException`, até 3 tentativas, gerando um código novo.

### D4 — Ordem: `Position` fracionário

- Ao inserir no topo, `Position = menor − 1024`. No fim, `maior + 1024`. Coluna vazia: `1024`.
- Entre dois vizinhos, a posição é a média dos dois.
- Se a folga entre vizinhos ficar `< 1e-6`, o servidor renumera a coluna inteira (`1024, 2048, …`) na mesma transação. Em seguida recalcula a posição.
- O cliente nunca manda número. Manda `beforeId`/`afterId` (D8). O cálculo fica em `Services/TeamTaskPositions.cs`, como função pura e testável.

### D5 — Comentários e histórico: duas tabelas

- **`TeamTaskComment`** (`Id`, `TaskId`, `AuthorRef`, `AuthorName`, `Source` claude|manual, `Body` markdown até 10.000, `CreatedAt`). Comentário não se edita nem se apaga (v1).
- **`TeamTaskEvent`** (`Id`, `TaskId`, `ActorRef`, `ActorName`, `Source`, `Kind`, `Data jsonb`, `CreatedAt`). `Kind` é um destes: `created`, `moved` (`{from,to}`), `updated` (`{fields:[…]}`), `blocked` (`{note}`), `archived`, `unarchived`, `commented`.

Um comentário de sistema misturaria texto humano com eventos e dificultaria o filtro "o que mudou desde a última sessão". O drawer mostra as duas listas intercaladas por data.

O MCP usa os eventos para responder "o que a pessoa fez desde ontem".

### D6 — `StaffToken`: token pessoal da equipe

| Campo | Regra |
|---|---|
| `Id` | `Guid` |
| `StaffUserId` | FK `StaffUser`, `OnDelete(Cascade)` |
| `Name` | `string(80)`, ex.: "Claude Code no notebook" |
| `Prefix` | Primeiros 12 caracteres do token, mostrados na lista (`pwt_ab12cd34`) |
| `Hash` | SHA-256 hex (`Tokens.Hash`). Índice único. **O token em texto nunca é gravado** |
| `Scopes` | `string[]`. v1 aceita só `tasks` (classe `StaffTokenScopes`) |
| `CreatedAt`, `LastUsedAt`, `ExpiresAt?`, `RevokedAt?` | Expiração opcional: 30, 90 ou 365 dias, ou nunca |

- O formato é `pwt_` + `Tokens.Random(40)`, gerado por `Tokens.NewStaffToken()` em `Auth/Secrets.cs`.
- O prefixo `pwt_` e não `pw_staff_` tem um motivo. `ProductKeyAuth` captura qualquer `Bearer pw_…`, e um produto com slug `staff` colidiria.
- O token é criado em **Configurações → Tokens pessoais** e aparece **uma vez**, na resposta da criação. Mesmo padrão de `StaffOpsEndpoints` para chaves de produto.
- O token pertence à pessoa. Se a pessoa for desativada ou apagada, o token para de valer, porque o autenticador confere se o `StaffUser` está ativo.
- Limite: 10 tokens ativos por pessoa (`409` ao passar).

### D7 — Autenticação: esquema `StaffToken` e política `tasks`

- `Auth/StaffTokenAuth.cs` traz o `StaffTokenAuthHandler`, copiado da estrutura de `ProductKeyAuth`. Ele só age com `Authorization: Bearer pwt_…`; sem isso, devolve `NoResult`.
  - Faz o hash e consulta com cache de 1 min em `IMemoryCache`, como em `CachedKey`.
  - Recusa token revogado, expirado ou de staff inativo com `401`.
  - Atualiza `LastUsedAt` sem bloquear (`ExecuteUpdateAsync`, no máximo 1 vez por minuto por token).
  - Claims emitidas: `pw:staff`, `Name`, `Email`, `Role` (as mesmas do `StaffSession`, então `StaffContext.StaffId/StaffName` funcionam sem mudança), `pw:token` (id do token) e `pw:scope` (um por escopo).
- No `Program.cs`, registre o esquema com `AddScheme<…>("StaffToken", …)`.
- A política nova é `Policies.Tasks = "tasks"`. Ela aceita **dois esquemas**: `StaffSession` (qualquer staff logado) **ou** `StaffToken` com claim `pw:scope=tasks`. Use `AddAuthenticationSchemes("StaffSession","StaffToken")` mais `RequireAssertion`.
- **Todas as outras políticas continuam presas só ao `StaffSession`.** Assim, um token vazado só alcança `/v1/staff/tasks/*`. Um teste garante que o token leva `401` em `/v1/staff/tickets`.
- `Source` da tarefa: `claude` quando o principal veio do esquema `StaffToken`, `manual` quando veio da sessão. O helper fica em `StaffContext.IsToken(http)`.
- **CSRF.** A sessão é cookie, que o navegador envia sozinho, por isso o `StaffSession` exige `X-Pitwall-Staff` em escrita. O Bearer não é enviado sozinho pelo navegador e nenhum site de terceiros consegue anexá-lo. Por isso o `StaffToken` **não** exige o cabeçalho CSRF. Se a requisição trouxer cookie **e** Bearer `pwt_`, vale o Bearer e o cookie é ignorado nessa requisição. Isso evita que um cookie sem cabeçalho derrube a chamada do MCP.

### D8 — Rotas REST

Todas ficam em `Endpoints/Staff/StaffTaskEndpoints.cs`, num grupo `app.MapGroup("/v1/staff/tasks").RequireAuthorization(Policies.Tasks)`. As escritas levam `.RequireRateLimiting("tasks-writes")`. Os tokens ficam em `/v1/staff/me/tokens`, com a política `Staff` (só sessão: um token não cria outro token).

Formato de `TaskDto` (o mesmo em todas as respostas):

```json
{
  "id": "0b6c…", "code": "T-7K2QM",
  "product": { "id": "…", "slug": "demo", "name": "Demo", "color": "#3b82f6" },
  "title": "Configurar callback OAuth no painel",
  "body": "Passos:\n1. …", "status": "blocked", "position": 2048,
  "priority": "high", "labels": ["oauth", "manual"], "dueDate": "2026-11-10",
  "assignee": { "id": "…", "name": "Ana" },
  "source": "claude", "createdBy": { "ref": "…", "name": "Ana (Claude)" },
  "blockedNote": "Painel recusa a URL: 'domínio não verificado'",
  "checklist": [{ "id": "c1", "text": "Salvar domínio", "done": true }],
  "checklistDone": 1, "checklistTotal": 3,
  "links": [{ "label": "Doc", "url": "https://example.com/doc" }],
  "commentCount": 2, "overdue": false,
  "createdAt": "…", "updatedAt": "…", "doneAt": null, "archivedAt": null
}
```

`product` e `assignee` vêm `null` quando não houver. A lista e o quadro **não** trazem `body`, `checklist` nem `links`, só os contadores. Isso deixa o polling leve. O `get` traz tudo.

| Método e rota | Corpo / query | Resposta | Erros |
|---|---|---|---|
| `GET /v1/staff/tasks` | `status` (csv), `product` (slug ou id), `assignee` (`me`, id ou `none`), `label`, `q` (título, código, corpo, `ILIKE`), `updatedSince` (ISO), `includeArchived` (bool, default false), `limit` (1–200, default 100), `cursor` | `{ items: TaskDto[], nextCursor, serverTime }` ordenado por `updatedAt desc` | `400` filtro inválido |
| `GET /v1/staff/tasks/board` | `product`, `assignee`, `label`, `q`, `updatedSince` | `{ columns: { todo: TaskDto[], doing: [...], blocked: [...], done: [...] }, counts: { todo, doing, blocked, done, overdue }, serverTime }`. Cada coluna vem ordenada por `position`. `done` traz só as 50 mais recentes e não arquivadas. Com `updatedSince`, vem também `removedIds` (arquivadas desde então) e as colunas trazem só o que mudou | `400` |
| `GET /v1/staff/tasks/meta` | — | `{ products: [{id,slug,name,color}], staff: [{id,name}], labels: [{name,count}] }` | — |
| `GET /v1/staff/tasks/{idOrCode}` | Aceita Guid ou `T-XXXXX` | `TaskDto` completo mais `comments: [...]` e `events: [...]` (últimos 100 de cada) | `404` |
| `POST /v1/staff/tasks` | `{ title*, body?, product? (slug ou id), status? (default todo), priority?, labels?, dueDate?, assigneeId?, checklist?: [{text, done?}], links? }` | `201` + `TaskDto`. Entra no **topo** da coluna | `400` validação, `404` produto ou staff não existe, `409` código colidiu 3 vezes |
| `PATCH /v1/staff/tasks/{id}` | Só os campos enviados: `title`, `body`, `product` (null limpa), `priority`, `labels`, `dueDate` (null limpa), `assigneeId` (null limpa), `checklist`, `links`, `blockedNote`. Campos que aceitam limpar usam `JsonElement?`, como `UpdateTicketRequest.AssigneeId`, para distinguir ausente de `null`. Opcional: `ifUpdatedAt` | `TaskDto` | `400`, `404`, `409` se `ifUpdatedAt` não bater ("A tarefa mudou. Recarregue."). **`status` não é aceito aqui:** `400` "Use /move para mudar o status." |
| `POST /v1/staff/tasks/{id}/move` | `{ status*, beforeId?, afterId?, blockedNote? }`. `beforeId` é o cartão que fica **acima**, `afterId` o que fica **abaixo**. Os dois omitidos = topo da coluna | `TaskDto` | `400` status inválido, vizinho de outra coluna ou `blocked` sem `blockedNote`; `404` |
| `POST /v1/staff/tasks/{id}/comments` | `{ body* }` (1–10.000) | `201` + comentário | `400`, `404` |
| `POST /v1/staff/tasks/{id}/archive` | — | `204` | `404` |
| `POST /v1/staff/tasks/{id}/unarchive` | — | `TaskDto` (volta ao topo da coluna) | `404` |
| `POST /v1/staff/tasks/archive-done` | `{ product?, olderThanDays? (default 0) }` | `{ archived: n }` | `400` |
| `GET /v1/staff/me/tokens` | — | `[{ id, name, prefix, scopes, createdAt, lastUsedAt, expiresAt, revokedAt }]` | — |
| `POST /v1/staff/me/tokens` | `{ name* (1–80), expiresInDays?: 30\|90\|365\|null, scopes?: ["tasks"] }` | `201` + `{ id, name, prefix, scopes, expiresAt, token }`. **`token` só aqui** | `400`, `409` limite de 10 |
| `DELETE /v1/staff/me/tokens/{id}` | — | `204` (marca `RevokedAt` e limpa o cache do token) | `404` (inclusive token de outra pessoa) |

**Move atômico.** Tudo acontece numa transação (`BeginTransactionAsync`):

1. Carregue a tarefa e os vizinhos com `FOR UPDATE` (`FromSql`).
2. Confira se os vizinhos estão na coluna de destino e não arquivados.
3. Calcule a posição (D4), renumerando se faltar folga.
4. Aplique o status: `DoneAt` liga ou desliga; ao sair de `blocked`, `BlockedNote` vira `null`.
5. Grave o evento `moved` (e `blocked`) e faça o commit.

Mover para a mesma coluna só reordena e não grava evento `moved`.

**`updatedSince`.** O servidor devolve `serverTime` (o relógio do servidor, não o do cliente). O cliente manda esse valor de volta na próxima chamada. Isso evita perder mudanças por diferença de relógio.

**Limites em todas as escritas.** Todo campo de texto passa por `Clean.Cut` no tamanho da tabela D2. Corpo JSON acima de 256 KB leva `413`.

### D9 — Nota de bloqueio

Mover para `blocked` exige `blockedNote` (1–2000). No console, soltar um cartão em "Bloqueado" abre um popover pedindo o motivo. Cancelar desfaz o arraste. Sair de `blocked` limpa o campo, e o texto fica no evento `blocked`. É ali que a pessoa escreve o erro que viu, e é isso que o Claude lê para conferir.

### D10 — Atualização: polling, não WebSocket

- O console faz `GET /board?updatedSince=<serverTime anterior>` a cada **12 s** com a aba visível (`refetchInterval` do TanStack Query com `refetchIntervalInBackground: false`). Também atualiza ao focar a janela, como já faz o `providers.tsx`.
- A cada 5 minutos, ou depois de um erro, busca o quadro inteiro sem `updatedSince`.
- O delta é aplicado no cache, substituindo por `id`, removendo `removedIds` e reordenando a coluna por `position`.
- **Não aplique delta durante um arraste em andamento.** Guarde o delta e aplique ao soltar.
- **Por que não WebSocket:** o console é um proxy Next para a API. SSE e WebSocket através do proxy e de cada hospedagem (Railway, VPS) exigiriam configuração em cada instalação. Uma equipe pequena não percebe 12 s.

### D11 — Console: página "Tarefas"

- **Rota:** `apps/console/app/(app)/tasks/page.tsx`. Na `NAV` de `components/shell.tsx`, entra o item "Tarefas" logo abaixo de "Chamados", com um ícone de quadro no mesmo estilo dos outros.
- **Bibliotecas** (versões exatas, conferidas na hora da T12, regra 7):
  - `@dnd-kit/core`, `@dnd-kit/sortable` e `@dnd-kit/utilities`. Suportam teclado e leitor de tela, funcionam com React 19 e não exigem um provider global pesado.
  - `react-markdown` e `remark-gfm` para o corpo e os comentários. **Sem `rehype-raw`:** HTML cru não é renderizado. Os links abrem com `target="_blank" rel="noopener noreferrer"`.
  - Se o console já tiver um renderizador de markdown nos chamados, use o mesmo e pule estes dois pacotes. Hoje não tem.
- **Quadro.** São 4 colunas: A fazer, Fazendo, Bloqueado e Concluído.
  - O cabeçalho de cada coluna mostra o contador.
  - Arrasta-se dentro da coluna e entre colunas, com a sombra do cartão (`DragOverlay`).
  - Uma coluna vazia mostra uma área de soltar com o texto "Solte aqui".
  - A coluna Concluído tem o botão "Arquivar concluídas" (`archive-done`).
- **Cartão.**
  - Código e título, com a faixa lateral na cor do `Product.Color` e o nome curto do produto.
  - Prioridade `high` com marcador visível.
  - Etiquetas, até 3 e depois "+n".
  - Prazo, em vermelho quando atrasado.
  - Iniciais do responsável.
  - `✓ 2/5` da checklist e `💬 n` de comentários.
  - Ícone de robô quando `source=claude`.
  - Na coluna Bloqueado, a primeira linha da `blockedNote`.
- **Otimista com rollback.**
  - No `onDragEnd`: `cancelQueries` do quadro, guardar um snapshot, mover no cache e chamar `/move`.
  - Em erro: restaurar o snapshot e mostrar um toast com a `message`.
  - Em sucesso: substituir o cartão pelo `TaskDto` devolvido.
  - Criação, PATCH e arquivo seguem o mesmo padrão.
- **Criação rápida.** O botão "+" no topo de cada coluna abre um input inline. Enter cria; Esc cancela. O produto vem do filtro ativo.
- **Filtros** (na URL como query string, para dar para compartilhar):
  - Produto, um seletor com as cores.
  - Responsável: eu, ninguém ou qualquer.
  - Etiqueta.
  - Busca.
  - "Só atrasadas".
  - "Criadas pelo Claude".
- **Drawer do cartão.** Abre pelo clique ou por Enter no cartão focado e grava `?task=T-XXXXX` na URL.
  - Título editável inline.
  - Corpo em markdown com as abas Ver e Editar.
  - Checklist com barra de progresso, adicionar, marcar e remover.
  - Status (um seletor que chama `/move` para o topo da coluna).
  - Prioridade, etiquetas (com autocompletar vindo de `meta.labels`), prazo, responsável, produto e links.
  - A nota de bloqueio fica em destaque no topo quando o status é `blocked`.
  - A linha do tempo intercala comentários e eventos, com uma caixa de comentário no fim (Ctrl+Enter envia).
  - Botão Arquivar.
  - Toda edição é PATCH do campo, com debounce de 600 ms nos textos.
- **Atalhos.** Eles ficam desligados quando o foco está num input.
  - `N` abre a criação em "A fazer".
  - `/` foca a busca.
  - `Esc` fecha o drawer ou o popover.
  - `?` mostra a lista de atalhos.
- **Acessibilidade.** Use `KeyboardSensor` com `sortableKeyboardCoordinates`: Espaço pega, as setas movem e Espaço solta. Os anúncios do dnd-kit são em português ("Tarefa T-7K2QM movida para Fazendo, posição 2"). Cada cartão é focável.
- **Visual.** Use o design system clássico (`docs/marca/…`, tokens existentes, densidade de 13 px, botões pill, `components/ui.tsx`). Não crie cor nova: a cor de cada sistema vem de `Product.Color`.

### D12 — Pacote MCP `packages/mcp`

- **Nome do pacote:** `pitwall-mcp`, com `bin: { "pitwall-mcp": "dist/index.js" }`. O `npx -y pitwall-mcp` precisa que o nome publicado seja esse.
  - O nome escopado `@pitwall/mcp` só serviria para filtrar no workspace, então fica de fora.
  - Ele entra no `pnpm-workspace.yaml`.
  - O resto do `package.json` segue `packages/sdk/package.json`: `type: module`, build `tsc`, teste com `node --test test/*.test.mjs`, `publishConfig.access: public`, `repository` e `license`.
- **Dependências** (exatas, regra 7):
  - `@modelcontextprotocol/sdk` (1.x estável).
  - `zod`, na versão que o SDK do MCP declara como peer ou dependência.
  - Nada mais. O cliente HTTP é o `fetch` do Node ≥ 20 (`engines.node: ">=20"`).
- **Transporte:** stdio (`StdioServerTransport`). Logs vão para **stderr**, porque o stdout é do protocolo.
- **Configuração:**
  - `PITWALL_URL` é a URL pública do **console** de cada instalação. A barra final é removida.
  - `PITWALL_TOKEN` é o token `pwt_…`.
  - Se faltar uma das duas, o servidor sobe mesmo assim. Toda tool responde com `isError` e o texto: "Configure PITWALL_URL e PITWALL_TOKEN (Configurações → Tokens pessoais no console)".
- **Cliente** (`src/client.ts`): `request(method, path, body?)` com `Authorization: Bearer`, `accept: application/json` e timeout de 15 s (`AbortSignal.timeout`). **Nunca registre o token**, nem em erro; ao montar mensagens, use só o prefixo.
- **Erros convertidos em texto para o modelo** (resultado com `isError: true`):
  - `401`: "Token inválido, expirado ou revogado. Gere outro em Configurações → Tokens pessoais."
  - `403`: "O token não tem o escopo tasks."
  - `404`: "Tarefa ou produto não encontrado. Use list_tasks ou list_products."
  - `400` ou `409`: a `message` da API.
  - `429`: "Limite de requisições. Espere um minuto."
  - Erro de rede ou timeout: "Não consegui falar com <PITWALL_URL>. Verifique a URL e se o console está no ar."
  - `5xx`: "O Pitwall respondeu <status>."
- **Tools** (`src/tools.ts`). As descrições são escritas para orientar o modelo:

| Tool | Entrada (zod) | Faz | Descrição (resumo do texto) |
|---|---|---|---|
| `list_products` | — | `GET /meta` → products | "Lista os sistemas (slug, nome). Use o slug em product." |
| `list_tasks` | `status?: ("todo"\|"doing"\|"blocked"\|"done")[]`, `product?`, `q?`, `label?`, `updatedSince?`, `includeArchived?`, `limit?` (≤100) | `GET /tasks` | "Busque antes de criar para não duplicar. Para retomar o trabalho, filtre blocked e doing." |
| `get_task` | `task` (código `T-…` ou id) | `GET /tasks/{task}` | "Traz corpo, checklist, nota de bloqueio, comentários e histórico. Leia antes de conferir uma tarefa." |
| `create_task` | `title` (≤200), `body?` (markdown: contexto, passos, como verificar), `product?` (slug), `priority?`, `labels?`, `dueDate?` (YYYY-MM-DD), `checklist?: string[]`, `links?` | `POST /tasks` | "Registre só o que a pessoa precisa fazer manualmente (painel externo, teste no aparelho, credencial). Um título por ação. No corpo: por que, passos exatos e como saber se deu certo." |
| `update_task` | `task`, mais qualquer campo do PATCH, e `checklistToggle?: { id, done }[]` | `GET` e depois `PATCH` (aplica o toggle sobre a checklist atual) | "Edite campos. Não muda status: use move_task." |
| `move_task` | `task`, `status`, `blockedNote?` | `POST /move` (topo da coluna) | "Mova para done só depois de verificar. blocked exige blockedNote." |
| `comment_task` | `task`, `body` | `POST /comments` | "Registre o que você verificou, o resultado e o próximo passo." |
| `board_summary` | `product?` | `GET /board` | "Contagem por coluna, atrasadas, e títulos de blocked e doing. Use no começo da sessão." |

Cada tool devolve **texto curto e legível**. Exemplo: `T-7K2QM [blocked] Configurar callback (demo) — nota: …`. O JSON completo vai junto num segundo bloco de conteúdo. A resposta crua inteira gastaria contexto do modelo.

### D13 — "Login" do MCP

Cada instalação do Pitwall tem o próprio domínio, e o MCP não sabe de nenhum.

1. A pessoa abre o console da **sua** instalação, vai em Configurações → Tokens pessoais → "Novo token" e copia o `pwt_…` (que aparece uma vez).
2. No terminal, roda:

   ```sh
   claude mcp add pitwall --scope user \
     --env PITWALL_URL=https://<seu-dominio> \
     --env PITWALL_TOKEN=pwt_xxxxxxxxxxxx \
     -- npx -y pitwall-mcp
   ```

   Antes de publicar no npm, use o build local: `-- node <caminho-do-repo>/packages/mcp/dist/index.js`.
3. Para testar:
   - Dentro do Claude Code, `/mcp` mostra `pitwall` conectado e as 8 tools.
   - Peça "mostre o board_summary". Sem Claude, use `npx @modelcontextprotocol/inspector node packages/mcp/dist/index.js`, passando as variáveis de ambiente.
4. Para revogar, use a mesma tela de Configurações. Na chamada seguinte, depois do cache de 1 min, o MCP passa a responder a mensagem de `401`.

**O MCP fala com o console, não direto com a API.** O proxy `apps/console/app/v1/[...path]/route.ts` passa a repassar o cabeçalho `authorization` (T5). Assim `PITWALL_URL` é a mesma URL que a pessoa usa no navegador. O middleware `StaffHosts` continua bloqueando `/v1/staff` nos hosts públicos.

### D14 — Trecho para o `CLAUDE.md` de cada sistema

Vai para `docs/operacao/tarefas-mcp.md` (T17). Cada repositório copia o trecho e troca o slug:

```md
## Tarefas da equipe (Pitwall MCP)
Sistema neste repositório: product = "<slug>".
- Início da sessão: rode board_summary(product) e list_tasks(status=[blocked, doing]) e list_tasks(status=[done], updatedSince=<7 dias>).
  Para cada blocked, leia get_task (nota de bloqueio e comentários), tente resolver ou verificar, e registre o resultado com comment_task.
  Mova para done só o que você verificou de fato; se ainda falha, deixe blocked e comente o que encontrou.
- Durante: se a pessoa disser "conferi T-XXXXX", leia get_task e verifique no código, nos logs ou no ambiente.
- Fim da sessão: para cada passo manual que sobrou (painel externo, credencial, teste em aparelho, deploy), rode list_tasks(q=…) para não duplicar e então create_task com product, passos exatos e "como verificar".
- Nunca crie tarefa para o que você mesmo pode fazer agora. Nunca duplique: atualize ou comente a existente.
```

### D15 — Rate limit

A política nova `tasks-writes` é `FixedWindow`, com 120 escritas por minuto **por staff id** (a partição é a claim `pw:staff`). Leituras não têm limite próprio. A criação de token usa a política `login` que já existe, para dificultar a força bruta.

---

## 3. Modelo de dados e migração

Tabelas: `team_tasks`, `team_task_comments`, `team_task_events` e `staff_tokens` (snake_case, pela convenção do `PitwallDb`).

Índices:

- `team_tasks`: único em `code`; `(status, position)`; `product_id`; `updated_at`; `assignee_id`; `archived_at`. Os índices do quadro filtram `archived_at IS NULL`: use `HasFilter("archived_at IS NULL")` em `(status, position)`.
- `team_task_comments`: `(task_id, created_at)`.
- `team_task_events`: `(task_id, created_at)`.
- `staff_tokens`: único em `hash`; `staff_user_id`.

FKs: a tarefa é apagada com `Cascade` para comentários e eventos. `product_id` e `assignee_id` usam `SetNull`.

Para gerar a migração (precisa do `dotnet-ef` global; se não houver, rode `dotnet tool install -g dotnet-ef`):

```sh
dotnet ef migrations add TeamTasks --project apps/api/Pitwall.Api --output-dir Data/Migrations
```

A migração roda sozinha na subida da API, porque o `Program.cs` já faz `Migrate`. Confira se o `Down` remove as 4 tabelas.

---

## 4. Segurança

- **Escopo:** um token só tem `tasks` e só alcança `/v1/staff/tasks/*` (D7). As rotas de token exigem a sessão.
- **Hash:** só o SHA-256 é gravado. O texto aparece uma vez. A lista mostra só o prefixo.
- **Revogação:** imediata no banco. O cache de 1 min é invalidado no `DELETE`, com a chave do cache derivada do hash. Staff inativo invalida todos os tokens dela.
- **Expiração:** opcional, conferida a cada requisição.
- **Rate limit:** D15.
- **Limites de campo:** a tabela D2, `Clean.Cut`, listas com tamanho máximo e `413` acima de 256 KB.
- **Markdown:** renderizado sem HTML cru. Links só `http`/`https`, validados na API.
- **Nunca registrar o token.**
  - Na API, não logar o cabeçalho `Authorization`. Conferir se o logging de requisição existente já omite esse cabeçalho; se não omitir, pare e relate.
  - No proxy do console, não logar cabeçalhos.
  - No MCP, nada de token em stderr nem em mensagem de erro.
- **Isolamento:** a tarefa não aparece em nenhuma rota de produto, de cliente nem pública, e não dispara webhook.

---

## 5. Testes

API: arquivos novos em `apps/api/Pitwall.Tests/`, usando o `PitwallFixture` e o `SignInAsAdminAsync` de `ProductProfileTests.cs`. Se o helper não puder ser reutilizado sem alterar o arquivo antigo, copie-o para um helper novo (regra 4).

`TeamTaskUnitTests.cs`:

- `Code_has_expected_format`
- `Code_never_matches_ticket_regex` (10.000 códigos gerados, nenhum casa com `TicketCodes.FindIn`)
- `Position_top_bottom_and_between`
- `Position_requests_reindex_when_gap_too_small`
- `Labels_are_normalized_and_limited`

`TeamTaskTests.cs`:

- `Create_returns_201_with_code_and_top_position`
- `Create_requires_title`
- `Create_with_unknown_product_returns_404`
- `Create_via_session_sets_source_manual`
- `Patch_updates_only_sent_fields`
- `Patch_null_clears_due_date_and_assignee`
- `Patch_rejects_status`
- `Patch_with_stale_ifUpdatedAt_returns_409`
- `Move_between_columns_orders_by_neighbors`
- `Move_to_done_sets_DoneAt_and_back_clears_it`
- `Move_to_blocked_requires_note`
- `Move_out_of_blocked_clears_note_and_keeps_event`
- `Move_with_neighbor_from_other_column_returns_400`
- `Move_reindexes_column_when_needed`
- `Board_returns_four_columns_ordered_and_counts`
- `Board_updatedSince_returns_delta_and_removedIds`
- `List_filters_by_product_status_label_and_q`
- `Get_by_code_includes_comments_and_events`
- `Comment_bumps_updatedAt_and_logs_event`
- `Archive_hides_from_board_and_unarchive_restores`
- `ArchiveDone_archives_only_done`
- `Tasks_routes_return_404_on_public_host` (mesmo padrão de `StaffHostsTests`)

`StaffTokenTests.cs`:

- `Create_token_returns_plaintext_once_and_stores_hash`
- `List_tokens_never_returns_plaintext`
- `Token_with_tasks_scope_reaches_tasks_routes`
- `Token_create_sets_source_claude_and_name_suffix`
- `Token_cannot_reach_tickets_or_products` (`401` em `/v1/staff/tickets` e `/v1/staff/products`)
- `Token_cannot_create_tokens`
- `Revoked_token_returns_401`
- `Expired_token_returns_401`
- `Token_of_inactive_staff_returns_401`
- `Token_write_does_not_need_csrf_header`
- `Session_write_without_csrf_header_still_fails`
- `Token_limit_returns_409`
- `Cannot_revoke_other_staff_token`

MCP: `packages/mcp/test/tools.test.mjs`, com `fetch` falso injetado no cliente (o cliente recebe `fetch` por parâmetro, com default `globalThis.fetch`):

- `lists the eight tools with schemas`
- `missing env returns configuration error`
- `401 becomes token message without leaking token`
- `network error mentions url`
- `create_task posts body and formats result`
- `update_task applies checklistToggle over current checklist`
- `move_task to blocked without note returns api message`

Console: não há suíte de testes de UI. A verificação é `corepack pnpm --filter @pitwall/console build` mais o roteiro manual (seção 7).

---

## 6. Tarefas

### T1 — Domínio
- [x] **Arquivos:** `apps/api/Pitwall.Api/Domain/TeamTask.cs` (novo: `TeamTask`, `TeamTaskComment`, `TeamTaskEvent`, `TeamTaskChecklistItem`, `TeamTaskLink`, e as classes estáticas `TeamTaskStatuses`, `TeamTaskPriorities`, `TeamTaskSources`, `TeamTaskEventKinds` no padrão `All/IsValid` de `TicketStatuses`), `Domain/StaffToken.cs` (novo: `StaffToken`, `StaffTokenScopes`), `Data/PitwallDb.cs` (DbSets e mapeamentos da seção 3).
- [x] **Critério:** campos e limites idênticos à D2, D5 e D6; índices da seção 3.
- [x] **Verificar:** `dotnet build Pitwall.slnx`.

### T2 — Migração
- [x] **Arquivos:** `Data/Migrations/*_TeamTasks.cs`, `*.Designer.cs` e o snapshot (gerados).
- [x] **Comando:** o da seção 3. Leia a migração gerada: 4 tabelas, os índices, o filtro parcial e as FKs com o `OnDelete` certo.
- [x] **Verificar:** `dotnet test Pitwall.slnx` (os testes antigos sobem o banco com a migração nova e passam).

### T3 — Serviços puros
- [x] **Arquivos:** `Services/TeamTaskCodes.cs`, `Services/TeamTaskPositions.cs` (`Top(min)`, `Bottom(max)`, `Between(a,b)`, `NeedsReindex(a,b)`), `Auth/Secrets.cs` (acrescentar `NewStaffToken()`), `Pitwall.Tests/TeamTaskUnitTests.cs`.
- [x] **Verificar:** `dotnet test Pitwall.slnx --filter TeamTaskUnitTests`.

### T4 — Autenticação por token
- [x] **Arquivos:** `Auth/StaffTokenAuth.cs` (novo), `Auth/StaffAuth.cs` (acrescentar `Policies.Tasks` e `StaffContext.IsToken`), `Program.cs` (esquema, política `tasks`, rate limit `tasks-writes`).
- [x] **Critério:** D7 e D15. As políticas antigas continuam idênticas.
- [x] **Verificar:** `dotnet build Pitwall.slnx` e `dotnet test Pitwall.slnx` (nada antigo quebra).

### T5 — Proxy repassa `authorization`
- [x] **Arquivo:** `apps/console/app/v1/[...path]/route.ts`. Acrescente `'authorization'` em `FORWARD_REQUEST`. Mais nada.
- [x] **Verificar:** `corepack pnpm --filter @pitwall/console build`.

### T6 — Rotas de token
- [x] **Arquivos:** `Endpoints/Staff/StaffTokenEndpoints.cs` (novo: `GET`, `POST` e `DELETE /v1/staff/me/tokens`), `Program.cs` (o `Map…`), `Pitwall.Tests/StaffTokenTests.cs` (os testes que não dependem de rota de tarefa; os outros entram na T8).
- [x] **Verificar:** `dotnet test Pitwall.slnx --filter StaffTokenTests`.

### T7 — Rotas de leitura e criação de tarefas
- [x] **Arquivos:** `Endpoints/Staff/StaffTaskEndpoints.cs` (novo: DTO, `GET` lista, `board`, `meta`, `get`, `POST` criar), `Program.cs` (o `Map…`), `Pitwall.Tests/TeamTaskTests.cs` (testes de Create, Board, List, Get e host público).
- [x] **Critério:** contratos exatos da D8; lista e quadro sem `body`.
- [x] **Verificar:** `dotnet test Pitwall.slnx --filter TeamTaskTests`.

### T8 — Escritas: PATCH, move, comentário e arquivo
- [x] **Arquivos:** `Endpoints/Staff/StaffTaskEndpoints.cs`, `Pitwall.Tests/TeamTaskTests.cs` (o restante), `Pitwall.Tests/StaffTokenTests.cs` (os testes com rota de tarefa).
- [x] **Critério:** move em transação com `FOR UPDATE` (D8); evento em toda escrita (D5); `blocked` exige nota (D9).
- [x] **Verificar:** `dotnet test Pitwall.slnx` (tudo verde).

### T9 — Pacote MCP: esqueleto e cliente
- [x] **Arquivos:** `packages/mcp/package.json`, `tsconfig.json`, `src/index.ts` (stdio e leitura do env), `src/client.ts` (D12, erros convertidos), `README.md` (D13), `pnpm-workspace.yaml` (acrescentar `packages/mcp`).
- [x] **Verificar:** `corepack pnpm install` e `corepack pnpm --filter pitwall-mcp build`.

### T10 — Tools do MCP
- [x] **Arquivos:** `packages/mcp/src/tools.ts`, `src/format.ts` (texto curto por tarefa), `test/tools.test.mjs`.
- [x] **Critério:** as 8 tools, os esquemas e as descrições da D12; nenhum token em saída.
- [x] **Verificar:** `corepack pnpm --filter pitwall-mcp test`. Com a API local, rode `npx @modelcontextprotocol/inspector node packages/mcp/dist/index.js` e chame `board_summary`.

### T11 — Console: tipos, hooks e quadro só de leitura
- [x] Leia antes `apps/console/node_modules/next/dist/docs` (regra 6).
- [x] **Arquivos:** `apps/console/lib/api.ts` (tipos `TeamTask`, `TeamTaskDetail`, `Board`, `TasksMeta`), `apps/console/lib/tasks.ts` (novo: `useBoard` com polling e delta (D10), `useTask`, `useTasksMeta`), `app/(app)/tasks/page.tsx`, `components/tasks/board.tsx` e `components/tasks/card.tsx` (novos), `components/shell.tsx` (item na `NAV`).
- [x] **Critério:** 4 colunas com contadores; cartão como na D11; atualiza a cada 12 s e ao focar.
- [x] **Verificar:** `corepack pnpm --filter @pitwall/console build` e `corepack pnpm dev`. Abra `/tasks` e crie uma tarefa por `curl` com um token: ela aparece em até 12 s.

### T12 — Arrastar e soltar
- [x] **Arquivos:** `apps/console/package.json` (dnd-kit, versões exatas), `components/tasks/board.tsx`, `components/tasks/card.tsx`, `components/tasks/blocked-prompt.tsx` (novo), `lib/tasks.ts` (`useMoveTask` otimista com rollback).
- [x] **Critério:**
  - Arrasta dentro da coluna e entre colunas, pelo mouse, toque e teclado.
  - Soltar em Bloqueado pede a nota; cancelar desfaz.
  - Com a rede off no DevTools, o cartão volta e aparece um toast.
  - O polling não interrompe um arraste.
- [x] **Verificar:** build e teste manual dos 4 critérios.

### T13 — Drawer do cartão
- [x] **Arquivos:** `apps/console/package.json` (react-markdown e remark-gfm, exatas), `components/tasks/drawer.tsx`, `components/tasks/markdown.tsx`, `components/tasks/checklist.tsx`, `components/tasks/timeline.tsx` (novos), `lib/tasks.ts` (`usePatchTask`, `useComment`, `useArchive`), `app/(app)/tasks/page.tsx` (`?task=` na URL).
- [x] **Critério:** tudo da D11 sobre o drawer; HTML cru no corpo aparece como texto.
- [x] **Verificar:** build. Crie uma tarefa com `<script>alert(1)</script>` no corpo: aparece como texto e nada executa.

### T14 — Filtros, criação rápida, atalhos e arquivo
- [x] **Arquivos:** `components/tasks/filters.tsx`, `components/tasks/quick-create.tsx`, `components/tasks/shortcuts.tsx` (novos), `components/tasks/board.tsx`, `app/(app)/tasks/page.tsx`.
- [x] **Critério:**
  - Os filtros ficam na URL.
  - `N`, `/`, `Esc` e `?` funcionam e ficam desligados dentro de inputs.
  - "Arquivar concluídas" funciona.
  - Há destaque de atrasadas e o filtro "Criadas pelo Claude".
- [x] **Verificar:** build e teste manual.

### T15 — Configurações: tokens pessoais
- [x] **Arquivos:** `app/(app)/settings/page.tsx` (um `Card` novo, "Tokens pessoais"), `components/settings/tokens.tsx` (novo), `lib/api.ts` (tipo `StaffTokenInfo`).
- [x] **Critério:**
  - Lista com prefixo, último uso, expiração e um botão Revogar com confirmação inline (sem `confirm()` do navegador).
  - "Novo token" mostra o token uma vez, com botão Copiar e o comando `claude mcp add` pronto, preenchido com `window.location.origin` e o token.
- [x] **Verificar:** build, e criar, copiar, revogar e ver o MCP responder `401`.

### T16 — Verificação geral
- [x] **Comandos:** `dotnet test Pitwall.slnx`, `corepack pnpm --filter @pitwall/sdk test`, `corepack pnpm --filter pitwall-mcp test` e `corepack pnpm --filter @pitwall/console build`.
- [x] **Critério:** tudo verde. Relate qualquer falha sem "consertar" teste antigo.

### T17 — Documentação
- [x] **Arquivos:**
  - `docs/operacao/tarefas-mcp.md` (novo): token, `claude mcp add`, teste, revogação, o trecho do `CLAUDE.md` da D14 e problemas comuns (`401`, URL errada, host público devolvendo `404`).
  - `docs/arquitetura/README.md`: componente "MCP (`packages/mcp`)" e o fluxo "Tarefa da equipe".
  - `docs/README.md`: link em `operacao/`.
  - `CONTRIBUTING.md`: só se tiver lista de comandos de teste; nesse caso, acrescentar o do MCP.
- [x] **Critério:** nenhum domínio real, e-mail ou nome de cliente (regra 8).

### T18 — Roteiro manual de ponta a ponta
- [x] Siga a seção 7 e marque cada passo. Relate o que falhou.

---

## 7. Roteiro manual de ponta a ponta

1. `corepack pnpm dev`. Entre no console local como admin.
2. Em Configurações → Tokens pessoais, crie "teste local" e copie o token. Confira que, ao recarregar, só aparece o prefixo.
3. Rode `corepack pnpm --filter pitwall-mcp build` e depois `claude mcp add pitwall-local --env PITWALL_URL=http://localhost:<porta-do-console> --env PITWALL_TOKEN=<token> -- node packages/mcp/dist/index.js`.
4. No Claude Code, `/mcp` mostra 8 tools. Peça: "crie uma tarefa no produto demo para configurar o webhook, com 3 itens de checklist".
5. No console, a tarefa aparece em "A fazer" em até 12 s, com o ícone do Claude, a cor do produto e `✓ 0/3`.
6. Arraste para "Fazendo" e reordene. Recarregue: a ordem foi mantida.
7. Arraste para "Bloqueado", escreva "erro 400 ao salvar" e confirme. A nota aparece no cartão.
8. Peça ao Claude "confira as tarefas bloqueadas". Ele chama `list_tasks`/`get_task`, lê a nota e comenta com `comment_task`. O comentário aparece no drawer.
9. Abra o drawer: edite o corpo em markdown, marque um item da checklist, defina um prazo de ontem e veja o destaque de atrasada.
10. Com teclado só: Tab até um cartão, Espaço, setas, Espaço. O cartão muda de coluna e o leitor de tela anuncia.
11. Desligue a rede no DevTools e arraste: o cartão volta e aparece um toast. Religue.
12. Mova para Concluído e clique em "Arquivar concluídas": a coluna esvazia. Ache a tarefa por `list_tasks(includeArchived=true)`.
13. Revogue o token. Depois de 1 minuto, a próxima tool responde a mensagem de `401`.
14. Use o token num `curl` para `/v1/staff/tickets` e confira o `401`.

---

## 8. Decisões (fechadas em 2026-11-03)

1. **Nome no npm:** `pitwall-mcp`, sem escopo (D12). O nome está livre (`npm view pitwall-mcp` dá 404).
   A publicação fica com o dono do repositório: `corepack pnpm --filter pitwall-mcp build` e
   `npm publish` dentro de `packages/mcp`, com a conta npm logada.
2. **Quem vê o quadro e cria token:** toda a equipe, `agent` e `admin`. O token é pessoal e só alcança
   as tarefas, então não precisa ficar restrito a admin.
3. **Atualização:** polling de 12 s com a aba visível (D10), sem tempo real.
4. **Expiração do token:** 90 dias por padrão (também na API, quando `expiresInDays` não vem), com 30
   ou 365 dias, ou "sem expiração" (`expiresInDays: null`) como opções.
5. **Tarefa sem produto:** permitida. É o trabalho geral da equipe, e no console aparece como
   "Geral da equipe".

---

## 9. Notas da implementação

O que ficou diferente do plano, e por quê:

1. **Datas em `DateTime` (UTC), não `DateTimeOffset`.** Todas as entidades do `PitwallDb` usam
   `DateTime` UTC (`timestamp with time zone`). As tabelas novas seguem o mesmo padrão.
2. **`JsonElement`, não `JsonElement?`, no PATCH.** O System.Text.Json lê um `null` do JSON num
   `JsonElement?` como "sem valor", igual a campo ausente, e aí `null` não limpava nada. Com
   `JsonElement` puro, ausente chega como `Undefined` e `null` como `Null`. O mesmo problema existe
   hoje em `UpdateTicketRequest.AssigneeId`: o "Comigo → desatribuir" do chamado manda
   `assigneeId: null`, e a API ignora. Fora do escopo daqui; vale um `fix(api)` à parte.
3. **Esquema de política em vez de dois esquemas na política `tasks`.** Com
   `AddAuthenticationSchemes("StaffSession","StaffToken")`, um 401 chamaria o challenge dos dois
   handlers, e o segundo tentaria escrever numa resposta já iniciada. A política usa o esquema
   `StaffSessionOrToken` (`AddPolicyScheme`), que escolhe por requisição: Bearer `pwt_` → token,
   senão → sessão. Assim "Bearer vence o cookie" sai de graça, sem mexer no `StaffSessionAuthHandler`.
4. **`updatedAt` em microssegundos.** O servidor corta o relógio na precisão do Postgres, para que o
   `updatedAt` devolvido numa escrita seja exatamente o comparado num `ifUpdatedAt` posterior.
5. **Delta com 1 s de sobreposição.** `GET /board?updatedSince=` devolve o que mudou desde
   `updatedSince − 1 s`, para não perder uma escrita que leu o relógio antes do último poll e fez
   commit depois. Repetir um cartão é inofensivo (o cliente substitui por id). `removedIds` também traz
   o que saiu do filtro (mudou de sistema ou de responsável), além do arquivado.
6. **Renumeração marca os cartões como mudados.** Quando a coluna é renumerada, os cartões ganham
   `updatedAt` novo, para que todo quadro aberto receba as posições novas no próximo delta.
7. **Rotas aceitam id ou código** (`T-7K2QM`) em todas as escritas, não só no `GET`, porque o MCP
   trabalha com códigos. `beforeId`/`afterId` também aceitam os dois.
8. **`GET /{id}` devolve o `TaskDto` "achatado"** com `comments` e `events` no mesmo objeto.
9. **Criar direto em `blocked`** é aceito com `blockedNote` no corpo do `POST` (o "+" da coluna
   Bloqueado pede a nota).
10. **PATCH de `blockedNote`** só vale com a tarefa em `blocked` e grava um evento `blocked` com a nota
    nova: o histórico guarda cada versão do que a pessoa viu.
11. **Arquivo novo `Services/TeamTaskInput.cs`** (regras puras de etiquetas, checklist e links), para os
    testes de unidade não precisarem de banco.
12. **Limite de 256 KB** num middleware de `Program.cs`, antes da autenticação: o binding do corpo
    acontece antes de qualquer filtro de endpoint.
13. **Testes de API usam endereço próprio por cliente** (`X-Forwarded-For` em `TeamTaskKit`), porque
    login e criação de token dividem o limite por endereço da política `login`.
14. **Console.**
    - Visual: cantos retos, como o design system atual (`--radius: 0`). O plano falava em "botões
      pill", mas o console não tem nenhum.
    - Teclado: esquerda e direita levam à coluna vizinha (`coordinateGetter` próprio). A regra padrão
      do dnd-kit pula uma coluna vazia, porque as colunas esticam até a altura da mais alta.
    - Detecção de colisão: ponteiro, depois interseção, depois o cartão mais próximo da coluna. O
      `closestCorners` sozinho erra com colunas altas.
    - O cartão no ar não gira: um overlay inclinado sai da coluna pela borda, e o teclado lê isso
      como "ao lado".
    - Mutações do quadro usam `networkMode: 'always'` e cancelam o poll sem esperar nem reverter.
      Offline, o poll fica pausado, e esperar por ele travaria o rollback e o aviso.
15. **MCP.** `@modelcontextprotocol/sdk` 1.32.1 (a 1.32.2 tinha menos de duas semanas), `zod` 4.6.7.
    Além das mensagens da D12, uma resposta 200 que não é JSON vira "A resposta de … não é do Pitwall",
    o caso de um console atrás de uma tela de login (Cloudflare Access). Ver
    [tarefas-mcp.md](../operacao/tarefas-mcp.md#problemas-comuns).

### Verificação do roteiro (seção 7)

Feito localmente, sem o Claude Code interativo. O MCP foi dirigido por um cliente MCP real, via
stdio. O console foi testado num Chrome headless.

- Passos 2–5: token criado e só o prefixo listado. Tarefa criada pelo MCP com 3 itens de checklist,
  origem Claude, aparece no quadro.
- Passos 6–8: mover, bloquear com nota, `get_task` lê a nota, `comment_task` aparece no drawer.
- Passo 9: drawer abre por Enter; `<script>` no corpo aparece como texto.
- Passo 10: teclado (Espaço, seta, Espaço) troca de coluna e anuncia em português.
- Passo 11: offline, o cartão volta e aparece o aviso.
- Passos 13–14: token revogado responde 401; o token leva 401 em `/v1/staff/tickets`,
  `/v1/staff/products` e `/v1/staff/me/tokens`.
- Falta: o passo 4 de verdade (`/mcp` dentro do Claude Code) e o arraste com mouse e toque num
  aparelho.

