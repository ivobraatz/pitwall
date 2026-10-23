# Deploy do Pitwall em VPS (Docker Compose)

Este guia põe o Pitwall em produção num servidor próprio (Ubuntu LTS, por exemplo), com Docker
Compose, Postgres, a API, o console e o Caddy na frente para TLS. Para o Railway, veja
[deploy-railway.md](deploy-railway.md). Os dois guias usam os mesmos conceitos e a mesma checklist de
sistemas.

---

## 1. Arquitetura em produção

Há **dois hostnames**, com públicos diferentes:

| Hostname | Serve | Quem usa | Acesso |
|---|---|---|---|
| `api.<domínio>` | a API | os backends dos sistemas (com a chave do produto) e o job de release notes do CI | público. O navegador do cliente nunca fala com ele |
| `pitwall.<domínio>` | o console | a equipe de suporte | **atrás de Cloudflare Access ou Tailscale** |

Por que dois: o console encaminha `/v1/**` para a API, inclusive a superfície da equipe
(`/v1/staff/**`). Se o console ficar aberto, a superfície da equipe fica aberta. Os sistemas precisam
da API, e não podem depender de um hostname que é só da equipe.

```
Internet ──► Caddy (80/443, TLS)
               ├─ api.<domínio>      ──► api:8080      (bloqueia /v1/staff/*)
               └─ pitwall.<domínio>  ──► console:3200  (atrás do Access/Tailscale)
                                          └─ /v1/** ──► api:8080 (rede interna do compose)

Só na rede interna do compose: postgres (sem porta publicada), api em 127.0.0.1:5180
```

No compose, o `api` e o `console` só escutam em `127.0.0.1`; o Postgres não é publicado. Quem fica
público são só as portas 80 e 443 do Caddy.

Para não esquecer o perfil nos comandos, defina uma vez por sessão:

```bash
export COMPOSE="docker compose -f docker-compose.prod.yml --profile caddy"
```

Use `$COMPOSE` em todos os comandos abaixo. Sem `--profile caddy`, o `ps` e os `logs` não enxergam o
Caddy, e um `up` sem o perfil não o mantém no ar.

---

## 2. Preparar o servidor

Você precisa de um servidor com 2 vCPU, 4 GB de RAM e 40 GB de disco, e acesso SSH com uma conta
não-root com `sudo`.

```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"        # saia e entre de novo na sessão SSH
```

**Firewall: só 22, 80 e 443.**

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

As portas do Pitwall estão publicadas só em `127.0.0.1`, então o Docker não as abre para a internet
mesmo com o UFW (o Docker contorna o UFW para portas publicadas em todas as interfaces, por isso não
publique nada em `0.0.0.0` além do Caddy).

**Código.**

```bash
sudo mkdir -p /opt/pitwall && sudo chown "$USER" /opt/pitwall
git clone <url-do-repositório-pitwall> /opt/pitwall
cd /opt/pitwall
```

---

## 3. Configurar o `.env`

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Preencha (os nomes são os do `.env.example`):

| Variável | Valor |
|---|---|
| `POSTGRES_PASSWORD` | senha do Postgres (`openssl rand -base64 24`). Só vale na **primeira** criação do banco |
| `PITWALL_SECRET_KEY` | `openssl rand -base64 32`. **Guarde no gerenciador de senhas antes de subir.** Nunca troque |
| `PITWALL_CONSOLE_URL` | `https://pitwall.<domínio>` |
| `PITWALL_INBOX_EMAIL` | e-mail da caixa da equipe (aviso de chamado novo ou resposta) |
| `PITWALL_REQUIRE_TOTP` | `true` |
| `PITWALL_STAFF_HOSTS` | opcional; padrão `api`. `/v1/staff` só responde a quem chama a API por `http://api:8080` (o console). Uma segunda trava, além do Caddy |
| `PITWALL_ADMIN_EMAIL`, `PITWALL_ADMIN_PASSWORD` | primeiro admin. Só no primeiro boot; remova depois (seção 6) |
| `ANTHROPIC_API_KEY` | chave da Anthropic (notas de versão). Sem ela, o resto funciona |
| `STORAGE_PROVIDER` | `s3` (R2 recomendado) ou `fs` (volume) |
| `STORAGE_BUCKET`, `STORAGE_SERVICE_URL`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | se `s3`. Bucket **privado** do R2 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | SMTP para os avisos da equipe |
| `PITWALL_API_DOMAIN` | `api.<domínio>` (o Caddy pega o certificado desse nome) |
| `PITWALL_CONSOLE_DOMAIN` | `pitwall.<domínio>` |

