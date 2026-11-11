# Atlas

O **Atlas** (`/atlas` no console) é o mapa operacional vivo da instalação. Mostra os sistemas, os serviços
que os compõem, o que depende de quê e o que está pedindo atenção. Tem três níveis: **empresa** (um cartão
por sistema), **produto** (um mapa com uma coluna por motor) e **componente** (um painel com os detalhes).
O mesmo inventário é lido de cinco modos: arquitetura, fluxos, operação, atenção e evolução.

Uma instalação nova abre o Atlas vazio. Os sistemas, serviços e rotinas de cada instalação ficam só no banco
dela, nunca no código.

## Motores e relações

Cada nó tem um **motor** (a coluna em que aparece no mapa do produto) e cada ligação tem uma **relação**
(o que significa). O tipo do nó (`kind`) define o motor padrão.

### Motores

| Motor (`engine`) | Nome | Tipos padrão |
|---|---|---|
| `code` | Código | package |
| `delivery` | Entrega | pipeline, host |
| `infra` | Infraestrutura | domain, dns, cdn, edge, certificate, external |
| `app` | Aplicação e dados | web, app, api, worker, database, storage, queue, cache, backup, other |
| `automation` | Automações e agentes | agent, cron, webhook, integration |
| `business` | Financeiro | payment, fiscal |
| `marketing` | Marketing | site, seo, analytics |
| `monitoring` | Monitoramento e suporte | monitor, email |
| `security` | Segurança | credential, vault |

Na criação, o motor é o informado; sem ele, o do tipo. Se o tipo muda e o motor ainda é o do tipo antigo,
o motor acompanha o tipo novo. Um motor informado sempre vence.

### Relações

| Categoria | Relações | Aparece ligada por padrão |
|---|---|---|
| `infra` | `depends_on`, `hosted_on`, `deploys_to`, `resolves_dns`, `protected_by`, `backed_up_by` | sim |
| `data` | `calls`, `reads_from`, `writes_to` | sim |
| `business` | `billed_through`, `issues_invoice_via`, `sends_email_via` | sim |
| `trigger` | `triggers`, `schedules` | não |
| `operational` | `monitored_by`, `reports_to`, `tracked_by`, `indexed_by`, `owned_by` | não |
| `security` | `uses_credential_ref` | não |

No console, o botão de categorias liga e desliga cada uma. Ligações antigas (com `kind`) viram relação:
`host` → `hosted_on`, `dns` → `resolves_dns`, `storage` → `writes_to`, `payment` → `billed_through`,
`email` → `sends_email_via`, `ai` e `integration` → `calls`, `monitor` → `monitored_by`,
`support` → `reports_to`, `measure` → `tracked_by`, `deploy` → `deploys_to`, `login`, `business` e
ligação sem tipo → `depends_on`.

## De onde vem cada informação

Cada nó e cada ligação guarda **quem afirmou** que ele existe (`origin`). Uma origem só troca por outra mais
forte: `observed` > `declared` > `discovered` > `reported`.

| Origem | Como chega | Exemplo |
|---|---|---|
| `declared` | Pessoa: console, importação de arquivo, ferramentas `register_*` do MCP | "A API roda no Railway" |
| `discovered` | Scan de manifestos do repositório | `docker-compose` com um serviço `postgres` |
| `reported` | Relatório de agente (`atlas_sync`, ops `node` e `edge`) | "Criei o worker de e-mail" |
| `observed` | Coletor de provedor | deploy concluído no Railway |

Cada afirmação vira também uma **evidência** (tabela `atlas_evidence`): fonte (`repo:acme-inc/rockets`,
`collector:railway`, `agent`, `console`, `import`), método (`manifest`, `env-example`, `workflow`, `config`,
`api`, `webhook`, `report`, `manual`), referência (`package.json#dependencies.stripe`), escopo, e quando foi
vista pela primeira e pela última vez. Uma evidência some (`GoneAt`) quando a fonte deixa de trazê-la.

### Escopo do código

Diz até onde o código chegou. Do mais fraco ao mais forte:

| Escopo | Significa |
|---|---|
| `local` | Só nesta máquina, ainda não enviado |
| `pushed` | No remoto (o HEAD está em um ramo remoto) |
| `deployed` | Implantado num ambiente (informado no sync com `environment`) |
| `runtime` | Visto pelo provedor (coletor) |
| `declared` | Afirmado por uma pessoa; cede a qualquer escopo medido |

O nó guarda o escopo mais forte já visto. Local nunca marca nada como sumido.

