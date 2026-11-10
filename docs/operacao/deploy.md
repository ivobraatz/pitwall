# Deploy do Pitwall: por onde começar

Este guia ajuda a escolher o ambiente e explica o que vale para todos. O passo a passo fica no guia de
cada um.

| Ambiente | Guia | Anexos ficam em | Atualização depois do CI verde | Custo |
|---|---|---|---|---|
| **Oracle Always Free** (VM ARM) | [deploy-oracle.md](deploy-oracle.md) | SeaweedFS na VM | timer na VM | gratuito, dentro dos limites da Oracle |
| **Outra plataforma de contêineres** | [abaixo](#outras-plataformas) | volume ou bucket | depende da plataforma | depende da plataforma |

**Qual escolher:** sem preferência e com tempo para administrar um servidor, use a Oracle. Se a Oracle
não tiver vaga na sua região ou você precisar de um contrato pago, use um VPS. Se não quiser administrar
servidor, use o Railway.

## O que vale em todo ambiente

**Duas portas, dois públicos.** Isso não muda em nenhum ambiente:

| Endereço | Serve | Quem usa | Proteção |
|---|---|---|---|
| `api.<domínio>` | a API | backends dos sistemas e CI deles | pública, com chave por sistema; `/v1/staff` dá 404 |
| `pitwall.<domínio>` | o console | só a equipe | **Cloudflare Access ou Tailscale**, além do login com 2FA |

**Segredos.**

- `PITWALL_SECRET_KEY` (`Pitwall__SecretKey` no Railway) nunca pode mudar nem se perder. Um backup do banco
  sem ela não abre os segredos de webhook nem o 2FA. Guarde-a no gerenciador de senhas.
- O `.env` de produção não vai para o git.

**Anexos.** Até 90 MB por vídeo (MP4, WebM, MOV) e 25 MB para os outros arquivos. O plano gratuito da
Cloudflare recusa envios acima de 100 MB. Trocar o local dos anexos depois não move os arquivos antigos:
escolha antes do primeiro anexo.

| Modo | Configuração | Quando usar |
|---|---|---|
| SeaweedFS | padrão do `docker-compose.prod.yml` | servidor próprio |
| Volume (`fs`) | `Storage__Provider=fs` e volume em `/data` | plataformas de contêineres |
| Bucket externo | `STORAGE_*` no `.env` ([Apêndice A](deploy-oracle.md#apêndice-a--anexos-em-outro-bucket-s3-ou-r2-sem-seaweedfs)) | se você preferir um S3 ou R2 |

**Uma réplica da API.** As migrações rodam quando ela sobe, e a fila de webhooks roda nela.

**Backups.** Copie para fora do ambiente: banco, anexos e, separada deles, a `PITWALL_SECRET_KEY`.

## CI/CD

### O que roda no GitHub

| Workflow | Quando | O que faz |
|---|---|---|
| `ci.yml`, jobs `api` e `web` | push na `main` e PRs | testes da API, testes do SDK, typecheck e build do console |
| `ci.yml`, job `prod-stack` | push na `main` e PRs | sobe o `docker-compose.prod.yml` de verdade, confere as fotos do login, o login e um vídeo de 30 MB, verifica que ele chegou ao bucket e roda o `deploy/backup.sh` |
| `release.yml` | tag `v<versão>` | publica `pitwall-sdk` no npm e `Pitwall.AspNetCore` no NuGet. Não faz deploy |
| `mcp-release.yml` | tag `mcp-v<versão>` | publica `pitwall-mcp` no npm, com a versão de `packages/mcp/package.json`. Não faz deploy |

### Como a versão chega a cada ambiente

| Ambiente | Mecanismo | Como ligar | Se a versão nova não subir |
|---|---|---|---|
| Oracle | timer pergunta ao GitHub a cada 5 minutos, roda o `deploy/auto-update.sh` | [parte 19](deploy-oracle.md#parte-19--atualização-automática-cicd) | volta o código sozinho; o dump feito antes fica em `backups/` |

**O dia a dia é igual em todos:** faça merge ou push na `main`. Com CI vermelho, nada é publicado.

**As migrações só andam para a frente.** Voltar o código não desfaz o banco. Se a versão nova mudou o banco,
restaure o dump feito antes da atualização. No timer, ele é automático; no Railway, faça o dump à mão antes
de publicar uma mudança de banco.

**Repositório privado ou fork.** O `auto-update.sh` consulta `ivobraatz/pitwall` sem token, o que só
funciona em repositório público. Para um fork público, defina `PITWALL_REPO`, como mostra a seção 11 do
guia do VPS. Em repositório privado, o script precisa ser ajustado para enviar um token.

### Notas de versão dos sistemas

São de outro CI: o de cada sistema chama a action `release-notes`
([integracao.md](integracao.md)), com o secret `PITWALL_RELEASE_KEY` e a variable `PITWALL_URL`.

## Outras plataformas

Este caminho **não foi testado**, e os guias acima não o cobrem. Qualquer plataforma serve se oferecer:

- Duas imagens, construídas **a partir da raiz do repositório**: `apps/api/Dockerfile` (porta 8080,
  health em `/health`) e `apps/console/Dockerfile` (porta 3200, health em `/login`).
- Postgres 17 e rede privada entre o console e a API.
- Volume persistente em `/data` da API, gravável pelo usuário `app`, que não é root. Se o volume nascer
  como root, rode a API como root ou corrija o dono; caso contrário, todo anexo falha com 502.
- Variáveis: as do `.env.example`, em qualquer plataforma. No console, `PITWALL_API_URL` aponta para o endereço privado da API, e
  `Pitwall__StaffHosts` da API recebe o host desse endereço.
- Portão de acesso no console, e nunca na API.

**Painéis que leem Compose (Coolify, Dokploy):** use o `docker-compose.prod.yml` sem o perfil `caddy`, porque
o painel já cuida do TLS. Aponte os domínios para `api:8080` e `console:3200`, e confira se o painel não
remove o volume `seaweedfs` nos redeploys.

**Servidor sem IP público (em casa, atrás de NAT):** o Caddy não consegue emitir o certificado. Use o
Cloudflare Tunnel, apontando `api.<domínio>` para `http://api:8080` e `pitwall.<domínio>` para
`http://console:3200`, sem o perfil `caddy`. Nesse caso, o bloqueio do Caddy em `/v1/staff` não existe, e
sobra a trava do `Pitwall__StaffHosts`: confira que `https://api.<domínio>/v1/staff/auth/me` dá 404.

## O que já foi testado

| Item | Situação |
|---|---|
| Stack do `docker-compose.prod.yml` com SeaweedFS, backup e restauração | testado localmente, em x86 |
| Imagens em ARM64 | iniciam em emulação e mostram a versão; a stack completa não rodou em ARM |
| Job `prod-stack` no GitHub, timer e `auto-update.sh` com esta stack | ainda não rodaram |
| Deploy numa VM Oracle ou VPS reais | não executado com esta versão dos guias |
| Railway com volume, *Wait for CI* e SeaweedFS como serviço | não executado; os passos seguem a documentação do Railway |
| Outras plataformas, Coolify, Dokploy, Cloudflare Tunnel | não testados |
