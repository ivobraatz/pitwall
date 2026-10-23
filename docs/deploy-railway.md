# Deploy do Pitwall no Railway

Este guia põe o Pitwall em produção no Railway: um projeto com três serviços (Postgres, `api` e
`console`), dois domínios e o console atrás de um portão de acesso. Para um servidor próprio, veja
[deploy-vps.md](deploy-vps.md).

> **Antes de começar:** o Railway marca os arquivos `railway.json` como *Config as Code*, que está
> depreciado (eles deixam de ser lidos em 2026-12-01, e serviços novos não podem usá-los). Por isso,
> as configurações abaixo devem ser feitas **no painel**, que é a fonte de verdade. Os dois arquivos
> `apps/api/railway.json` e `apps/console/railway.json` repetem esses mesmos valores; se o Railway
> ainda os ler para o seu serviço, eles só confirmam o que você configurou. Migrar para
> *Infrastructure as Code* (`.railway/railway.ts`) é um passo futuro, não necessário agora.

---

## 1. Arquitetura em produção

Há **dois hostnames**, com públicos diferentes:

| Hostname | Serve | Quem usa | Acesso |
|---|---|---|---|
| `api.<domínio>` | a API (`apps/api`) | os backends dos sistemas (DataRunner, RH Flex, metrifree), com a chave do produto, e o job de release notes do CI | público. O navegador do cliente nunca fala com ele |
| `pitwall.<domínio>` | o console (`apps/console`) | a equipe de suporte | **atrás de Cloudflare Access** |

Por que dois:

- O console tem um proxy `/v1/**` que encaminha tudo para a API, incluindo `/v1/staff/**` (a
  superfície da equipe). Se o console ficar aberto, a superfície da equipe fica aberta.
- Os sistemas precisam chegar à API. Se eles passarem pelo hostname do console, dependem de uma
  porta que é só da equipe. Por isso o `api.<domínio>` é separado e não recebe nada de navegador.

A própria API fecha `/v1/staff/**` no hostname público: com `Pitwall__StaffHosts=api.railway.internal`
(seção 3), essas rotas só respondem quando chamadas pelo endereço privado, que é o que o console usa.
Por `api.<domínio>` elas dão 404.

---

## 2. Criar o projeto e os serviços

1. No Railway, **New Project → Empty Project**. Dê o nome `pitwall`.
2. **New → Database → PostgreSQL**. Deixe o nome do serviço como `Postgres` (os exemplos abaixo
   usam esse nome nas referências `${{Postgres.…}}`; se mudar, troque também nas referências).
3. **New → GitHub Repo** → escolha o repositório do Pitwall. Este serviço é o **`api`**:
   - *Settings → Source → Root Directory*: `/` (a raiz do repositório; o Dockerfile precisa do
     contexto inteiro).
   - *Settings → Build → Builder*: `Dockerfile`; *Dockerfile Path*: `apps/api/Dockerfile`.
   - *Settings → Config file path* (se aparecer): `apps/api/railway.json`.
   - *Settings → Deploy → Healthcheck Path*: `/health`; *Healthcheck Timeout*: `120`.
   - *Settings → Deploy → Restart Policy*: `On Failure`, máximo `10`.
   - *Settings → Networking*: gere um domínio Railway provisório e **defina a porta de destino como
     `8080`** (a API escuta em `ASPNETCORE_URLS=http://+:8080`, definido no Dockerfile).
   - *Settings → Deploy → Replicas*: deixe **1**. As migrações rodam no boot da API; duas réplicas
     subindo ao mesmo tempo disputariam a mesma migração.
4. **New → GitHub Repo** (mesmo repositório) → este é o **`console`**:
   - *Root Directory*: `/`.
   - *Dockerfile Path*: `apps/console/Dockerfile`; *Config file path*: `apps/console/railway.json`.
   - *Healthcheck Path*: `/login`; *Healthcheck Timeout*: `120`; *Restart Policy*: `On Failure`, `10`.
   - *Networking*: porta de destino `3200`.

---

## 3. Variáveis do `api`

Em **api → Variables**, cadastre as variáveis abaixo. O formato `__` (dois sublinhados) vira `:` na
configuração do .NET, então `Pitwall__SecretKey` é `Pitwall:SecretKey`.

**Gere os segredos antes**, num terminal local, e guarde-os no gerenciador de senhas no momento:

```bash
openssl rand -base64 32    # um para Pitwall__SecretKey
openssl rand -base64 24    # uma senha forte para o Postgres, se você for definir uma própria
```