### Verificação

A verificação não é gravada. É calculada a cada leitura, a partir das datas de confirmação, da origem e das
evidências de código. Assim o Atlas nunca diz "verificado" depois que a prova sumiu. A janela de "verificado"
é de 48 h.

| Estado | Rótulo na interface | Quando |
|---|---|---|
| `verified` | verificado | Um coletor confirmou nas últimas 48 h |
| `stale` | verificação antiga | Um coletor confirmou, mas faz mais de 48 h |
| `found_in_code` | encontrado no código | Há evidência viva em repositório |
| `not_found` | não encontrado | Sumiu do provedor, foi relatado como removido, ou sumiu do código |
| `reported` | relatado por agente | Só um relatório de agente |
| `declared` | declarado | Só o cadastro |

Na interface, as palavras têm sentidos fixos:

- **não existe**: foi retirado (ver abaixo). Não aparece no mapa.
- **não encontrado**: estado `not_found`.
- **não verificado**: `declared`, `reported` ou `found_in_code`.
- **não está operacional**: estado operacional `down` (o monitor ou o último deploy dizem que está fora do ar).

## Nada é apagado sozinho

Omissão em relatório, em scan ou em listagem nunca remove um nó.

| Caso | O que acontece | Quem decide |
|---|---|---|
| Retirar | Soft delete. Sai do mapa e das leituras padrão; as ligações ativas dele saem no mesmo instante | Pessoa, no console (`DELETE /v1/staff/atlas/services/{id}`) |
| Restaurar | Volta o serviço e as ligações retiradas no mesmo instante | Pessoa (`POST .../services/{id}/restore`) |
| Renomear | O nome antigo vira alias; a busca por referência encontra os dois | Pessoa (`POST .../services/{id}/rename`); 409 se outro serviço do mesmo sistema e ambiente já usa o nome |
| Remoção relatada | Agente informou `removed`: marca `RemovalReportedAt` e espera confirmação | Pessoa: **Confirmar remoção** (retira) ou **Restaurar** |
| Não encontrado no provedor | Coletor com listagem completa não viu o recurso: `MissingSince` | Limpa sozinho se o recurso reaparecer; senão, pessoa |
| Sumido do código | Todas as evidências de repositório foram embora de um nó descoberto | Regra `gone-from-code` em Insights; pessoa retira |

Repositório, processo, etapa, rotina e ambiente são apagados de verdade, mas cada remoção fica no histórico.

## Atenção

Cada nó tem contadores por **classe**. Só a classe `failure` é vermelha.

| Classe | Conta |
|---|---|
| `failure` | Serviço fora do ar ou degradado; repositório cuja última execução falhou |
| `security` | Alertas abertos do repositório; tarefas ligadas com etiqueta `seguranca` ou `security` |
| `task` | Tarefas ligadas em `todo` ou `doing`, sem etiqueta de melhoria ou segurança; chamados ligados abertos |
| `improvement` | Tarefas ligadas com etiqueta `melhoria` ou `improvement`; nó planejado |
| `config` | Lacuna ou aviso declarado; tarefas ligadas bloqueadas |
| `unverified` | Verificação `not_found`, `stale` ou `reported` |

Tarefa arquivada ou `done` não conta.

### Ligar uma tarefa ou um chamado a um componente

Duas formas:

- **Referência.** No console (**Vincular tarefa**) ou com `POST /v1/staff/atlas/services/{id}/refs`, corpo
  `{ "kind": "task" | "ticket" | "error", "code": "T-7K2QM", "note": "..." }`. Remover: `DELETE /v1/staff/atlas/refs/{id}`.
- **Etiqueta.** Uma tarefa do quadro com a etiqueta `atlas:<chave-do-nó>` (por exemplo `acme:production:api`)
  fica ligada ao nó. Nada a gravar no Atlas.

A chave (`key`) do nó é `{sistema}:{ambiente}:{nome}` em minúsculas, e não muda ao renomear.

### Ferramentas do Atlas no MCP