Com `STORAGE_PROVIDER=fs` (ou sem definir), os anexos ficam no volume `blobs` (`/data/blobs` dentro
do `api`). Não precisa de bucket, mas o volume precisa de backup (seção 9).

**Antes de subir:** crie os registros DNS `A` de `api.<domínio>` e `pitwall.<domínio>` apontando para
o IP do servidor. Se você usa a nuvem laranja da Cloudflare, deixe o SSL/TLS da zona em **Full
(strict)**; o Caddy já tem certificado válido.

---

## 4. Subir o Pitwall

```bash
$COMPOSE up -d --build
$COMPOSE ps                          # postgres, api, console e caddy devem estar "running" (postgres "healthy")
$COMPOSE logs -f caddy               # acompanhe a emissão dos certificados; Ctrl+C para sair
curl -sS https://api.<domínio>/health   # {"status":"ok"}
```

Na primeira subida o `api` roda as migrações e, se `Pitwall__Bootstrap__*` estiver definido e a
equipe estiver vazia, cria o primeiro admin. Confira com `$COMPOSE logs api`: você deve ver
`Created the first admin, <e-mail>.`.

Se o Caddy não conseguir o certificado, quase sempre é DNS que ainda não propagou ou a porta 80
fechada. O Let's Encrypt limita tentativas; espere alguns minutos antes de tentar de novo.

**Sem o Caddy** (`docker compose -f docker-compose.prod.yml up -d --build`): o `api` e o `console`
ficam só em `127.0.0.1` e nada fica público. Para usar o console, abra um túnel SSH a partir do seu
computador: `ssh -L 3200:127.0.0.1:3200 <usuário>@<servidor>` e acesse `http://localhost:3200/login`.

---

## 5. Gate do console (obrigatório)

Escolha **uma** das duas opções.

**A. Cloudflare Access (recomendado).** Os registros DNS precisam estar com proxy da Cloudflare.

1. Cloudflare Zero Trust → *Access → Applications → Add an application → Self-hosted*.
2. *Application domain*: `pitwall.<domínio>`. Não inclua `api.<domínio>`.
3. *Policy*: *Allow* para os e-mails da equipe (ou para um grupo).
4. Teste numa janela anônima: `https://pitwall.<domínio>` precisa pedir o login do Access antes do
   console.