| Variável | Valor | Obrigatória | Observação |
|---|---|---|---|
| `PORT` | `8080` | sim | o Railway injeta `PORT`; a API precisa receber o tráfego na 8080 |
| `ConnectionStrings__Pitwall` | ver abaixo | sim | string do Postgres do próprio Railway |
| `Pitwall__SecretKey` | `openssl rand -base64 32` | sim | **nunca troque nem perca**: sela segredos de webhook e semente TOTP |
| `Pitwall__ConsoleUrl` | `https://pitwall.<domínio>` | sim | usada nos links dos e-mails da equipe |
| `Pitwall__InboxEmail` | e-mail da caixa da equipe | recomendada | recebe aviso de chamado novo ou de resposta do cliente |
| `Pitwall__RequireTotp` | `true` | sim | obriga o segundo fator para a equipe |
| `Pitwall__StaffHosts` | `api.railway.internal` | sim | `/v1/staff` só responde por esse host (o do `PITWALL_API_URL` do console); pelo `api.<domínio>` dá 404 |
| `Pitwall__Bootstrap__Email` | e-mail do primeiro admin | só no 1º boot | remova depois (seção 6) |
| `Pitwall__Bootstrap__Password` | senha do primeiro admin | só no 1º boot | remova depois (seção 6) |
| `Anthropic__ApiKey` | chave da Anthropic | recomendada | sem ela, as notas de versão não são escritas (o resto funciona) |
| `Storage__Provider` | `s3` | sim | `s3` (R2 recomendado) ou `fs` (volume) |
| `Storage__ServiceUrl` | `https://<conta>.r2.cloudflarestorage.com` | se `s3` | endpoint do R2 |
| `Storage__Bucket` | nome do bucket privado | se `s3` | bucket **privado** |
| `Storage__AccessKey` | chave de acesso do R2 | se `s3` | |
| `Storage__SecretKey` | segredo do R2 | se `s3` | |
| `Smtp__Host` | host SMTP | recomendada | sem SMTP a equipe não recebe aviso por e-mail |
| `Smtp__Port` | `587` | não | `465` usa SSL direto; outras portas, STARTTLS |
| `Smtp__User` | usuário SMTP | se o SMTP exige login | |
| `Smtp__Password` | senha SMTP | se o SMTP exige login | |
| `Smtp__From` | `Pitwall <pitwall@<domínio>>` | recomendada | remetente dos avisos |

**String de conexão** (referências ao próprio Postgres; o Railway resolve os valores):

```
ConnectionStrings__Pitwall=Host=${{Postgres.PGHOST}};Port=${{Postgres.PGPORT}};Database=${{Postgres.PGDATABASE}};Username=${{Postgres.PGUSER}};Password=${{Postgres.PGPASSWORD}}
```

**Armazenamento: escolha uma das duas opções.**

- **R2 (recomendado).** Crie um bucket **privado** no Cloudflare R2, gere um token de API com
  leitura e escrita nesse bucket, e preencha `Storage__Provider=s3` mais `Storage__ServiceUrl`,
  `Storage__Bucket`, `Storage__AccessKey` e `Storage__SecretKey`. Não precisa de volume.
- **Volume.** Deixe `Storage__Provider=fs` (ou não defina; é o padrão) e crie um volume no
  `api`: *Settings → Volumes → New Volume*, mount path **`/data`**. O Dockerfile já aponta
  `Storage__Path` para `/data/blobs`. Sem volume, os anexos somem a cada deploy. (O `VOLUME` do
  Dockerfile é ignorado pelo Railway; o volume precisa ser criado no painel.)

---

## 4. Variáveis do `console`

| Variável | Valor | Observação |
|---|---|---|
| `PITWALL_API_URL` | `http://api.railway.internal:8080` | rede privada do Railway; é o que o proxy `/v1` usa |

`api.railway.internal` é o nome do serviço `api` na rede privada do projeto. Se você renomear o
serviço, ajuste o nome aqui. O tráfego do console para a API **não sai para a internet**, e a API
continua acessível publicamente só pelo `api.<domínio>`.

---

## 5. Domínios e o portão de acesso

**Domínios no Railway e no DNS**

1. `api` → *Settings → Networking → Custom Domain* → `api.<domínio>`. O Railway mostra um registro
   CNAME; crie esse registro no Cloudflare.