| Ferramenta | Faz |
|---|---|
| `atlas_overview` | Resumo por sistema |
| `atlas_attention` | O que foi declarado como lacuna ou aviso, do maior impacto para o menor |
| `atlas_processes` | Processos e suas etapas |
| `atlas_graph` | O mapa de um sistema (ou de tudo), por motor, com estado, verificação e atenção |
| `atlas_node` | Detalhe de um nó: dependências, impacto, evidências, tarefas e eventos |
| `atlas_changes` | O que mudou, com quem e de onde veio |
| `atlas_insights` | Regras determinísticas (sem monitoramento, sem backup, repositório sem sincronia, etc.) |
| `atlas_sync` | Envia o estado do repositório atual e o relatório do agente (ver abaixo) |
| `register_system`, `register_service`, `link_services`, `register_repo`, `register_process`, `update_process_step`, `register_routine`, `list_routines` | Cadastro (ver Cadastro) |
| `start_activity`, `finish_activity`, `start_routine_run`, `finish_routine_run` | Atividade e execução de rotina |
| `list_errors` | Erros recentes do servidor (escopo `errors`) |

`register_service` aceita `kind` pelos tipos antigos. Os tipos novos e o campo `engine` entram pelo arquivo
de importação e pela API; o MCP ainda não os expõe.

## Atlas Agent Sync

O estado do repositório chega ao Atlas por três caminhos. Cada um cobre o que o outro perde.

| Camada | Quando | Quem roda | Fonte no Atlas |
|---|---|---|---|
| Ferramenta MCP `atlas_sync` | No fim do trabalho, com o resumo e os códigos de tarefa | O agente | `agent` |
| Hook `SessionEnd` do Claude Code, `notify` do Codex e hooks do git (`post-commit`, `pre-push`) | Rede de segurança, com `pitwall-atlas sync --if-changed` | O hook | `agent` e `git-hook` |
| Action `atlas-sync` no CI | Push na `main` (`scope: pushed`) e depois do deploy (`scope: deployed`) | O CI, sem agente | `ci` |

### Comandos

Pacote `pitwall-mcp` (npm). O binário é `pitwall-atlas`.

| Comando | Faz |
|---|---|
| `pitwall-atlas login --url <https://console> --token <pwt_...>` | Grava `~/.config/pitwall/atlas.json` (permissão 600 quando o sistema permite). Não imprime o token |
| `pitwall-atlas sync [opções]` | Envia o repositório atual |
| `pitwall-atlas state` | Mostra a última sincronização do repositório |
| `pitwall-atlas install-hooks [--claude] [--git] [--codex]` | Sem opções: `--claude` e `--git`. Não sobrescreve hook alheio |
| `pitwall-atlas print-ci` | Imprime um workflow de exemplo com a action |

Opções de `sync`: `--scope local|pushed|deployed` (padrão: `pushed` se a árvore está limpa e o HEAD está no
remoto; senão `local`), `--environment` (obrigatório com `deployed`), `--system`, `--source`, `--tool`,
`--summary` ou `--summary-file`, `--task T-XXXXX` (repetível), `--partial`, `--if-changed`, `--dry-run`,
`--quiet` e `--json`. Configuração: `PITWALL_URL` e `PITWALL_TOKEN` do ambiente, ou o arquivo do `login`.

`install-hooks --claude` mescla um hook `SessionEnd` em `.claude/settings.json` sem apagar o que existe.
`--git` cria `post-commit` e `pre-push`, ou acrescenta uma linha ao final de um hook que já existe.
`--codex` imprime o trecho de `notify` para `~/.codex/config.toml`; não edita arquivo global.

A action de CI está em `.github/actions/atlas-sync`. Entradas: `pitwall-url` (o endereço do console, não da
API), `token` (segredo, com escopo `atlas`), `scope` (padrão `pushed`), `environment`, `system` e `version`
(padrão `^0.4`).

### O que é enviado

Só uma lista branca de arquivos, profundidade até 4, sem pastas de build ou dependências (`node_modules`,
`.git`, `dist`, `bin`, `obj`, `.next`, `target` e similares):

- **Com conteúdo:** manifestos e configuração de build e deploy (`package.json`, `*.csproj`, `Dockerfile`,
  `docker-compose*.yml`, `.github/workflows/*.yml`, `wrangler.*`, `vercel.json`, `railway.*`, `prisma/schema.prisma`,
  `robots.txt`, entre outros).
- **Só presença:** lockfiles, `tsconfig.json`, `next.config.*`, `sitemap.xml`, `SECURITY.md`, `CODEOWNERS`, `*.sln`.
- **Transformados:** `.env.example` (e `sample`, `template`) vira só as linhas `NOME=`, sem valores nem comentários.
  `appsettings*.json` mantém a estrutura, e todo valor folha vira `""`.

Limites: 300 arquivos, 200 KB cada, 1 MB no total. O que passar disso fica de fora, e o pacote é marcado como
parcial: nada é dado como sumido.

