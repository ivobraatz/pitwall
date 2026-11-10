# Atlas

O **Atlas** (`/atlas` no console) mostra a operação viva: o que está no ar, o que está rodando agora e
qual sistema pede atenção. Uma instalação nova abre o Atlas vazio. Os sistemas, serviços e rotinas de
cada instalação ficam só no banco dela, nunca no código.

| Vista | O que mostra |
|---|---|
| Geral | Uma faixa por sistema: saúde, pendências (tarefas, chamados, erros em 24 h, alertas de segurança) e o que roda agora. O que está fora do ar vem primeiro. Clicar abre o sistema. |
| Pede atenção | O que foi declarado como lacuna ou aviso, em serviços e etapas de processo, agrupado por impacto (alto, médio, baixo, sem impacto), com sistema, onde, próximo passo, responsável e a tarefa (link para o quadro). |
| Processos | Cada processo como uma linha de etapas coloridas pela situação; com estágios, uma matriz sistema × estágio com célula vazia hachurada. Clicar na etapa abre o hoje, o ideal, o próximo passo, responsável, impacto, tarefa e serviços. Filtro por sistema. |
| Fornecedores | Grade fornecedor (campo `provider` do serviço) × sistema, com a contagem e os nomes dos serviços; os compartilhados ficam numa coluna própria. |
| Motor | Grade de sistema por ambiente, com os serviços de cada célula: estado, último deploy e commit no ar. Ambiente que não existe aparece hachurado; serviço que falta (`gap`) também, planejado fica tracejado, e os serviços se agrupam pelo `group`. Clicar num serviço abre seus detalhes, itens e ligações. Abaixo, a esteira (última execução de cada repositório), os serviços externos e os coletores. |
| Mapa | O grafo. De longe, um nó por sistema; perto, os serviços e as ligações. O nó em que algo acontece pulsa; a ligação só se move quando há trabalho passando. A cor da ligação diz o tipo (legenda acima do mapa), a planejada é tracejada e o serviço que falta, hachurado. |
| Fluxos | Por sistema, da esquerda para a direita, com o número de cada etapa: código (commit → CI → deploy → produção), erros (erro → chamado → tarefa → correção) e conteúdo (novidade → rascunho → aprovação → rede social). Etapa sem dado ou sem processo aparece como lacuna. |
| Rotinas | O que roda sozinho, por frequência, com a última execução, o resultado e o que ela gerou. |
| Descoberta | O que os coletores acharam nos provedores e ninguém cadastrou, com botão para cadastrar ou ignorar. |

A faixa **Agora** fica fixa no topo: serviço fora do ar, deploy em andamento, sessão de agente e
rotina rodando. A tela se atualiza a cada 5 s e existe em português e inglês (botão PT/EN).

O estado aparece por cor e por forma: quadrado cheio (no ar), xis (fora do ar), quadrado vazado
(em deploy), triângulo (com problema), quadrado tracejado (sem leitura).

## Cadastro

Pelo console (**Cadastrar**), pelo MCP ou por um arquivo. Os três fazem a mesma gravação: cadastrar de
novo atualiza, não duplica.

| O quê | Identificado por | MCP |
|---|---|---|
| Sistema (o mesmo de **Sistemas**) | slug | `register_system` |
| Serviço | sistema + ambiente + nome | `register_service` |
| Serviço externo compartilhado | nome (sem sistema) | `register_service` |
| Ligação "este usa aquele" | origem + destino | `link_services` |
| Repositório | `dono/nome` | `register_repo` |
| Rotina | slug | `register_routine` |
| Processo (venda, suporte, funil de um produto) | slug | `register_process` |
| Etapa de um processo | processo + slug da etapa | `update_process_step` |

Para ler: `atlas_overview`, `atlas_processes` e `atlas_attention` (tudo que foi declarado como lacuna ou
aviso, do maior impacto para o menor).

### O que os coletores não veem

Os coletores dizem se um serviço está no ar. O resto é declarado no cadastro:

- **Serviço:** `group` (bloco em que aparece no sistema), `facts` (detalhes chave → valor), `items` (lista:
  redes, bancos, canais), `condition` (`ok`, `warn` funciona mal, `gap` falta, `planned`, `local` só numa
  máquina) e, para o que não está ok, `impact` (`high`, `medium`, `low`), `owner` (`auto`, `agent`,
  `person`, `together`) e `task` (código da tarefa que resolve).
- **Ligação:** `kind` (`host`, `dns`, `storage`, `payment`, `email`, `ai`, `login`, `measure`, `monitor`,
  `support`, `deploy`, `integration`, `business`) e `planned` para a que ainda não existe.
- **Processo:** etapas em ordem, cada uma com situação (`ok`, `warn`, `gap`, `next`, `idea`), como é hoje,
  como deveria ser, o próximo passo, responsável, impacto, tarefa e os serviços envolvidos. Com `stages`
  (colunas, como oferta, atração, conversão), cada etapa cai num estágio e num sistema, e o processo vira
  uma matriz sistema × estágio. Mandar `steps` substitui todas as etapas; `update_process_step` muda uma.

