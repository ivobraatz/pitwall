# Tarefas da equipe pelo MCP

O console tem um quadro de **Tarefas** para o trabalho manual da equipe: configurar um painel
externo, testar num aparelho, obter uma credencial. Ele fica separado dos chamados de cliente. O
Claude Code registra e confere essas tarefas pelo servidor MCP do Pitwall (`pitwall-mcp`), usando
um token pessoal de quem está na sessão.


## 1. Criar o token

1. No console da sua instalação, abra **Conta e equipe → Tokens pessoais**.
2. Dê um nome que diga onde ele vai ser usado ("Claude Code no notebook") e escolha a validade:
   90 dias por padrão, ou 30 dias, 1 ano ou sem expiração.
3. Clique em **Novo token**. O `pwt_…` aparece **uma vez**, junto com o comando `claude mcp add`
   já preenchido com o endereço do console. Copie.

Qualquer pessoa da equipe (atendente ou admin) cria os próprios tokens, até 10 ativos. O token vale só para `/v1/staff/tasks/*`: não lê chamados,
nem a equipe, e não cria outros tokens. Com o escopo `atlas` (o console já inclui), alcança também `/v1/staff/atlas/*`: veja [atlas.md](atlas.md). Com o escopo `errors` (opcional, marcado ao criar o token), lê os erros do servidor agrupados em `/v1/staff/errors/recent` (tool `list_errors`) e nada além disso.

## 2. Conectar o Claude Code

```sh
claude mcp add pitwall --scope user \
  --env PITWALL_URL=https://<seu-dominio> \
  --env PITWALL_TOKEN=pwt_xxxxxxxxxxxx \
  -- npx -y pitwall-mcp
```

`PITWALL_URL` é o endereço do **console**, o mesmo que você abre no navegador. O MCP fala com o
proxy do console, que repassa o cabeçalho `Authorization` para a API.

Enquanto o pacote não estiver publicado no npm, use o build do repositório:

```sh
corepack pnpm --filter pitwall-mcp build
claude mcp add pitwall --scope user \
  --env PITWALL_URL=https://<seu-dominio> \
  --env PITWALL_TOKEN=pwt_xxxxxxxxxxxx \
  -- node <caminho-do-repo>/packages/mcp/dist/index.js
```

Em desenvolvimento, `PITWALL_URL=http://localhost:3200`.

## 3. Testar

- No Claude Code, `/mcp` mostra `pitwall` conectado, com as tools de tarefas e do Atlas.
- Peça "mostre o board_summary". A resposta traz a contagem por coluna.
- Sem o Claude, use o inspetor:

  ```sh
  PITWALL_URL=https://<seu-dominio> PITWALL_TOKEN=pwt_… \
    npx @modelcontextprotocol/inspector node packages/mcp/dist/index.js
  ```

## 4. Revogar

Em **Conta e equipe → Tokens pessoais**, clique em **Revogar** e confirme. A próxima chamada do
MCP já responde que o token é inválido. Se a pessoa for desativada na equipe, os tokens dela param
de valer em até 1 minuto.

## 5. Trecho para o `CLAUDE.md` de cada sistema

Copie no `CLAUDE.md` do repositório de cada sistema e troque o slug (veja os slugs com a tool
`list_products` ou em **Sistemas** no console):

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

## 6. O quadro no console

- **Colunas:** A fazer, Fazendo, Bloqueado e Concluído. Arraste dentro da coluna e entre colunas.
  Soltar em Bloqueado pede a nota: o erro que você viu, que é o que o Claude lê para conferir.
- **Atalhos:** `N` cria em "A fazer", `/` busca, `Esc` fecha, `?` mostra a lista. Com teclado:
  Tab até o cartão, Espaço pega, setas movem (esquerda e direita trocam de coluna), Espaço solta,
  Enter abre.