**Nunca lido:** `.env`, `.env.*` (exceto os de exemplo), `*.pem`, `*.key`, `id_rsa*`, `*.pfx`, `*.p12`,
`credentials*.json` e `secrets.*`. O CLI nem abre esses arquivos; o servidor os rejeita se chegarem.

**Redação** (antes de enviar e de novo no servidor, nos textos do relatório também): chaves de AWS, Stripe,
Anthropic, GitHub, Slack e similares; tokens `pwt_`; JWT; blocos de chave privada; senhas em URL; atribuições
`password=`, `token:` e similares; e sequências longas de base64 ou hex depois de `=` ou `:`. A redação roda
antes do corte, então um segredo nunca aparece pela metade.

O relatório do agente tem limites: resumo de 4000 caracteres, listas de até 50 itens de 300, códigos `T-XXXXX`
e até 200 operações estruturadas.

### Idempotência e falhas

- A chave de idempotência padrão é o hash de repo, commit, escopo, pacote e relatório. Um reenvio com a mesma
  chave devolve o resultado guardado, com `replayed: true`.
- `--if-changed` guarda `{bundleHash, headSha, scope}` em `.git/pitwall-atlas.json`. Se nada mudou, sai sem rede.
- Com `--quiet` (modo dos hooks e do CI), erro de rede ou de servidor vira um aviso de uma linha em stderr e a
  saída é 0. O hook do git não bloqueia o commit nem o push.
- Se a sessão for interrompida à força, o hook de fim de sessão pode não rodar. Quem envia então é o próximo
  commit (hook git) ou o CI. Cada envio é uma foto completa do repositório, então o próximo corrige o anterior.

### Trecho para o `CLAUDE.md` (ou `AGENTS.md`) de cada repositório de produto

```md
## Atlas (Pitwall MCP)
- Ao começar a trabalhar: start_activity(system="<slug>", component="<serviço>", description="<uma frase>") e guarde o id.
- Antes de encerrar, chame atlas_sync com o resumo do que mudou e os códigos de tarefa.
- Ao terminar: finish_activity(id, status ok|failed, result="<o que mudou>").
```

## Descoberta pelo servidor

Sem o Claude Code ou o CI, o próprio servidor lê o repositório: **Integração → Escanear** no console, ou
`POST /v1/staff/atlas/repos/{id}/scan`. Ele busca a árvore do branch padrão pela API do GitHub e aplica as
mesmas regras do CLI. Precisa do GitHub conectado; sem isso a resposta é 409.

O resultado é um `SyncResponse` (`created`, `updated`, `gone`, `removalsReported`, `rejected`, `attention`).
O que o scan acha vira nó `discovered`, com evidência `repo:{nome}`.

Catálogo de detecção (dependências e variáveis de ambiente): Stripe, Mercado Pago, Asaas, Pagar.me, Resend,
SendGrid, Postmark, SMTP, Anthropic, OpenAI, Gemini, Postgres, MySQL, MongoDB, Redis, BullMQ, Hangfire, RabbitMQ,
S3, R2, Sentry, Pitwall, Google Analytics, PostHog, Clarity, Plausible, Search Console, Bing Webmaster, Clerk,
Supabase, Firebase e Twilio. Workflows viram nós `pipeline` (com o destino de deploy pelo texto do YAML), `wrangler`
viram `edge` e buckets, filas e bancos; variáveis com `KEY`, `SECRET`, `TOKEN` e similares viram nós `credential`,
sem valor.

## Assistente de integração

`/atlas/onboarding` guia a configuração em oito passos, com o passo atual na URL (`?step=`):

1. **Sistema:** escolher ou cadastrar.
2. **Repositórios:** associar ao sistema, com papel e serviços.
3. **Ambientes:** criar os que existem (produção, homologação).
4. **Fontes:** ver o estado de cada coletor e como conectar.
5. **Descoberta:** escanear cada repositório e mostrar o resultado.
6. **Validar:** confirmar o que foi descoberto (vira `declared`) ou retirar.
7. **Mapa e cobertura:** ver o mapa e o percentual de cobertura.
8. **Agentes:** comandos de `login`, `install-hooks --claude --git` e o trecho de CI.

## Cadastro e importação

Pelo console (**Cadastrar**), pelo MCP ou por um arquivo. Os três fazem a mesma gravação: cadastrar de novo
atualiza, não duplica.