2. `console` → *Custom Domain* → `pitwall.<domínio>`; mesmo procedimento.
3. No Cloudflare, deixe os dois registros **com proxy ativo** (nuvem laranja). O Cloudflare Access só
   protege um hostname que passa pelo Cloudflare.

**Cloudflare Access no console (obrigatório)**

1. Cloudflare Zero Trust → *Access → Applications → Add an application → Self-hosted*.
2. *Application domain*: `pitwall.<domínio>`. Não coloque `api.<domínio>` nesta aplicação; a API
   precisa ficar livre para os sistemas.
3. *Policy*: *Allow*, com *Include → Emails* listando só o e-mail de cada pessoa da equipe (ou um
   grupo de e-mail do Google/Microsoft, se você tiver).
4. Teste numa janela anônima: `https://pitwall.<domínio>` deve pedir o login do Access antes da tela
   do console.

**Tailscale.** No Railway não há como colocar o console numa tailnet sem um serviço extra; use o
Cloudflare Access aqui. Tailscale é uma opção real no VPS (veja `deploy-vps.md`).

---

## 6. Primeiro deploy e primeiro acesso

1. Confira os logs do `api` em *Deployments*. Você deve ver as migrações aplicadas e uma destas
   linhas:
   - `Created the first admin, <e-mail>.` (primeiro boot, com `Pitwall__Bootstrap__*` definido), ou
   - `No staff yet. Set Pitwall__Bootstrap__Email ...` (faltou o bootstrap).
2. Teste a API: `https://api.<domínio>/health` deve responder `{"status":"ok"}`.
3. Teste o console: `https://pitwall.<domínio>/login` (passando antes pelo Cloudflare Access) deve
   mostrar a tela de entrada.
4. Entre com o e-mail e a senha do bootstrap. **Ative o 2FA imediatamente** (o console pede na
   primeira entrada, porque `Pitwall__RequireTotp=true`). Guarde o segredo do TOTP no gerenciador de
   senhas.
5. **Remova** `Pitwall__Bootstrap__Email` e `Pitwall__Bootstrap__Password` do `api` e deixe o
   Railway redeployar. O bootstrap só age quando a tabela de equipe está vazia, mas a senha não deve
   ficar guardada nas variáveis. Para as próximas pessoas, use o console (Equipe → Adicionar).

---

## 7. Criar os sistemas e as chaves

Para **cada** sistema (DataRunner, RH Flex, metrifree), no console:

1. **Sistemas → Novo sistema**: slug (`datarunner`, `rhflex`, `metrifree`), nome, descrição e idioma
   das notas de versão (`pt`, `en`, `es`).
2. **Chaves → nova chave** com escopos:
   - **`support` + `errors`** para o **backend** do sistema;
   - **`releases`** para o **CI** do sistema (só ele; ela não lê chamados).
   A chave aparece **uma vez**. Guarde no gerenciador de senhas e nos segredos do sistema.
3. **Webhook**: informe a URL do webhook e clique em **gerar segredo**. O segredo também aparece uma
   vez. Depois, use **Ping** para testar a entrega.

**Checklist de variáveis por sistema**

| Sistema | Onde | Variáveis |
|---|---|---|
| DataRunner | backend do DataRunner | `Pitwall__BaseUrl` = `https://api.<domínio>`; `Pitwall__ApiKey` = chave `support+errors`; `Pitwall__WebhookSecret` = segredo do webhook |
| DataRunner | webhook (URL no console) | `https://<api do DataRunner>/api/v1/webhooks/pitwall` |
| RH Flex | backend do RH Flex | `Pitwall__BaseUrl` = `https://api.<domínio>`; `Pitwall__ApiKey` = chave `support+errors`; `Pitwall__WebhookSecret` = segredo do webhook |
| RH Flex | webhook (URL no console) | `https://<api do RH Flex>/api/v1/webhooks/pitwall` |
| metrifree | backend do metrifree | `PITWALL_URL` = `https://api.<domínio>`; `PITWALL_KEY` = chave `support+errors`; `PITWALL_WEBHOOK_SECRET` = segredo do webhook |
| metrifree | webhook (URL no console) | `https://<domínio do metrifree>/api/webhooks/pitwall` |
| Todos | repositório no GitHub (Secrets) | `PITWALL_RELEASE_KEY` = chave `releases` daquele sistema |
| Todos | repositório no GitHub (Variables) | `PITWALL_URL` = `https://api.<domínio>` |

