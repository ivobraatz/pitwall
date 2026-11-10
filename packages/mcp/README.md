# pitwall-mcp

Servidor MCP do [Pitwall](https://github.com/ivobraatz/pitwall): o quadro de tarefas da equipe e o Atlas.
Numa sessão do Claude Code, o Claude registra as tarefas manuais que sobraram, como "configurar o
webhook no painel" ou "testar o login no celular". Na sessão seguinte, ele lê o que a equipe
moveu ou bloqueou, confere e comenta.

O servidor fala com o **console** da sua instalação, a mesma URL que você abre no navegador,
usando um token pessoal. O token só alcança `/v1/staff/tasks/*` (escopo `tasks`) e `/v1/staff/atlas/*`
(escopo `atlas`): não lê chamados nem a equipe.

## Instalar

1. No console da sua instalação, abra **Configurações → Tokens pessoais → Novo token** e copie o
   `pwt_…`. Ele aparece uma vez só.
2. No terminal:

   ```sh
   claude mcp add pitwall --scope user \
     --env PITWALL_URL=https://<seu-dominio> \
     --env PITWALL_TOKEN=pwt_xxxxxxxxxxxx \
     -- npx -y pitwall-mcp
   ```

   Para usar o build local do repositório (antes de publicar no npm):

   ```sh
   corepack pnpm --filter pitwall-mcp build
   claude mcp add pitwall --scope user \
     --env PITWALL_URL=https://<seu-dominio> \
     --env PITWALL_TOKEN=pwt_xxxxxxxxxxxx \
     -- node <caminho-do-repo>/packages/mcp/dist/index.js
   ```

3. Teste: dentro do Claude Code, `/mcp` mostra `pitwall` conectado. Peça "mostre o
   board_summary". Sem o Claude, use o inspetor:

   ```sh
   PITWALL_URL=https://<seu-dominio> PITWALL_TOKEN=pwt_… \
     npx @modelcontextprotocol/inspector node packages/mcp/dist/index.js
   ```

Para revogar, use a mesma tela de Configurações. A chamada seguinte já responde que o token é
inválido.

## Variáveis

| Variável | O que é |
|---|---|
| `PITWALL_URL` | Endereço público do console da instalação, como `https://<seu-dominio>`. A barra final é removida. |
| `PITWALL_TOKEN` | Token pessoal `pwt_…`, de Configurações → Tokens pessoais. |

Se faltar uma das duas, o servidor sobe assim mesmo e toda tool responde com a instrução de
configuração. Os logs vão para stderr, porque o stdout é do protocolo. O token nunca aparece em
log, em mensagem de erro nem em resultado de tool.

## Tools

| Tool | Para quê |
|---|---|
| `list_products` | Sistemas (slug e nome). O slug vai no campo `product` das outras tools. |
| `list_tasks` | Busca por status, sistema, texto, etiqueta ou `updatedSince`. Use antes de criar, para não duplicar. |
| `get_task` | A tarefa inteira: corpo, checklist com ids, links, nota de bloqueio, comentários e histórico. |
| `create_task` | Registra uma tarefa manual: título, corpo em markdown, sistema, prioridade, etiquetas, prazo, checklist e links. |
| `update_task` | Edita campos. `checklistToggle` marca itens sem reescrever a checklist. Não muda o status. |
| `move_task` | Muda de coluna (vai para o topo). `blocked` exige `blockedNote`. |
| `comment_task` | Registra o que foi verificado, o resultado e o próximo passo. |
| `board_summary` | Contagem por coluna, atrasadas, e as tarefas em `blocked` e `doing`. Para o começo da sessão. |

Atlas (escopo `atlas`):

| Tool | Para quê |
|---|---|
| `atlas_overview` | Saúde e pendências de cada sistema, o que roda agora e o que foi achado sem cadastro. |
| `register_system`, `register_service`, `register_repo`, `link_services` | Cadastram ou atualizam o mapa, com detalhes, lacunas e o tipo de cada ligação. Repetir não duplica. |
| `register_process`, `update_process_step`, `atlas_processes` | Processos etapa por etapa: como é hoje, como deveria ser, o próximo passo. |
| `atlas_attention` | O que foi declarado como lacuna ou aviso, do maior impacto para o menor. |
| `register_routine`, `list_routines` | Rotinas: o que roda sozinho, com a instrução do agente. |
| `start_activity`, `finish_activity` | Avisam o que a sessão está fazendo, para a faixa "Agora". |
| `start_routine_run`, `finish_routine_run` | Registram a execução de uma rotina e o que ela gerou. |

Cada tool devolve primeiro um texto curto, como
`T-7K2QM [blocked] Configurar callback (demo) — nota: …`, e depois o JSON completo num segundo bloco.

## Erros comuns

| Resposta | Causa |
|---|---|
| "Token inválido, expirado ou revogado." | O token foi revogado, expirou ou a pessoa foi desativada. Gere outro. |
| "Não consegui falar com …" | `PITWALL_URL` errada ou console fora do ar. |
| "Tarefa ou produto não encontrado." em tudo | `PITWALL_URL` aponta para o host público da API, que esconde as rotas da equipe. Use a URL do console. |
| "A resposta de … não é do Pitwall." | A URL abre outro site, ou uma tela de login de um proxy na frente do console. |

Guias: [`tarefas-mcp.md`](https://github.com/ivobraatz/pitwall/blob/main/docs/operacao/tarefas-mcp.md) e [`atlas.md`](https://github.com/ivobraatz/pitwall/blob/main/docs/operacao/atlas.md).

## Desenvolvimento

```sh
corepack pnpm --filter pitwall-mcp build
corepack pnpm --filter pitwall-mcp test
```

Publicar: suba `version` no `package.json`, commite e envie a tag `mcp-v<versão>`. O workflow
`mcp-release.yml` testa e publica no npm.

Licença MIT.