| O quê | Identificado por | MCP |
|---|---|---|
| Sistema (o mesmo de **Sistemas**) | slug | `register_system` |
| Serviço | sistema + ambiente + nome | `register_service` |
| Serviço externo compartilhado | nome (sem sistema) | `register_service` |
| Ligação "este usa aquele" | origem + destino (+ relação) | `link_services` |
| Repositório | `dono/nome` | `register_repo` |
| Rotina | slug | `register_routine` |
| Processo (venda, suporte, funil de um produto) | slug | `register_process` |
| Etapa de um processo | processo + slug da etapa | `update_process_step` |

O ambiente é criado junto com o primeiro serviço que o cita.

### O que os coletores não veem

Os coletores dizem se um serviço está no ar. O resto é declarado no cadastro:

- **Serviço:** `group` (bloco em que aparece no sistema), `facts` (detalhes chave → valor), `items` (lista:
  redes, bancos, canais), `condition` (`ok`, `warn` funciona mal, `gap` falta, `planned`, `local` só numa
  máquina), `engine` e `signature` (o que é, pelo catálogo) e, para o que não está ok, `impact` (`high`, `medium`,
  `low`), `owner` (`auto`, `agent`, `person`, `together`) e `task` (código da tarefa que resolve).
- **Ligação:** `relation` (ver Relações) ou `kind` (tipo antigo, ainda aceito), e `planned` para a que ainda não existe.
- **Processo:** etapas em ordem, cada uma com situação (`ok`, `warn`, `gap`, `next`, `idea`), como é hoje, como
  deveria ser, o próximo passo, responsável, impacto, tarefa e os serviços envolvidos. Com `stages` (colunas, como
  oferta, atração, conversão), cada etapa cai num estágio e num sistema, e o processo vira uma matriz sistema ×
  estágio. Mandar `steps` substitui todas as etapas; `update_process_step` muda uma.

Tipos de serviço (`kind`): `site`, `web`, `app`, `api`, `worker`, `database`, `storage`, `domain`, `email`,
`monitor`, `backup`, `package`, `integration`, `analytics`, `external`, `other`, `pipeline`, `host`, `dns`, `cdn`,
`edge`, `queue`, `cache`, `agent`, `cron`, `webhook`, `payment`, `fiscal`, `seo`, `credential`, `vault` e
`certificate`.

As tools do Atlas pedem um token pessoal com o escopo `atlas`; o console cria tokens com `tasks` e `atlas`.
Tokens antigos têm só `tasks`: gere outro. Com o console atrás do Cloudflare Access, inclua `v1/staff/atlas` e
`v1/staff/atlas/*` na aplicação de bypass descrita em [tarefas-mcp.md](tarefas-mcp.md).

### Importar um arquivo

Para carregar um mapa pronto de uma vez. O arquivo é escolhido na hora e não fica no repositório.

- Console, só admin: **Cadastrar → Importar arquivo**. **Conferir** valida sem gravar; **Importar** grava.
- Linha de comando: `dotnet Pitwall.Api.dll import-atlas <arquivo.json> [--dry-run]`. No Docker, copie o
  arquivo para o contêiner antes: `docker compose -f docker-compose.prod.yml cp mapa.json api:/tmp/mapa.json`
  e `docker compose -f docker-compose.prod.yml exec api dotnet Pitwall.Api.dll import-atlas /tmp/mapa.json`.

Uma linha inválida recusa o arquivo inteiro e nada é gravado. Exemplo (dados fictícios):

```json
{
  "environments": [{ "slug": "staging", "name": "Staging" }, { "slug": "production", "name": "Produção" }],
  "shared": [{ "name": "CDN", "provider": "cdn", "url": "https://cdn.example.com", "kind": "cdn" }],
  "systems": [
    {
      "slug": "acme", "name": "Acme", "description": "Foguetes sob medida", "websiteUrl": "https://acme.example", "color": "#5eb0ff",
      "repos": ["acme-inc/rockets"],
      "services": [
        { "name": "API", "kind": "api", "engine": "app", "environment": "production", "provider": "railway", "externalRef": "acme/api",
          "url": "https://api.acme.example", "monitor": "Acme API", "uses": ["CDN", "acme/production/Banco"],
          "group": "Núcleo", "facts": { "Health": "/health", "Memória": "1 GB" },
          "links": [{ "to": "acme/App", "kind": "deploy", "relation": "deploys_to", "planned": true }] },
        { "name": "Banco", "kind": "database", "environment": "production", "provider": "railway", "externalRef": "acme/postgres" },
        { "name": "Site", "kind": "site", "environment": "production", "provider": "vercel", "externalRef": "acme-site" },
        { "name": "App", "kind": "app", "group": "Na loja", "condition": "gap", "impact": "high", "owner": "person",
          "task": "T-7K2QM", "notes": "Ainda não publicado." }
      ]
    }
  ],
  "processes": [
    { "slug": "funil", "name": "Funil", "stages": [{ "key": "oferta", "name": "Oferta" }, { "key": "receita", "name": "Receita" }],
      "steps": [
        { "slug": "acme-oferta", "name": "Planos", "system": "acme", "stage": "oferta", "status": "ok", "owner": "auto",
          "services": ["acme/production/API"] },
        { "slug": "acme-receita", "name": "Cobrança", "system": "acme", "stage": "receita", "status": "gap", "impact": "high",
          "today": "Manual.", "ideal": "Automática.", "next": "Ligar a cobrança recorrente." }
      ] }
  ],
  "routines": [
    { "slug": "saude", "name": "Saúde", "frequency": "daily", "system": null,
      "description": "Confere monitores e CI", "prompt": "Rode atlas_overview e crie uma tarefa para cada serviço fora do ar." }
  ]
}
```