`PITWALL_URL` e `PITWALL_RELEASE_KEY` são os nomes que o workflow `.github/actions/release-notes`
lê. Os nomes `Pitwall__BaseUrl`, `Pitwall__ApiKey` e `Pitwall__WebhookSecret` (DataRunner e RH Flex)
e `PITWALL_KEY`, `PITWALL_WEBHOOK_SECRET` (metrifree) são os que cada produto usa, e ficam nos
respectivos repositórios.

Depois de cadastrar as chaves, faça um **teste de ponta a ponta** com um chamado de teste do próprio
sistema. Não use `scripts/smoke.mjs` em produção (seção 11).

---

## 8. Importar o histórico do DataRunner (uma vez)

O importador copia chamados, mensagens, anexos (com os bytes) e os erros dos últimos 30 dias do
DataRunner para o produto `datarunner`. Ele é idempotente: pode ser rodado de novo sem duplicar.

**Ordem obrigatória**

1. Pitwall no ar, com o sistema `datarunner` cadastrado (seção 7).
2. Deploy do DataRunner, que renomeia as tabelas de suporte para `legacy_*`.
3. Importador logo em seguida. Entre os passos 2 e 3 os chamados antigos ficam invisíveis para o
   cliente; por isso, o intervalo deve ser curto.

**Como rodar no Railway.** O importador é um subcomando da própria API:
`dotnet Pitwall.Api.dll import-datarunner [--dry-run]`. Ele roda e encerra sem subir o servidor.
Como a origem (banco do DataRunner) e o bucket dele precisam ser acessíveis a partir do container,
use as variáveis `Import__*` no serviço `api`, temporariamente:

1. Em **api → Variables**, adicione (valores do DataRunner):

   ```
   Import__SourceConnectionString=Host=<host do Postgres do DataRunner>;Port=<porta>;Database=datarunner;Username=<usuário>;Password=<senha>
   Import__SourceStorage__Provider=s3
   Import__SourceStorage__ServiceUrl=https://<conta>.r2.cloudflarestorage.com
   Import__SourceStorage__Bucket=<bucket privado do DataRunner>
   Import__SourceStorage__AccessKey=<chave>
   Import__SourceStorage__SecretKey=<segredo>
   ```

   `Import__ProductSlug` só precisa existir se o slug não for `datarunner`. Se o Postgres do
   DataRunner estiver em outro projeto Railway, use o host **público** (proxy TCP) dele, porque o
   host privado só resolve dentro do próprio projeto.

2. Instale o Railway CLI, faça `railway login` e `railway link` (escolha o projeto `pitwall`).
3. **Simulação primeiro**, sem gravar nada:

   ```bash
   railway ssh -s api -- dotnet Pitwall.Api.dll import-datarunner --dry-run
   ```

   A última linha mostra quantos chamados, mensagens, anexos (e quantos faltam no bucket), erros e
   quantos foram pulados. Confira com o que o DataRunner tem antes de seguir.
4. Importação de verdade:

   ```bash
   railway ssh -s api -- dotnet Pitwall.Api.dll import-datarunner
   ```

5. Confira no console (produto `datarunner`) e **remova** todas as variáveis `Import__*` do `api`.

`railway ssh` executa o comando dentro do container que já está no ar, com as mesmas variáveis.
Se a sua versão do CLI não tiver `ssh`, rode `railway ssh --help` para conferir.

---

## 9. Atualizar e reverter

**Atualizar.** Com o repositório conectado, cada push na branch do serviço gera um deploy. As
migrações rodam sozinhas no boot da API. Antes de um deploy com mudança de banco, faça um
**backup** (seção 10).

**Reverter.** Em *Deployments*, escolha o deploy anterior bem-sucedido → *Rollback*. Atenção: as
migrações são só para frente. Se a versão nova aplicou uma migração que a versão antiga não
entende, reverter o código pode quebrar o banco; nesse caso, restaure o backup feito antes do deploy
(seção 10) e depois reverta o código.

---

## 10. Banco e backups

- O Postgres do Railway guarda os dados no volume do próprio serviço `Postgres`. Veja em
  *Postgres → Settings → Backups* o que o seu plano oferece e ative os backups automáticos.
- Além disso, faça um **dump lógico** periódico, que você pode restaurar em outro lugar. Pegue a
  URL pública do Postgres (aba *Variables* do serviço `Postgres`, geralmente `DATABASE_PUBLIC_URL`;
  confira o nome exato) e rode, do seu computador:

  ```bash
  pg_dump "$DATABASE_PUBLIC_URL" -Fc -f pitwall-$(date +%F).dump
  ```

  Guarde o `.dump` fora do Railway (por exemplo, num bucket R2 privado).