O ambiente é criado junto com o primeiro serviço que o cita. As tools do Atlas pedem um token pessoal
com o escopo `atlas`; o console cria tokens com `tasks` e `atlas`. Tokens antigos têm só `tasks`: gere
outro. Com o console atrás do Cloudflare Access, inclua `v1/staff/atlas` e `v1/staff/atlas/*` na
aplicação de bypass descrita em [tarefas-mcp.md](tarefas-mcp.md).

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
  "shared": [{ "name": "CDN", "provider": "cdn", "url": "https://cdn.example.com" }],
  "systems": [
    {
      "slug": "acme", "name": "Acme", "description": "Foguetes sob medida", "websiteUrl": "https://acme.example", "color": "#5eb0ff",
      "repos": ["acme-inc/rockets"],
      "services": [
        { "name": "API", "kind": "api", "environment": "production", "provider": "railway", "externalRef": "acme/api",
          "url": "https://api.acme.example", "monitor": "Acme API", "uses": ["CDN", "acme/production/Banco"],
          "group": "Núcleo", "facts": { "Health": "/health", "Memória": "1 GB" },
          "links": [{ "to": "acme/App", "kind": "deploy", "planned": true }] },
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

`kind` do serviço: `site`, `web`, `app`, `api`, `worker`, `database`, `storage`, `domain`, `email`, `monitor`,
`backup`, `package`, `integration`, `analytics`, `external` ou `other`. `uses` e `links[].to` aceitam o nome
de um serviço compartilhado, `sistema/Nome` ou `sistema/ambiente/Nome`; `links` diz também o tipo da
ligação. `frequency`: `daily`, `weekly` ou `monthly`.

## Coletores

A API lê cada provedor de hora em hora, e na hora com **Coletar agora**. Cada coletor usa um token só de
leitura, em variável de ambiente; sem o token ele aparece como **não conectado** e não faz nada. O que
ele acha e ninguém cadastrou vai para **Descoberta**.

| Coletor | Variáveis (`.env` do compose) | Casa com o serviço por | Grava |
|---|---|---|---|
| Railway | `ATLAS_RAILWAY_TOKEN`, `ATLAS_RAILWAY_WORKSPACE_ID` (opcional) | `provider` = `railway`, `externalRef` = `projeto/serviço`, e o slug do ambiente igual ao nome do ambiente na Railway | estado do último deploy, data e commit |
| GitHub | `ATLAS_GITHUB_TOKEN` | repositório cadastrado (`dono/nome`) | última execução do Actions, commits e execuções em 7 dias, alertas abertos do Dependabot |
| Uptime Kuma | `ATLAS_KUMA_URL`, `ATLAS_KUMA_API_KEY` | `monitor` = nome do monitor | no ar, fora do ar, pendente ou manutenção |
| Vercel | `ATLAS_VERCEL_TOKEN`, `ATLAS_VERCEL_TEAM_ID` (opcional) | `provider` = `vercel`, `externalRef` = nome do projeto | estado do último deploy de produção, data e commit |

Onde gerar cada token:

- **Railway:** painel → *Account Settings → Tokens*. Token de conta ou de workspace (com o de workspace,
  informe também `ATLAS_RAILWAY_WORKSPACE_ID`). O token de projeto não serve: usa outro cabeçalho.
- **GitHub:** *Settings → Developer settings → Fine-grained tokens*, só leitura em *Actions*, *Contents*,
  *Metadata* e *Dependabot alerts* dos repositórios. Sem a permissão de alertas, a contagem aparece como `?`.
- **Uptime Kuma:** *Settings → API Keys → Add API Key*. `ATLAS_KUMA_URL` é o endereço do Kuma como a API o
  alcança; a chave lê `/metrics`.
- **Vercel:** *Account Settings → Tokens*. Em time, informe `ATLAS_VERCEL_TEAM_ID`.

Um serviço com monitor fora do ar aparece **fora do ar** mesmo com o último deploy bom. Sem monitor, o
estado vem só do deploy.

## Atividade

Para a faixa **Agora** mostrar quem está mexendo em quê, toda sessão do Claude Code chama
`start_activity` ao começar e `finish_activity` ao terminar. Trecho para o `CLAUDE.md` de cada repositório:

```md
## Atlas (Pitwall MCP)
- Ao começar a trabalhar: start_activity(system="<slug>", component="<serviço>", description="<uma frase>") e guarde o id.
- Ao terminar: finish_activity(id, status ok|failed, result="<o que mudou>").
```

Se `component` for o nome de um serviço cadastrado do sistema, ele pulsa no mapa. Atividade aberta há
mais de 12 h sai da faixa sozinha; execução de rotina, depois de 6 h.

## Rotinas

Uma rotina tem nome, sistema (ou a operação inteira), frequência, descrição e a **instrução** que o
agente recebe. Cadastre em **Rotinas** ou com `register_routine`. A tela mostra a última execução, o
resultado e o que foi gerado (PR, tarefa, alerta); **Histórico** traz as 30 últimas.

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