`uses` e `links[].to` aceitam o nome de um serviço compartilhado, `sistema/Nome` ou `sistema/ambiente/Nome`.
`relation` diz o que a ligação significa; sem ela, vale `kind`, e sem os dois, `depends_on`. `engine` aceita um
dos nove motores (ver Motores); sem ele, o motor sai do tipo. `frequency`: `daily`, `weekly` ou `monthly`.

## Coletores e conectores

Os coletores leem provedores com tokens só de leitura, de hora em hora, e na hora com **Coletar agora**
(`POST /v1/staff/atlas/collect`). Cada token fica em variável de ambiente. Sem o token, o coletor aparece como
**não conectado** e não faz nada. Tudo o que ele acha e ninguém cadastrou vai para **Descoberta**.

| Coletor | Variáveis (`.env`) | Casa com o serviço ou repositório por | Grava |
|---|---|---|---|
| Railway | `ATLAS_RAILWAY_TOKEN`, `ATLAS_RAILWAY_WORKSPACE_ID` (opcional) | `provider` = `railway`, `externalRef` = `projeto/serviço`, e o ambiente pelo nome | verificação, estado e commit do último deploy, eventos de deploy, `MissingSince` |
| GitHub | `ATLAS_GITHUB_APP_ID`, `ATLAS_GITHUB_APP_PRIVATE_KEY`, `ATLAS_GITHUB_APP_INSTALLATION_ID` (recomendado) ou `ATLAS_GITHUB_TOKEN` | repositório cadastrado, pelo id do GitHub (`ExternalId`) e, sem id, pelo `dono/nome` | id, branch padrão, linguagens, PRs abertos, última execução do Actions, eventos de CI, alertas do Dependabot |
| Uptime Kuma | `ATLAS_KUMA_URL`, `ATLAS_KUMA_API_KEY` | `monitor` = nome do monitor | verificação e estado no ar ou fora, eventos `monitor.down` e `monitor.up`. Não marca `MissingSince` |
| Vercel | `ATLAS_VERCEL_TOKEN`, `ATLAS_VERCEL_TEAM_ID` (opcional) | `provider` = `vercel`, `externalRef` = nome do projeto | verificação, estado e commit do último deploy de produção, eventos de deploy, `MissingSince` |
| Cloudflare | `ATLAS_CLOUDFLARE_TOKEN`, `ATLAS_CLOUDFLARE_ACCOUNT_ID` | `provider` = `cloudflare` e `externalRef` = `zone:`, `worker:`, `pages:` ou `r2:` + nome; domínio ou site cujo host está numa zona | verificação, `MissingSince`, descoberta de zonas, Workers, Pages e buckets R2 sem cadastro |

O token do Cloudflare só precisa de leitura de zonas, registros DNS, Workers, Pages e R2 na conta.

Onde gerar cada token:

- **Railway:** painel → *Account Settings → Tokens*. Token de conta ou de workspace (com o de workspace,
  informe também `ATLAS_RAILWAY_WORKSPACE_ID`). O token de projeto não serve: usa outro cabeçalho.
- **GitHub App (recomendado):** ver a seção abaixo.
- **GitHub, token pessoal (alternativa):** *Settings → Developer settings → Fine-grained tokens*, só leitura em
  *Actions*, *Contents*, *Metadata* e *Dependabot alerts* dos repositórios. Sem a permissão de alertas, a
  contagem aparece como `?`.