- **Restaurar** (num Postgres vazio ou para substituir o atual, com cuidado):

  ```bash
  pg_restore --clean --if-exists --no-owner -d "$DATABASE_PUBLIC_URL" pitwall-AAAA-MM-DD.dump
  ```

- Guarde também `Pitwall__SecretKey` no gerenciador de senhas. **Sem ela, os webhooks e os TOTP
  selados no banco não podem ser abertos.** Um backup do banco sem a chave não basta.

---

## 11. Monitoramento e teste de fumaça

**Monitoramento externo.** Se o Pitwall cai, os sistemas não conseguem abrir chamados, e ninguém vê
isso sozinho. Crie no UptimeRobot ou no BetterStack dois monitores HTTP(S), com alerta por e-mail:

- `https://api.<domínio>/health` (esperado: 200);
- `https://pitwall.<domínio>/login` (esperado: 200; o monitor será barrado pelo Cloudflare Access.
  Se for esse o caso, use o monitor só contra o `/health` da API, ou configure uma exceção de
  serviço no Access para o monitor).

**Logs.** *api → Deployments → View logs*; procure por `ERROR` e `Warning`.

**Teste de fumaça.** O `scripts/smoke.mjs` **não serve para produção**: ele só aceita a URL da API
pela variável `API`, mas faz login com o admin de desenvolvimento fixo (`admin@pitwall.local` /
`pitwall-dev-password`), cria um produto, chaves e chamados de teste. Como o admin de produção não
tem essa senha, o script para no primeiro passo; e se você ajustar as credenciais, ele deixaria dados
de teste no sistema real. Teste manualmente:

1. `curl -sS https://api.<domínio>/health` → `{"status":"ok"}`.
2. No console: entrar, criar o produto `teste-deploy`, gerar chave `support+errors` (ela aparece uma
   vez) e abrir um chamado de teste.
3. Criar um chamado com a chave, passando a identidade do cliente no cabeçalho `Pitwall-Actor`
   (JSON codificado em base64url, sem `=` no final):

   ```bash
   ACTOR=$(printf '%s' '{"customerId":"ws-teste","customerName":"Teste","userId":"u-1","userName":"Teste"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
   curl -sS -X POST https://api.<domínio>/v1/support/tickets \
     -H "Authorization: Bearer <chave-support>" \
     -H "Pitwall-Actor: $ACTOR" \
     -H "Content-Type: application/json" \
     -d '{"title":"Teste de deploy","body":"Teste manual","category":"bug","severity":"normal"}'
   ```

   Deve responder `201` com um código de chamado. Confira que ele aparece na fila do console.
4. Ainda no console, apague ou desative o produto `teste-deploy` se a interface oferecer essa opção.
   Não deixe dados de teste misturados com os de produção.
5. Aproveite para testar o **Ping** do webhook de cada sistema.

---

## 12. Pontos em aberto

- **Config as Code.** Ver o aviso no início deste guia.
- **Região e réplicas.** Mantenha uma réplica do `api` (migrações e a fila de webhooks rodam nele).

---

## 13. Checklist final

- [ ] Projeto `pitwall` com `Postgres`, `api` (porta 8080, volume `/data` só com `fs`) e `console` (porta 3200).
- [ ] `api`: todas as variáveis da seção 3, inclusive `PORT=8080`; `Pitwall__SecretKey` guardada no gerenciador de senhas.
- [ ] `console`: `PITWALL_API_URL=http://api.railway.internal:8080`.
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://api.<domínio>/v1/staff/auth/me` dá `404` (`Pitwall__StaffHosts`).
- [ ] Domínios `api.<domínio>` e `pitwall.<domínio>` ativos, com proxy do Cloudflare.
- [ ] Cloudflare Access protegendo **somente** `pitwall.<domínio>`.
- [ ] `/health` da API responde; `/login` do console responde pelo Access.
- [ ] Primeiro admin entrou, 2FA ativado, `Pitwall__Bootstrap__*` removidos.
- [ ] Sistemas criados, chaves e webhooks (com segredo e Ping) cadastrados; variáveis de cada produto e do GitHub configuradas.
- [ ] Importação do DataRunner: dry-run, importação, conferência, variáveis `Import__*` removidas.
- [ ] Backup do Postgres agendado e `Pitwall__SecretKey` no gerenciador de senhas.
- [ ] Monitores externos de `/health` e do console criados.