5. Feche o acesso direto pelo IP do servidor (o Access só protege quem passa pela Cloudflare): ponha
   as faixas da Cloudflare em `PITWALL_CONSOLE_ALLOWED_IPS` e recrie o Caddy. Os comandos estão em
   [deploy-oracle.md, parte 11.3](deploy-oracle.md#113-aceitar-o-console-só-pela-cloudflare).

**B. Tailscale.** O console não tem registro público. Ele fica acessível só pela tailnet.

1. Instale e entre na tailnet: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`.
2. Publique o console só para a tailnet (confira a sintaxe com `tailscale serve --help`, que varia de
   versão): `sudo tailscale serve --bg http://127.0.0.1:3200`.
3. **Não crie** o registro DNS público de `pitwall.<domínio>`, e comente o bloco
   `{$PITWALL_CONSOLE_DOMAIN}` de `deploy/Caddyfile`. Sem DNS, o Caddy não consegue o certificado
   desse nome e fica tentando.
4. Teste com um computador na tailnet, acessando a URL `https://<máquina>.<tailnet>.ts.net`.

Em qualquer das duas opções, o `api.<domínio>` **não** entra no portão: os sistemas precisam chegar
a ele.

---

## 6. Primeiro acesso

1. Entre no console com o e-mail e a senha do bootstrap. Ative o **2FA** imediatamente e guarde o
   segredo do TOTP no gerenciador de senhas.
2. Remova do `.env` as linhas `PITWALL_ADMIN_EMAIL` e `PITWALL_ADMIN_PASSWORD` (deixe-as vazias ou
   apague-as). Depois **recrie** o `api` (mudança de `.env` exige `up -d`, não um restart):

   ```bash
   $COMPOSE up -d api
   ```

3. Para as próximas pessoas, use o console (Equipe → Adicionar).

---

## 7. Criar os sistemas e as chaves

Para **cada** sistema (DataRunner, RH Flex, metrifree), no console:

1. **Sistemas → Novo sistema**: slug (`datarunner`, `rhflex`, `metrifree`), nome, descrição e idiomas
   das notas de versão (`pt`, `en`, `es`).
2. **Chaves → nova chave**:
   - **`support` + `errors`** para o **backend** do sistema;
   - **`releases`** para o **CI** (só ele).
   A chave aparece **uma vez**; guarde no gerenciador de senhas.
3. **Webhook**: informe a URL e clique em **gerar segredo** (aparece uma vez). Depois, **Ping**.

**Checklist de variáveis por sistema**

| Sistema | Onde | Variáveis |
|---|---|---|
| DataRunner | backend do DataRunner | `Pitwall__BaseUrl` = `https://api.<domínio>`; `Pitwall__ApiKey` = chave `support+errors`; `Pitwall__WebhookSecret` = segredo do webhook |
| DataRunner | webhook (URL no console) | `https://<api do DataRunner>/api/v1/webhooks/pitwall` |
| RH Flex | backend do RH Flex | `Pitwall__BaseUrl` = `https://api.<domínio>`; `Pitwall__ApiKey` = chave `support+errors`; `Pitwall__WebhookSecret` = segredo do webhook |
| RH Flex | webhook (URL no console) | `https://<api do RH Flex>/api/v1/webhooks/pitwall` |
| metrifree | backend do metrifree | `PITWALL_URL` = `https://api.<domínio>`; `PITWALL_KEY` = chave `support+errors`; `PITWALL_WEBHOOK_SECRET` = segredo do webhook |
| metrifree | webhook (URL no console) | `https://<domínio do metrifree>/api/webhooks/pitwall` |
| Todos | GitHub do sistema (Secrets) | `PITWALL_RELEASE_KEY` = chave `releases` |
| Todos | GitHub do sistema (Variables) | `PITWALL_URL` = `https://api.<domínio>` |

`PITWALL_URL` e `PITWALL_RELEASE_KEY` são os nomes lidos pelo workflow
`.github/actions/release-notes`. Os demais nomes são os que cada produto usa e ficam nos respectivos
repositórios.

Depois, teste de ponta a ponta com um chamado de teste de cada sistema. **Não use
`scripts/smoke.mjs` em produção** (veja a seção 10).

---

## 8. Importar o histórico do DataRunner (uma vez)

O importador é um subcomando da própria API: `dotnet Pitwall.Api.dll import-datarunner [--dry-run]`.
A imagem tem `ENTRYPOINT ["dotnet", "Pitwall.Api.dll"]`, então os argumentos `import-datarunner
--dry-run` são acrescentados depois do nome do serviço. Ele copia chamados, mensagens, anexos (com os
bytes) e os erros dos últimos 30 dias para o produto `datarunner`, e pode rodar de novo sem duplicar.

**Ordem:** Pitwall no ar com o sistema `datarunner` cadastrado → deploy do DataRunner (renomeia as
tabelas para `legacy_*`) → importador logo em seguida (o intervalo entre os dois deixa os chamados
antigos invisíveis para o cliente).

**Passo 1: guardar as credenciais de origem num arquivo temporário.**

```bash
cat > /opt/pitwall/import.env <<'EOF'
Import__SourceConnectionString=Host=<host do Postgres do DataRunner>;Port=5432;Database=datarunner;Username=<usuário>;Password=<senha>
Import__SourceStorage__Provider=s3
Import__SourceStorage__ServiceUrl=https://<conta>.r2.cloudflarestorage.com
Import__SourceStorage__Bucket=<bucket privado do DataRunner>
Import__SourceStorage__AccessKey=<chave>
Import__SourceStorage__SecretKey=<segredo>
EOF
chmod 600 /opt/pitwall/import.env
set -a; . /opt/pitwall/import.env; set +a
```

`Import__ProductSlug` só é necessário se o slug do produto no Pitwall não for `datarunner`.

**Passo 2: simulação**, sem gravar nada:

```bash
$COMPOSE run --rm \
  -e Import__SourceConnectionString -e Import__SourceStorage__Provider -e Import__SourceStorage__ServiceUrl \
  -e Import__SourceStorage__Bucket -e Import__SourceStorage__AccessKey -e Import__SourceStorage__SecretKey \
  api import-datarunner --dry-run
```

A última linha mostra o total de chamados, mensagens e anexos (e quantos anexos faltam no bucket),
erros e quantos itens foram pulados. Confira com o que o DataRunner tem antes de seguir.

**Passo 3: importação de verdade.** Mesmo comando, sem `--dry-run`.

**Passo 4: limpeza.** Apague o arquivo com as credenciais e feche o terminal (as variáveis
exportadas no `set -a` somem com a sessão):

```bash
rm -f /opt/pitwall/import.env
```

Confira no console (produto `datarunner`).

> Se a senha do DataRunner tiver espaço ou caractere especial (`$`, `&`, `;`, aspas), envolva o
> valor inteiro da linha em aspas simples no `import.env`, por exemplo
> `Import__SourceConnectionString='Host=…;Password=…'`, para o `source` não interpretar a senha.

---

## 9. Backups

**Dump lógico diário do Postgres** (cron do servidor). O dump é feito pelo próprio container, por
isso não precisa de senha. Abra o crontab com `crontab -e` e adicione:

```cron
15 3 * * * cd /opt/pitwall && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U pitwall -Fc pitwall > /opt/pitwall/backups/pitwall-$(date +\%F).dump 2>>/opt/pitwall/backups/backup.log && find /opt/pitwall/backups -name 'pitwall-*.dump' -mtime +14 -delete
```

Antes, crie a pasta: `mkdir -p /opt/pitwall/backups`. O `\%` é obrigatório no crontab (o `%` é
caractere especial ali). Esse comando mantém 14 dias de dumps. Teste uma vez manualmente, sem esperar
a madrugada:

```bash
cd /opt/pitwall && $COMPOSE exec -T postgres pg_dump -U pitwall -Fc pitwall > /opt/pitwall/backups/teste.dump && ls -lh /opt/pitwall/backups/teste.dump
```

**Anexos em volume (só com `STORAGE_PROVIDER=fs`).** Confira o nome do volume com `docker volume ls`
(normalmente `pitwall_blobs`) e agende o arquivo:

```cron
30 3 * * * docker run --rm -v pitwall_blobs:/data:ro -v /opt/pitwall/backups:/backup alpine tar czf /backup/blobs-$(date +\%F).tgz -C /data . && find /opt/pitwall/backups -name 'blobs-*.tgz' -mtime +14 -delete
```

**Fora do servidor.** Backups só no mesmo disco não protegem contra perda do servidor. Copie a pasta
`/opt/pitwall/backups` para outro lugar (um bucket R2 privado, por exemplo, com `rclone` ou o cliente
do seu provedor).

**Restaurar um dump** (substitui o banco; pare o `api` antes para ninguém gravar durante a
restauração):

```bash
$COMPOSE stop api
$COMPOSE exec -T postgres pg_restore -U pitwall -d pitwall --clean --if-exists --no-owner < /opt/pitwall/backups/pitwall-AAAA-MM-DD.dump
$COMPOSE up -d api
```

**`PITWALL_SECRET_KEY` é parte do backup.** Sem ela, os webhooks e os TOTP selados no banco não
podem ser abertos. Guarde-a no gerenciador de senhas, nunca só no `.env` do servidor.

---

## 10. Monitoramento e teste de fumaça

**Monitoramento externo.** Se o Pitwall cai, os sistemas não conseguem abrir chamados, e ninguém vê
isso sozinho. No UptimeRobot ou no BetterStack, crie dois monitores HTTP(S) com alerta por e-mail:

- `https://api.<domínio>/health` (esperado: 200);
- `https://pitwall.<domínio>/login` (esperado: 200 com o Access; se o Access barrar o monitor, use
  só o `/health` da API, ou crie uma política do Access para o monitor).

**Logs e saúde local.** `$COMPOSE ps`, `$COMPOSE logs --tail=200 api`. Os logs do Docker crescem sem
limite por padrão. Limite-os (recomendado) criando `/etc/docker/daemon.json`:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
```

Depois, `sudo systemctl restart docker && $COMPOSE up -d`.

**Teste de fumaça.** O `scripts/smoke.mjs` **não serve para produção**: ele só aceita a URL da API
pela variável `API`, mas faz login com o admin de desenvolvimento fixo (`admin@pitwall.local` /
`pitwall-dev-password`) e cria produto, chaves e chamados de teste. O admin de produção não tem essa
senha, então o script para no primeiro passo; ajustado para entrar, ele deixaria dados de teste no
sistema real. Teste manualmente:

1. `curl -sS https://api.<domínio>/health` → `{"status":"ok"}`.
2. No console, crie o produto `teste-deploy` e gere uma chave `support+errors`.
3. Abra um chamado com a chave, identificando o cliente no cabeçalho `Pitwall-Actor` (JSON em
   base64url, sem `=` no final):

   ```bash
   ACTOR=$(printf '%s' '{"customerId":"ws-teste","customerName":"Teste","userId":"u-1","userName":"Teste"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
   curl -sS -X POST https://api.<domínio>/v1/support/tickets \
     -H "Authorization: Bearer <chave-support>" \
     -H "Pitwall-Actor: $ACTOR" \
     -H "Content-Type: application/json" \
     -d '{"title":"Teste de deploy","body":"Teste manual","category":"bug","severity":"normal"}'
   ```

   Deve responder `201` com um código de chamado. Confira a fila do console.
4. Apague ou desative o produto `teste-deploy` pelo console, se a interface permitir.
5. Teste o **Ping** do webhook de cada sistema.
6. Confirme que o staff **não** responde pelo hostname da API: `curl -sS -o /dev/null -w '%{http_code}\n' https://api.<domínio>/v1/staff/tickets` deve dar `404`.

---

## 11. Atualizar e reverter

**Atualizar.** Antes de cada atualização com mudança de banco, faça um backup (seção 9). Depois:

```bash
cd /opt/pitwall
git pull
$COMPOSE up -d --build
$COMPOSE ps
curl -sS https://api.<domínio>/health
```

As migrações rodam sozinhas no boot da API.

**Reverter.** Veja os commits recentes com `git log --oneline -5`, volte para o anterior com
`git checkout <commit>` e rode `$COMPOSE up -d --build`. Atenção: as migrações são só para frente. Se
a versão nova aplicou uma migração que a antiga não entende, restaure o dump feito antes (seção 9)
depois de voltar o código. Para retornar ao ramo principal, use `git switch main`.

---

## 12. Pontos em aberto

- **Anexos em `fs`** dependem do volume `blobs` e do backup dele. Em produção, prefira R2 (`s3`).
- **Trocar a senha do Postgres** depois da primeira subida exige `ALTER USER` dentro do banco; mudar
  `POSTGRES_PASSWORD` no `.env` sozinho não muda o banco já criado.
- **Config do Caddy.** O `deploy/Caddyfile` bloqueia `/v1/staff` no hostname da API. Se um sistema
  passar a precisar de um caminho novo, confira antes que ele não cai nesse bloqueio.

---

## 13. Checklist final

- [ ] Servidor com Docker, UFW liberando só 22, 80 e 443.
- [ ] Código em `/opt/pitwall`; `.env` com `chmod 600`; `PITWALL_SECRET_KEY` guardada no gerenciador de senhas.
- [ ] DNS de `api.<domínio>` e `pitwall.<domínio>` apontando para o servidor (e SSL Full (strict), se houver proxy).
- [ ] `$COMPOSE up -d --build` com `$COMPOSE ps` mostrando tudo ativo; `/health` responde.
- [ ] Gate do console ativo (Cloudflare Access ou Tailscale), **e nada além do console** atrás dele.
- [ ] Primeiro admin entrou, 2FA ativado, `PITWALL_ADMIN_*` removidos do `.env` e `api` recriado.
- [ ] Sistemas, chaves e webhooks cadastrados; variáveis de cada produto e do GitHub configuradas.
- [ ] Importação do DataRunner: dry-run, importação, `import.env` apagado.
- [ ] Cron de backup do Postgres (e dos anexos, se `fs`) testado e copiado para fora do servidor.
- [ ] Monitores externos de `/health` e do console; limite de logs do Docker configurado.