- **Uptime Kuma:** *Settings → API Keys → Add API Key*. `ATLAS_KUMA_URL` é o endereço do Kuma como a API o
  alcança; a chave lê `/metrics`.
- **Vercel:** *Account Settings → Tokens*. Em time, informe `ATLAS_VERCEL_TEAM_ID`.
- **Cloudflare:** token de API com leitura nas permissões acima; o id da conta aparece no painel, na barra lateral.

No `docker-compose.prod.yml` cada variável vira uma chave `Atlas__...` (por exemplo `ATLAS_CLOUDFLARE_TOKEN`
vira `Atlas__Cloudflare__Token`). As variáveis de Cloudflare, do GitHub App e do webhook estão marcadas em
`.env.example`.

Um serviço com monitor fora do ar aparece **fora do ar** mesmo com o último deploy bom. Sem monitor, o estado
vem só do deploy.

### GitHub App

Recomendado: é só leitura e não depende de uma pessoa. Quando as três variáveis (`APP_ID`, `PRIVATE_KEY`,
`INSTALLATION_ID`) estão definidas, o App vence o token pessoal. A chave privada nunca é impressa.

Permissões mínimas, todas só de leitura: **Metadata**, **Contents**, **Actions**, **Pull requests** e
**Dependabot alerts**.

Eventos a assinar: `workflow_run`, `push`, `pull_request`, `deployment_status`, `release` e `repository`.

### Webhook do GitHub

`POST /v1/hooks/github` recebe os eventos em tempo quase real. A rota fica na **API pública**, não no console,
e não passa pelo Cloudflare Access: o GitHub chama direto. Configure no App ou no repositório:

- URL: `https://<api>/v1/hooks/github`, com *Content type* `application/json`.
- Segredo: o mesmo valor de `ATLAS_GITHUB_WEBHOOK_SECRET`. A assinatura (`X-Hub-Signature-256`) é conferida em
  tempo constante. Sem segredo configurado, a rota responde 404.
- Repositório que o Atlas não conhece: 202, sem gravar nada.
- Cada entrega é gravada uma vez (o `X-GitHub-Delivery` é a chave do evento), então reentregas não duplicam.

Efeitos: `workflow_run` atualiza a última execução do repositório e gera `ci.*`; `push` gera `push`;
`pull_request` gera `pr.opened`, `pr.merged` ou `pr.closed`; `deployment_status` gera `deploy.*`; `release`
gera `release.published`; `repository` (renomeação) atualiza o nome pelo id.

### O que acontece quando uma fonte falha

Cada fonte tem uma linha em `atlas_sources`: última execução, última execução bem-sucedida, último erro e
quantos itens viu. Uma falha **não apaga nada**: os dados da última leitura boa ficam, e a mensagem de erro
aparece na fonte. Uma fonte conectada sem sucesso há mais de 3 h fica `stale`. A hora da última leitura
aparece sempre, na fonte e nos nós que ela alimenta.

Um run só grava quando termina inteiro. Se o provedor cai no meio, a leitura anterior continua valendo.

### Tempo real

Com honestidade: o Atlas não é tempo real.

- O mapa e os eventos são consultados a cada **10 s** no console. Um evento do webhook aparece nessa janela.
- O resumo antigo (`/v1/staff/atlas`) é consultado a cada **5 s**.
- Os coletores rodam **de hora em hora**. Um deploy que só o coletor vê aparece em até uma hora, ou na hora
  com **Coletar agora**. Com o webhook configurado, o GitHub chega antes.

## Atividade

Para a faixa **Agora** mostrar quem está mexendo em quê, a sessão do agente chama `start_activity` ao começar
e `finish_activity` ao terminar (trecho no `CLAUDE.md`, na seção do Agent Sync). `start_activity` envia junto o
repositório, a branch, o commit e a ferramenta que ele detectar.

Se `component` for o nome de um serviço cadastrado do sistema, ele pulsa no mapa. Atividade aberta há mais de
12 h sai da faixa sozinha; execução de rotina, depois de 6 h.

## Histórico e versões

- **Mudanças** (`atlas_changes`): o que foi criado, alterado, retirado, restaurado, renomeado ou apagado, com
  quem (`Actor`), de onde (`console`, `mcp`, `import`, `collector`, `sync`, `system`) e os campos antes e depois.
  Não entram campos de observação (estado de monitor, último deploy, commit, horários de verificação, contagens do
  GitHub), para o histórico não virar ruído a cada coleta. Leitura: `GET /v1/staff/atlas/changes`.