- **Atualização:** o quadro busca o que mudou a cada 12 s com a aba visível, e ao voltar para a aba.
- **Filtros** ficam na URL (`/tasks?product=demo&claude=1`), e o cartão aberto também
  (`?task=T-7K2QM`), então dá para mandar o link.
- **Arquivar concluídas** tira do quadro as tarefas em Concluído. Elas continuam na busca
  (`list_tasks` com `includeArchived`).

## Problemas comuns

| Sintoma | Causa e saída |
|---|---|
| "Token inválido, expirado ou revogado." | Token revogado, vencido ou de pessoa desativada. Gere outro. |
| "Não consegui falar com …" | `PITWALL_URL` errada, sem `https://`, ou console fora do ar. |
| "Tarefa ou produto não encontrado." em toda tool | `PITWALL_URL` aponta para o hostname público da **API**. Com `Pitwall:StaffHosts`, ele devolve 404 para `/v1/staff`. Use o endereço do console. |
| "A resposta de … não é do Pitwall." | A URL abre outro site, ou há uma tela de login na frente do console (Cloudflare Access, Tailscale Funnel com autenticação, proxy com senha). O MCP não passa por login de navegador. Com Cloudflare Access, veja a seção abaixo. |
| "O token não tem o escopo tasks." | Token criado direto no banco sem escopo. Crie pelo console. |
| "Limite de requisições." | 120 escritas por minuto por pessoa (console e tokens somados). Espere um minuto. |
| `/mcp` mostra `pitwall` com erro | Rode o comando do `claude mcp add` à mão para ver o erro no stderr. O token nunca aparece nesse log. |

## Console atrás do Cloudflare Access

O Access pede login de navegador (e-mail e código), e o MCP não tem navegador. A saída é uma
**segunda aplicação** do Access, só para o caminho das tarefas, com a ação **Bypass**. O Access
sempre aplica a aplicação de caminho mais específico, então o resto do console continua atrás do
login. As rotas liberadas continuam exigindo o token `pwt_…` (ou a sessão do console); sem ele, a
API responde 401.

O MCP não envia cabeçalhos de *service token* do Access (`CF-Access-Client-Id`), então a política
**Service Auth** não serve aqui.

1. Abra https://one.dash.cloudflare.com → **Access** → **Applications** → **Add an application** →
   **Self-hosted**.
2. *Application name*: `Pitwall MCP (tarefas)`.
3. **Add public hostname** duas vezes, no mesmo subdomínio e domínio do console:
   - *Subdomain* `pitwall`, *Domain* `<seu-dominio>`, *Path* `v1/staff/tasks`;
   - *Subdomain* `pitwall`, *Domain* `<seu-dominio>`, *Path* `v1/staff/tasks/*`.
4. Em **Policies** → **Add a policy**: *Policy name* `MCP com token`; *Action* **Bypass**;
   *Include* → *Selector* **Everyone**.
   Para as tools do Atlas, acrescente do mesmo jeito os caminhos `v1/staff/atlas` e `v1/staff/atlas/*`; para `list_errors`, `v1/staff/errors/recent`.
   `v1/staff/atlas/*` já cobre `/v1/staff/atlas/sync` e `/sync/state`, usados pela tool `atlas_sync`, pelo `pitwall-atlas` e pela action de CI.
   O webhook do GitHub (`v1/hooks/github`) não passa pelo console: chega à API pública, com assinatura própria, e não precisa de bypass.
5. Salve (**Save application**). Não mexa na aplicação `Pitwall console`.

Confira num terminal (sem cookie, sem token):

```sh
curl -i https://pitwall.<seu-dominio>/v1/staff/tasks/board   # esperado: 401 com {"message":"Sign in to the console."}
curl -i https://pitwall.<seu-dominio>/v1/staff/tickets       # esperado: 302 para a tela de login do Access
```

O primeiro mostra que o Access deixou passar e o Pitwall barrou. O segundo mostra que o resto
continua protegido. Também numa janela anônima, `https://pitwall.<seu-dominio>` ainda deve pedir o
e-mail do Access.