- **Changesets** (`atlas_changesets`): cada envio do sync, com repositório, branch, commit, escopo, ambiente,
  tarefas citadas e o resultado (criados, atualizados, sumidos, remoções relatadas, rejeitados). Um reenvio igual
  não cria outro. Leitura: `GET /v1/staff/atlas/changesets`.
- **Snapshots** (`atlas_snapshots`): foto estrutural do grafo (nós e arestas, sem campos de observação), com hash
  sha256. Tirada a cada 6 h se o hash mudou, e depois de um sync (no máximo uma a cada 10 min por esse caminho).
  Leitura: `GET /v1/staff/atlas/snapshots`.
- **Diff** (`GET /v1/staff/atlas/diff?from=&to=&system=`): compara duas datas, dois snapshots, ou uma data com
  `now` (o grafo atual). Mostra adicionados, alterados e removidos. No console, o painel **Evolução** usa 24 h,
  7 dias, 30 dias ou uma data.

## Segurança

- **O Atlas não é cofre.** Credenciais aparecem só pelo nome (um nó `credential` com o nome da variável, e o valor
  registrado como "nunca guardado no Atlas"). Nenhuma credencial é ligada a um cofre sozinha; o Insight
  `credential-no-vault` sugere a ligação.
- **Redação** no CLI e no servidor (ver O que é enviado). Os arquivos proibidos nunca são lidos.
- **Conteúdo é dado, não instrução.** Código de repositório, relatório de agente e textos de evento são guardados
  e mostrados como texto. Nada do que vem neles dispara ação: o reconciliador só cria ou altera campos estruturados.
- **Escopos de token.** `atlas` alcança `/v1/staff/atlas/*`, inclusive `/sync`, `/sync/state` e o scan. A
  importação de arquivo é só de admin no console. Token de `tasks` não entra no Atlas.
- **Webhook.** Assinatura HMAC-SHA256 obrigatória, rota anônima com limite de taxa (`ingest`), sem segredo a rota
  não existe.
- **Coletores.** Tokens só de leitura, em variável de ambiente. A mensagem de erro traz o status HTTP, nunca o token.
- **Retenção.** Eventos (`atlas_events`) são apagados após 90 dias. Mudanças, changesets e snapshots não expiram.

## Rotinas

Uma rotina tem nome, sistema (ou a operação inteira), frequência, descrição e a **instrução** que o agente
recebe. Cadastre em **Rotinas** ou com `register_routine`. A tela mostra a última execução, o resultado e o que
foi gerado (PR, tarefa, alerta); **Histórico** traz as 30 últimas.

### Executor

`deploy/rotinas/executar-rotinas.sh` roda as rotinas ligadas de uma frequência, uma por vez, cada uma
como uma sessão do Claude Code sem interface (`claude -p`) com o MCP do Pitwall. O script não conhece
nenhuma rotina: busca a lista no Pitwall e entrega a instrução de cada uma. Ele abre a execução, passa o
id ao agente (que a fecha com `finish_routine_run` e os links do que gerou) e fecha ele mesmo se o
agente não fechar, inclusive no tempo limite.

Precisa de `curl`, `jq`, `flock`, Node 20+ e o Claude Code no servidor.

1. Copie `deploy/rotinas/rotinas.env.example` para `rotinas.env` na mesma pasta, com `chmod 600`.
2. `PITWALL_TOKEN`: um token pessoal (**Conta e equipe → Tokens pessoais**) de quem as rotinas representam.
3. `CLAUDE_CODE_OAUTH_TOKEN`: rode `claude setup-token` uma vez, em qualquer máquina, e cole o resultado.
4. `ROUTINE_CLAUDE_ARGS` define o que o agente faz sem perguntar. O padrão lê arquivos e usa o MCP.
   Rotina que abre PR precisa também de `git` e `gh` autenticado; o exemplo está no arquivo.
5. Agende no cron do usuário que roda as rotinas:

```cron
15 6 * * *  /opt/pitwall/deploy/rotinas/executar-rotinas.sh daily   >> /var/log/pitwall-rotinas.log 2>&1
30 7 * * 1  /opt/pitwall/deploy/rotinas/executar-rotinas.sh weekly  >> /var/log/pitwall-rotinas.log 2>&1
45 7 1 * *  /opt/pitwall/deploy/rotinas/executar-rotinas.sh monthly >> /var/log/pitwall-rotinas.log 2>&1
```

Duas chamadas ao mesmo tempo não se sobrepõem: a segunda sai sem fazer nada.
