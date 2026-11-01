# Deploy do Pitwall no Oracle Cloud Always Free — passo a passo completo

Este guia leva o Pitwall do zero até produção numa VM gratuita da Oracle (Ampere A1, ARM), com
Docker Compose, Postgres, SeaweedFS (o bucket das imagens e vídeos dos chamados), a API, o console e o
Caddy (HTTPS automático), o console protegido pelo Cloudflare Access, backups, monitoramento e
atualização automática depois do CI verde. Cada passo tem o comando exato e como conferir que deu
certo. Faça na ordem. Para comparar com outros ambientes, veja [deploy.md](deploy.md).

**No fim você terá:**

| Endereço | O que é | Quem acessa |
|---|---|---|
| `https://pitwall-api.braatz.com.br` | API do Pitwall | os backends do DataRunner, RH Flex e metrifree, e o CI deles |
| `https://pitwall.braatz.com.br` | console da equipe | só você e a equipe, depois do login do Cloudflare Access |

O Pitwall atende todos os produtos, então fica no domínio da software house, `braatz.com.br`, e não
no de um produto. Os dois nomes são de primeiro nível (`pitwall-api.` e `pitwall.`), para o
certificado gratuito da Cloudflare cobrir o console quando ele passar pelo proxy.

**Antes de começar, tenha à mão:**

- Acesso à zona **`braatz.com.br`** na Cloudflare (DNS, Email Routing e Zero Trust).
- Uma **máquina sua, fora da Oracle**, para guardar os backups (parte 8.4).
- Um **gerenciador de senhas** (1Password, Bitwarden…). Várias chaves aparecem uma vez só.
- Um cartão de crédito (a Oracle pede para verificar a conta; o Always Free não cobra).
- O domínio `braatz.com.br` verificado no **Resend** (já está) e uma API key do Resend para o
  Pitwall (parte 8.2 mostra como criar). Os avisos de chamado novo vão para
  `suporte@braatz.com.br`, que o Email Routing da Cloudflare entrega no seu e-mail pessoal.
- Uma chave da Anthropic (`ANTHROPIC_API_KEY`) para as notas de versão. Opcional: sem ela o resto
  funciona.
- Cerca de 1h30.

Convenção: blocos marcados **(no seu computador)** rodam no PowerShell do Windows; blocos marcados
**(na VM)** rodam na sessão SSH do servidor.

---

## Já tem uma VM do Pitwall?

Pule as partes 1 a 6 e escolha um caminho **(na VM)**:

**Recomeçar do zero, apagando os dados.** O `down -v` apaga banco e anexos para sempre:

```bash
sudo systemctl stop pitwall-update.timer 2>/dev/null
cd /opt/pitwall
$COMPOSE down -v
git fetch origin && git switch main && git reset --hard origin/main
rm .env
```

Depois siga a partir da parte 8. Se o `$COMPOSE` estiver vazio, rode antes o atalho da parte 7.

**Atualizar mantendo os dados.** Sem as duas linhas abaixo, o compose se recusa a subir:

```bash
cd /opt/pitwall
echo "SEAWEEDFS_ACCESS_KEY=pitwall" >> .env
echo "SEAWEEDFS_SECRET_KEY=$(openssl rand -hex 24)" >> .env
grep '^STORAGE_' .env
```

O último comando decide o resto:

- **Mostra `STORAGE_PROVIDER=fs` ou um bucket externo:** os anexos continuam onde estão e o SeaweedFS
  fica sem uso. Acrescente `STORAGE_CREATE_BUCKET=false`. Apagar essas linhas sem mover os arquivos faz
  os anexos antigos sumirem do console.
- **Não mostra nada:** a API passa a gravar no SeaweedFS. Se já existem anexos no disco, acrescente
  antes `STORAGE_PROVIDER=fs` para não perdê-los de vista.

---

## Parte 1 — Conta da Oracle

### 1.1 Criar a conta

1. Acesse https://signup.cloud.oracle.com e preencha o cadastro.
2. **Home Region:** escolha com cuidado, **não muda depois**, e a VM gratuita ARM só pode ser criada
   nela. Regiões muito procuradas (São Paulo, Vinhedo, Ashburn) costumam ficar sem capacidade de
   ARM gratuito. Se não fizer questão de latência baixa, escolha uma menos disputada (por exemplo
   `US West (Phoenix)`, `US East (Ashburn)` ou `Brazil East (São Paulo)` se ainda tiver vaga). A
   latência importa pouco aqui: quem chama a API são servidores, não o navegador do cliente.
3. Verifique o cartão e aguarde o e-mail de "conta pronta" (pode levar alguns minutos).
4. Entre em https://cloud.oracle.com com o nome da conta (*Cloud Account Name*) e o seu e-mail.

### 1.2 Passar a conta para Pay As You Go (recomendado de verdade)

Por quê: em conta só Free Tier, a Oracle **para e recupera** VMs gratuitas que ficam ociosas por 7
dias (CPU, rede e memória baixas). O Pitwall passa quase o tempo todo ocioso. Em Pay As You Go, os
recursos Always Free continuam **gratuitos**, essa regra não vale e é mais fácil conseguir capacidade
de ARM.

1. Menu (☰) → **Billing & Cost Management** → **Upgrade and Manage Payment**.
2. **Upgrade your account** → **Pay As You Go** → confirme o cartão.
3. Aguarde o e-mail de confirmação (pode levar de minutos a 1 dia). Pode seguir o guia enquanto isso.

### 1.3 Criar um alerta de orçamento

Para ser avisado se algo sair do gratuito:

1. Menu → **Billing & Cost Management** → **Budgets** → **Create Budget**.
2. *Name*: `alerta-gratuito`; *Target*: o compartimento raiz (o nome da sua conta);
   *Monthly budget amount*: `1` (US$ 1).
3. *Threshold metric*: **Actual Spend**; *Threshold type*: **Percentage of Budget**; *Threshold %*:
   `1`; *Email recipients*: o seu e-mail.
4. **Create**.

---

## Parte 2 — Chave SSH

Se você já tem `C:\Users\<você>\.ssh\id_ed25519.pub`, pule para a parte 3.

**(no seu computador)**

```powershell
ssh-keygen -t ed25519 -C "pitwall-oracle"
```

Aperte Enter para aceitar o caminho padrão e defina uma senha para a chave (ou deixe vazia). Depois
mostre a chave pública, que você vai colar na Oracle:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

Copie a linha inteira (começa com `ssh-ed25519`).

---

## Parte 3 — Criar a VM

1. Menu → **Compute** → **Instances** → **Create instance**.
2. **Name:** `pitwall`.
3. **Placement:** deixe o *Availability domain* padrão (se der erro de capacidade no passo 9, volte
   aqui e troque).
4. **Image and shape** → **Edit**:
   - **Change image** → **Canonical Ubuntu** → versão **24.04** → **Select image**.
   - **Change shape** → **Virtual machine** → **Ampere** → marque **VM.Standard.A1.Flex** →
     *Number of OCPUs*: `2`, *Amount of memory (GB)*: `12` → **Select shape**.
     (O gratuito permite até 4 OCPU e 24 GB no total da conta; 2/12 deixa folga para outra VM.)
   - Confira que a imagem ficou **Canonical-Ubuntu-24.04-aarch64**.
5. **Primary VNIC information / Networking:**
   - **Create new virtual cloud network** (deixe os nomes sugeridos).
   - **Create new public subnet**.
   - Marque **Automatically assign public IPv4 address**.
6. **Add SSH keys** → **Paste public keys** → cole a linha da parte 2.
7. **Boot volume:** marque **Specify a custom boot volume size** → `100` GB.
   (O gratuito soma 200 GB de volumes na conta.)
8. Revise: o rodapé deve indicar *Always Free-eligible* no shape e na imagem.
9. **Create**. Aguarde o estado **Running** (1 a 3 minutos).
   - Se aparecer **Out of capacity for shape VM.Standard.A1.Flex**: troque o *Availability domain*
     (passo 3) e tente de novo; ou tente em outro horário; com a conta em Pay As You Go fica mais fácil.
10. Na página da instância, copie o **Public IPv4 address**. Ao longo do guia ele é `<IP-DA-VM>`.

---

## Parte 4 — Liberar as portas 80 e 443 na rede da Oracle

Na Oracle, uma porta só chega à VM se estiver liberada **na rede (Security List)** e **no firewall
da própria VM** (parte 5). Aqui é a rede.

1. Na página da instância, em **Primary VNIC**, clique no nome da **Subnet**.
2. **Security Lists** → clique em **Default Security List for vcn-…**.
3. **Add Ingress Rules** e preencha a primeira regra:
   - *Source Type*: CIDR; *Source CIDR*: `0.0.0.0/0`; *IP Protocol*: TCP;
     *Destination Port Range*: `80`; *Description*: `http (caddy)`.
4. **+ Another Ingress Rule**:
   - *Source CIDR*: `0.0.0.0/0`; *IP Protocol*: TCP; *Destination Port Range*: `443`;
     *Description*: `https (caddy)`.
5. **Add Ingress Rules**.

A regra da porta 22 (SSH) já existe. **Não** abra 5180, 3200, 5432 nem 9000.

---

## Parte 5 — Primeiro acesso e firewall da VM

### 5.1 Entrar na VM

**(no seu computador)**

```powershell
ssh ubuntu@<IP-DA-VM>
```

Na primeira vez, responda `yes` para aceitar a impressão digital do servidor. O prompt muda para
`ubuntu@pitwall:~$`.

### 5.2 Atualizar o sistema

**(na VM)**

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl nano cron
sudo timedatectl set-timezone America/Sao_Paulo
```

Se o `upgrade` pedir para reiniciar serviços, aceite o padrão (Enter). Se ele avisar que precisa
reiniciar a máquina, faça:

```bash
sudo reboot
```

espere 1 minuto e entre de novo com `ssh ubuntu@<IP-DA-VM>`.

### 5.3 Liberar 80 e 443 no firewall da VM

As imagens Ubuntu da Oracle vêm com regras de `iptables` que recusam tudo além do SSH. Faça isto
**antes de instalar o Docker**.

**(na VM)**

Rode **uma vez só** (rodar de novo duplica as regras). O primeiro comando acha a linha do `REJECT`,
que muda de imagem para imagem, e os outros inserem as regras logo antes dela:

```bash
N=$(sudo iptables -L INPUT -n --line-numbers | awk '$2=="REJECT" {print $1; exit}'); echo "REJECT na linha $N"
sudo iptables -I INPUT "$N" -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT "$N" -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Se o `echo` imprimir `REJECT na linha ` sem número, pare: não há REJECT na cadeia INPUT, e as portas já
estão abertas no firewall da VM (pule os dois `iptables -I`).

Confira:

```bash
sudo iptables -L INPUT -n --line-numbers
```

As linhas `ACCEPT tcp dpt:80` e `ACCEPT tcp dpt:443` precisam aparecer **acima** da linha
`REJECT all ... reject-with icmp-host-prohibited`.

Se elas ficaram **abaixo** do REJECT ou duplicadas, apague cada uma pelo número, **de baixo para
cima** (`sudo iptables -D INPUT <número>`), e insira de novo com o número da linha do REJECT
(`sudo iptables -I INPUT <linha do REJECT> -m state --state NEW -p tcp --dport 80 -j ACCEPT`, idem
para 443). Depois, `sudo netfilter-persistent save`.

**Não instale nem ative o UFW**: ele conflita com essas regras da Oracle.

---

## Parte 6 — Instalar o Docker

**(na VM)**

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

Limite o tamanho dos logs do Docker (sem isso eles crescem sem fim):

```bash
echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

Saia e entre de novo para o grupo `docker` valer:

```bash
exit
```

**(no seu computador)**

```powershell
ssh ubuntu@<IP-DA-VM>
```

Confira **(na VM)**:

```bash
docker run --rm hello-world
docker compose version
```

O primeiro imprime `Hello from Docker!`; o segundo, `Docker Compose version v2…`.

---

## Parte 7 — Baixar o Pitwall

**(na VM)**

```bash
sudo mkdir -p /opt/pitwall
sudo chown ubuntu:ubuntu /opt/pitwall
git clone https://github.com/ivobraatz/pitwall.git /opt/pitwall
cd /opt/pitwall
git log --oneline -1
```

O servidor roda a branch `main`. O `git log` mostra o commit em uso; anote-o, ele é o ponto de
volta se uma atualização der errado (parte 18).

Crie um atalho para os comandos do compose, valendo em qualquer pasta e em toda sessão:

```bash
echo 'export COMPOSE="docker compose -f /opt/pitwall/docker-compose.prod.yml --profile caddy"' >> ~/.bashrc
source ~/.bashrc
echo $COMPOSE
```

A última linha deve imprimir `docker compose -f /opt/pitwall/docker-compose.prod.yml --profile caddy`.

---

O `.env` guarda tudo que o Pitwall precisa. Um script gera as senhas internas e escreve o arquivo;
você só busca as chaves de fora. Abra o gerenciador de senhas e crie um item **"Pitwall produção"**:
cada valor vai para lá assim que aparecer (vários aparecem uma vez só).

| O quê | De onde vem | Passo |
| --- | --- | --- |
| `POSTGRES_PASSWORD`, `PITWALL_SECRET_KEY`, `SEAWEEDFS_SECRET_KEY`, `PITWALL_ADMIN_PASSWORD` | gerados pelo script | 8.6 |
| `SMTP_PASSWORD` | Resend | 8.2 |
| `PITWALL_INBOX_EMAIL` | Email Routing da Cloudflare | 8.3 |
| Máquina que guarda os backups (não vai no `.env`) | você | 8.4 |
| `ANTHROPIC_API_KEY` | Anthropic | 8.5 |
| `PITWALL_CONSOLE_ALLOWED_IPS` | faixas de IP da Cloudflare, acrescentadas por comando mais tarde | 11.3 |

### 8.1 Onde ficam as imagens e os vídeos

No **SeaweedFS**, que sobe junto com o resto: um bucket privado `pitwall-anexos` num volume da VM. A
API cria o bucket sozinha na primeira subida e é o único caminho até ele, porque o SeaweedFS não
publica nenhuma porta. Não há nada para criar nem configurar, nem dependência de serviço externo.

O limite é de **90 MB por vídeo** (MP4, WebM ou MOV) e 25 MB para os outros arquivos. O plano gratuito
da Cloudflare recusa envios acima de 100 MB pelo console.

A versão está fixada no `docker-compose.prod.yml`; atualize-a de propósito, de vez em quando, por um
commit (o CI testa). Reserve cerca de 500 MB de memória para ele.

### 8.2 Resend: chave para enviar e-mail (`SMTP_PASSWORD`)

O Pitwall manda e-mail para a equipe (chamado novo, resposta do cliente) pelo Resend, onde
`braatz.com.br` já está verificado.

1. Entre em https://resend.com e confira em **Domains** que `braatz.com.br` aparece como
   **Verified**.
2. Vá em **API Keys** (https://resend.com/api-keys) → **Create API Key**.
3. *Name*: `pitwall`; *Permission*: **Sending access**; *Domain*: `braatz.com.br`.
4. **Add**. A chave aparece **uma vez** e começa com `re_`. **Copie para o gerenciador de senhas**
   como `SMTP_PASSWORD`.

O remetente vai ser `pitwall@braatz.com.br`. Ele não precisa existir como caixa de e-mail: basta o
domínio estar verificado no Resend.

### 8.3 Cloudflare Email Routing: a caixa da equipe (`PITWALL_INBOX_EMAIL`)

Os avisos vão para `suporte@braatz.com.br`, que a Cloudflare entrega no seu e-mail pessoal.

1. https://dash.cloudflare.com → `braatz.com.br` → **Email** → **Email Routing** → **Routing
   rules**.
2. Se já existe uma regra para `suporte@braatz.com.br`, ou o **Catch-all address** está ativo
   mandando para o seu e-mail, não precisa fazer nada.
3. Se não existe: **Create address** → *Custom address* `suporte` → *Action* **Send to an email** →
   *Destination* o seu e-mail pessoal → **Save**.

Teste: mande um e-mail qualquer para `suporte@braatz.com.br` e confira que chegou no seu e-mail
pessoal.

### 8.4 Uma máquina sua para guardar os backups

Banco e anexos ficam no disco da VM. Se a VM ou a conta da Oracle se perder, só uma cópia em outra
máquina salva os dados. Escolha uma com Linux, NAS ou Windows com WSL, ligada na hora agendada e com
disco para todos os anexos. Ela é configurada na parte 15.2 e busca os arquivos na VM, com uma chave
SSH que só permite leitura da pasta de backups: uma invasão da VM não alcança essas cópias.

### 8.5 Anthropic: notas de versão (`ANTHROPIC_API_KEY`)

O Claude Haiku escreve as notas de versão a partir dos commits. Sem essa chave o resto do Pitwall
funciona; só as notas não são escritas. Custa centavos por versão.

1. Entre em https://console.anthropic.com.
2. **Settings** → **Billing**: confira que há crédito (se não houver, **Buy credits**; US$ 5 duram
   bastante para isso).
3. **Settings** → **API Keys** → **Create Key** → *Name* `pitwall` → **Add**.
4. A chave aparece **uma vez** e começa com `sk-ant-`. Copie para o gerenciador de senhas como
   `ANTHROPIC_API_KEY`.

### 8.6 Gerar o `.env`

**(na VM)**

```bash
cd /opt/pitwall
bash deploy/gerar-env.sh
```

O script pergunta o e-mail com que você vai entrar (use o mesmo que vai liberar no Cloudflare Access,
parte 11.4), a chave do Resend e a da Anthropic. Depois gera as senhas, escreve o `.env` só com
permissão para o seu usuário e mostra os valores gerados. **Copie-os para o gerenciador de senhas
agora:**

- `PITWALL_SECRET_KEY`: **nunca pode mudar nem se perder.** Ela cifra os segredos de webhook e as
  sementes do 2FA guardadas no banco. Sem ela, um backup do banco não serve para nada.
- `POSTGRES_PASSWORD` e `SEAWEEDFS_SECRET_KEY`: mantenha os valores. Trocar a `POSTGRES_PASSWORD` no
  `.env` não troca a senha já gravada no banco.
- `PITWALL_ADMIN_PASSWORD`: seu primeiro login; sai do servidor na parte 12.

O script se recusa a sobrescrever um `.env` existente, para não perder a `PITWALL_SECRET_KEY`. Os
valores fixos (domínios, Resend, `suporte@braatz.com.br`) já vêm preenchidos; para ajustar algo, use
`nano .env`.

### 8.7 Conferir

```bash
cd /opt/pitwall
$COMPOSE config --quiet && echo "compose ok"
grep -E '^(SMTP_PASSWORD|ANTHROPIC_API_KEY)=' .env
```

O primeiro comando deve imprimir `compose ok`. O segundo mostra as duas chaves de fora: sem a do
Resend não chegam e-mails, e sem a da Anthropic só as notas de versão ficam de fora.

---

## Parte 9 — DNS na Cloudflare (primeiro sem proxy)

O Caddy precisa que os nomes apontem direto para a VM na primeira subida, para emitir os
certificados.

1. https://dash.cloudflare.com → `braatz.com.br` → **DNS** → **Records** → **Add record**:
   - *Type*: `A`; *Name*: `pitwall-api`; *IPv4 address*: `<IP-DA-VM>`; *Proxy status*: **desligado**
     (nuvem cinza, "DNS only"); **Save**.
2. **Add record** de novo:
   - *Type*: `A`; *Name*: `pitwall`; *IPv4 address*: `<IP-DA-VM>`; *Proxy status*: **desligado**
     (nuvem cinza); **Save**.

Confira **(no seu computador)**:

```powershell
Resolve-DnsName pitwall-api.braatz.com.br
Resolve-DnsName pitwall.braatz.com.br
```

Os dois devem responder `<IP-DA-VM>`. Se ainda não responder, espere alguns minutos.

---

## Parte 10 — Subir o Pitwall

**(na VM)**

```bash
cd /opt/pitwall
$COMPOSE up -d --build
```

A primeira vez compila a API (.NET) e o console (Next.js) na própria VM: leva de 5 a 15 minutos.
Quando terminar:

```bash
$COMPOSE ps
```

Os cinco serviços devem aparecer: `postgres` (`healthy`), `seaweedfs`, `api`, `console` e `caddy` (`Up`/`running`).

Acompanhe o Caddy pegando os certificados:

```bash
$COMPOSE logs -f caddy
```

Procure por `certificate obtained successfully` para `pitwall-api.braatz.com.br` e para
`pitwall.braatz.com.br`. Saia com `Ctrl+C`.

Confira o primeiro admin:

```bash
$COMPOSE logs api | grep -i "first admin"
```

Deve aparecer `Created the first admin, <seu e-mail>.` Confira também o bucket e as fotos do login:

```bash
$COMPOSE logs api | grep -i "attachments bucket"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3200/login/pit-wall.jpg
```

Deve aparecer `Created the attachments bucket pitwall-anexos.` e `200`.

Teste a API **(no seu computador)**:

```powershell
curl.exe -sS https://pitwall-api.braatz.com.br/health
```

Resposta esperada: `{"status":"ok"}`.

Se algo falhar aqui, veja a parte 20 (problemas comuns).

---

## Parte 11 — Proteger o console (Cloudflare)

Ordem importa: primeiro o certificado (parte 10 ok), depois o proxy e o Access.

### 11.1 SSL só para o console

A zona `braatz.com.br` é a da software house; não mude o modo SSL da zona inteira (outros sites dela
podem depender do modo atual). Crie uma regra só para o console:

1. Cloudflare → `braatz.com.br` → **Rules** → **Configuration Rules** → **Create rule**.
2. *Rule name*: `Pitwall console SSL`.
3. *If incoming requests match*: **Custom filter expression** → *Field* `Hostname`, *Operator*
   `equals`, *Value* `pitwall.braatz.com.br`.
4. *Then the settings are*: **SSL** → **Add** → **Full (strict)**.
5. **Deploy**.

Não precisa mexer em *Always Use HTTPS*: o Caddy renova o certificado mesmo com o redirecionamento da
Cloudflare.

### 11.2 Ligar o proxy só no console

Cloudflare → **DNS** → **Records** → registro `pitwall` → **Edit** → *Proxy status*: **ligado**
(nuvem laranja) → **Save**.

O registro `pitwall-api` **continua cinza**.

### 11.3 Aceitar o console só pela Cloudflare

Sem isso, alguém que acesse o IP da VM direto, com o nome `pitwall.braatz.com.br`, passaria por
fora do Access.

**(na VM)**

```bash
cd /opt/pitwall
CF_IPS=$( { curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6; echo; } | tr -s '\n' ' ' | sed 's/ $//')
echo "$CF_IPS"
```

Deve imprimir umas 20 faixas de IP separadas por espaço (`173.245.48.0/20 103.21.244.0/22 …`). Se
imprimir vazio, não continue: rode de novo.

```bash
echo "PITWALL_CONSOLE_ALLOWED_IPS=\"$CF_IPS\"" >> .env
grep PITWALL_CONSOLE_ALLOWED_IPS .env
$COMPOSE up -d caddy
```

Confira **(no seu computador)**. Pelo nome (via Cloudflare) responde; pelo IP direto, não:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://pitwall.braatz.com.br/login
curl.exe -sk -o NUL -w "%{http_code}`n" --resolve pitwall.braatz.com.br:443:<IP-DA-VM> https://pitwall.braatz.com.br/login
```

O primeiro dá `200` (ou `302`, depois do 11.4); o segundo tem que dar `403`.

A Cloudflare raramente muda essas faixas. Se um dia o console começar a dar 403 para você, repita
este passo (apague antes a linha antiga com `nano .env`).

### 11.4 Cloudflare Access (login antes do console)

1. Abra https://one.dash.cloudflare.com (Cloudflare **Zero Trust**). Na primeira vez, escolha um
   *team name* (qualquer, por exemplo `ivobraatz`) e o plano **Free** (até 50 usuários).

**Antes da aplicação: ativar o login por código no e-mail (One-time PIN).** Ele não vem ativo; sem
isso, a aplicação só oferece a opção "Cloudflare".

2. No Zero Trust, no menu à esquerda: **Integrations** → **Identity providers**. (Não é em
   *Settings*/*Access settings*: lá ficam só os métodos de MFA.)
3. Em *Your identity providers*, **Add new identity provider** → **One-time PIN**. Ele passa a
   aparecer na lista de provedores.

**A aplicação**

4. **Access** → **Applications** → **Add an application** → **Self-hosted**.
5. *Application name*: `Pitwall console`; *Session Duration*: `24 hours`.
6. **Add public hostname**: *Subdomain* `pitwall`, *Domain* `braatz.com.br`, *Path* vazio.
   **Não** adicione o `pitwall-api`.
7. Avance até **Policies** → **Add a policy**:
   - *Policy name*: `Equipe`; *Action*: **Allow**;
   - *Include* → *Selector*: **Emails** → *Value*: o seu e-mail (e o de quem mais for da equipe).
8. *Login methods*: desligue **Accept all available identity providers** e marque só
   **One-time PIN**. Se a lista ainda mostrar só "Cloudflare", salve a aplicação assim mesmo, faça
   os passos 2 e 3 e depois volte em **Access** → **Applications** → `Pitwall console` → **Edit** →
   *Login methods* para marcar o One-time PIN.
9. Salve (**Save application**).

Confira: numa **janela anônima**, abra `https://pitwall.braatz.com.br`. Deve aparecer a tela da
Cloudflare pedindo e-mail; um código chega no seu e-mail; depois aparece o login do Pitwall.

---

## Parte 12 — Primeiro login e 2FA

1. Em `https://pitwall.braatz.com.br`, passe pelo Access e entre com `PITWALL_ADMIN_EMAIL` e
   `PITWALL_ADMIN_PASSWORD`.
2. Como `PITWALL_REQUIRE_TOTP=true`, aparece um aviso pedindo o 2FA: clique em **Ir para Conta**
   (ou no menu **Conta e equipe**) → **Ativar autenticador** → escaneie o QR code no app autenticador (1Password, Google
   Authenticator…) → digite o **Código do autenticador** → **Confirmar**. Guarde o segredo também no
   gerenciador de senhas.
3. Saia e entre de novo para conferir que o código é pedido.

Agora tire a senha inicial do servidor **(na VM)**:

```bash
cd /opt/pitwall
sed -i 's|^PITWALL_ADMIN_EMAIL=.*|PITWALL_ADMIN_EMAIL=|; s|^PITWALL_ADMIN_PASSWORD=.*|PITWALL_ADMIN_PASSWORD=|' .env
grep '^PITWALL_ADMIN' .env
$COMPOSE up -d api
```

O `grep` deve mostrar as duas linhas vazias. (Mudança no `.env` exige `up -d`; `restart` não lê o
arquivo de novo.)

Mais pessoas: **Conta e equipe** → **Adicionar pessoa**. Lembre de incluir o e-mail delas na
política do Access (11.4, passo 5).

---

## Parte 13 — Cadastrar os três sistemas

Repita para **DataRunner**, **RH Flex** e **metrifree**. Tenha o gerenciador de senhas aberto: chaves
e segredos aparecem **uma vez só**.

### 13.1 Criar o sistema

**Sistemas** → **Novo sistema**:

| Sistema | Slug | Nome |
|---|---|---|
| DataRunner | `datarunner` | DataRunner |
| RH Flex | `rhflex` | RH Flex |
| metrifree | `metrifree` | metrifree |

O slug do DataRunner precisa ser exatamente `datarunner` (o importador da parte 17 procura por ele).
**Criar**, depois abra o sistema na lista.

### 13.2 Ajustar o sistema

No cartão **Geral**:

- *Nome da equipe para o cliente*: como o cliente vê quem responde (por exemplo `Equipe DataRunner`).
- *Tela do chamado no sistema*: o endereço da página do chamado dentro do produto, com `{id}`. Por
  exemplo DataRunner `https://app.<domínio do DataRunner>/support/view?id={id}`. (É o link usado
  nos e-mails.)
- *Idiomas das novidades*: `pt` e `en` (ou só `pt`).
- *Publicar novidades sozinho*: ligado se quiser que as notas do Haiku saiam sem revisão; desligado
  para revisar em **Novidades** antes.
- **Salvar**.

### 13.3 Chaves

No cartão **Chaves** → **Nova chave**, duas vezes:

1. *Nome* `backend`, *Escopos* **support** e **errors** → **Criar chave** → **Copiar** → guarde
   como "Pitwall – <sistema> – backend" → **Já copiei**.
2. *Nome* `ci`, *Escopos* **releases** → **Criar chave** → **Copiar** → guarde como
   "Pitwall – <sistema> – ci" → **Já copiei**.

### 13.4 Webhook

No cartão **Webhook**:

1. *URL*:

   | Sistema | URL do webhook |
   |---|---|
   | DataRunner | `https://<API do DataRunner>/api/v1/webhooks/pitwall` |
   | RH Flex | `https://<API do RH Flex>/api/v1/webhooks/pitwall` |
   | metrifree | `https://<domínio do metrifree>/api/webhooks/pitwall` |

2. **Salvar** (no topo da página).
3. **Gerar segredo** → **Copiar** → guarde como "Pitwall – <sistema> – webhook" → **Já copiei**.
4. O botão **Testar** só vai dar certo depois que o sistema estiver com as variáveis da parte 14 e
   com a branch `feat/pitwall` no ar.

---

## Parte 14 — Ligar cada sistema ao Pitwall

### 14.1 Variáveis no servidor de cada sistema

No painel de onde cada sistema roda (Railway, por exemplo → serviço da API → **Variables**):

| Sistema | Variável | Valor |
|---|---|---|
| DataRunner (API) | `Pitwall__BaseUrl` | `https://pitwall-api.braatz.com.br` |
| | `Pitwall__ApiKey` | chave "DataRunner – backend" |
| | `Pitwall__WebhookSecret` | segredo "DataRunner – webhook" |
| RH Flex (API) | `Pitwall__BaseUrl` | `https://pitwall-api.braatz.com.br` |
| | `Pitwall__ApiKey` | chave "RH Flex – backend" |
| | `Pitwall__WebhookSecret` | segredo "RH Flex – webhook" |
| metrifree | `PITWALL_URL` | `https://pitwall-api.braatz.com.br` |
| | `PITWALL_KEY` | chave "metrifree – backend" |
| | `PITWALL_WEBHOOK_SECRET` | segredo "metrifree – webhook" |

### 14.2 Secrets e variáveis no GitHub de cada sistema (novidades)

**(no seu computador)**, com o `gh` logado. Cada comando pede para colar o valor (cole a chave "ci"
do sistema e aperte Enter):

```powershell
gh secret set PITWALL_RELEASE_KEY -R ivobraatz/DataRunner
gh variable set PITWALL_URL -R ivobraatz/DataRunner --body "https://pitwall-api.braatz.com.br"

gh secret set PITWALL_RELEASE_KEY -R ivobraatz/rhflex
gh variable set PITWALL_URL -R ivobraatz/rhflex --body "https://pitwall-api.braatz.com.br"

gh secret set PITWALL_RELEASE_KEY -R ivobraatz/metrifree
gh variable set PITWALL_URL -R ivobraatz/metrifree --body "https://pitwall-api.braatz.com.br"
```

O RH Flex usa também a variável `PITWALL_FIRST_COMMIT` no workflow de novidades (o commit a partir do
qual as notas começam); defina-a se quiser limitar o histórico da primeira nota.

### 14.3 Publicar a integração

As integrações estão nas branches `feat/pitwall` de cada repositório. Faça o merge e o deploy de
cada sistema (o RH Flex depois da `console/novo-shell`). No DataRunner, siga logo depois a parte 17.

### 14.4 Conferir

Para cada sistema:

1. No Pitwall, no sistema → **Webhook** → **Testar**: a entrega aparece em *Entregas recentes* como
   entregue.
2. No produto, logado como cliente: **Relatar um problema** → abra um chamado de teste.
3. No console do Pitwall, o chamado aparece em **Chamados**; responda.
4. No produto, a resposta aparece (e, no DataRunner, chega a notificação).
5. Anexe um print no chamado de teste e veja se ele abre no console. Se o anexo falhar, veja
   `$COMPOSE logs api | grep -iE "s3|bucket"` e `$COMPOSE logs seaweedfs`. Vídeos entram pela conversa do
   chamado; o formulário de abertura aceita só imagens. Nos produtos em .NET, o limite de 90 MB só
   vale depois de atualizar o pacote `Pitwall.AspNetCore`; antes disso, o limite deles continua 27 MB.
6. Feche o chamado de teste.

---

## Parte 15 — Backups

### 15.1 Backup diário do banco e dos anexos

O `deploy/backup.sh` grava em `/opt/pitwall/backups`: o dump do banco (14 dias) e um espelho dos
anexos, em `anexos/`. Um anexo apagado no Pitwall vai para `anexos-apagados/` e fica 30 dias. O
espelho ocupa no disco o mesmo que os anexos, então acompanhe o espaço com `df -h /`.

**(na VM)**

```bash
mkdir -p /opt/pitwall/backups
bash /opt/pitwall/deploy/backup.sh
ls /opt/pitwall/backups
```

O script termina com `anexos copiados para /opt/pitwall/backups/anexos`. Agende para toda madrugada:

```bash
(crontab -l 2>/dev/null; echo "15 3 * * * bash /opt/pitwall/deploy/backup.sh >> /opt/pitwall/backups/backup.log 2>&1") | crontab -
crontab -l
```

### 15.2 Copiar para a sua máquina

**Sem este passo, um problema na VM leva os backups junto.**

**(na sua máquina de backup)** Crie uma chave só para isso e mostre a parte pública:

```bash
sudo apt -y install rsync
ssh-keygen -t ed25519 -f ~/.ssh/pitwall-backup -N ""
cat ~/.ssh/pitwall-backup.pub
```

**(na VM)** Autorize essa chave a apenas ler a pasta de backups. Troque `<CHAVE PÚBLICA>` pela linha
mostrada acima:

```bash
sudo apt -y install rsync
echo 'command="/usr/bin/rrsync -ro /opt/pitwall/backups",restrict <CHAVE PÚBLICA>' >> ~/.ssh/authorized_keys
```

**(na sua máquina de backup)** Faça a primeira cópia e agende para depois do backup da VM. Troque
`<IP-DA-VM>`:

```bash
mkdir -p ~/pitwall-backups
rsync -a --partial -e "ssh -i ~/.ssh/pitwall-backup" ubuntu@<IP-DA-VM>:./ ~/pitwall-backups/
ls ~/pitwall-backups
(crontab -l 2>/dev/null; echo '45 4 * * * rsync -a --partial -e "ssh -i ~/.ssh/pitwall-backup" ubuntu@<IP-DA-VM>:./ ~/pitwall-backups/ && find ~/pitwall-backups -maxdepth 1 -name "pitwall-*.dump" -mtime +90 -delete') | crontab -
```

O `ls` deve mostrar o dump e a pasta `anexos`. A cópia não apaga nada do que já recebeu. Os dumps são
guardados por 90 dias, e os anexos ficam até você removê-los. A pasta contém dados de clientes, então
use uma máquina protegida, com o disco criptografado.

Uma vez por mês, confira se o dump mais recente é de hoje ou de ontem: `ls -lt ~/pitwall-backups | head`.

### 15.3 Backup do disco da VM (Oracle)

1. Oracle → **Storage** → **Block Storage** → **Boot Volumes** → volume da instância `pitwall`.
2. **Backup policies** → **Assign** → **Bronze** (mensal) → **Assign**.
   (O Always Free inclui 5 backups de volume.)

### 15.4 Restaurar (quando precisar)

```bash
$COMPOSE stop api
$COMPOSE exec -T postgres pg_restore -U pitwall -d pitwall --clean --if-exists --no-owner < /opt/pitwall/backups/pitwall-AAAA-MM-DD.dump
$COMPOSE up -d api
```

Lembre: o backup só abre com a mesma `PITWALL_SECRET_KEY` (parte 8.6).

Se a VM ou o volume dos anexos se perdeu, suba o Pitwall (a API recria o bucket vazio) e traga os
arquivos de volta. **(na sua máquina de backup, com a sua chave SSH de administrador)**:

```bash
rsync -a ~/pitwall-backups/ ubuntu@<IP-DA-VM>:/opt/pitwall/backups/
```

**(na VM)** Restaure o banco como acima e depois os anexos:

```bash
$COMPOSE --profile backup run --rm --no-deps rclone copy /backups/anexos bucket:pitwall-anexos
```

---

## Parte 16 — Monitoramento

Se o Pitwall cair, os sistemas não conseguem abrir chamados. Crie um monitor externo gratuito:

1. https://uptimerobot.com → crie a conta → **New monitor**.
2. *Monitor type*: **HTTP(s)**; *URL*: `https://pitwall-api.braatz.com.br/health`; *Interval*: 5 minutos;
   alerta pelo seu e-mail → **Create monitor**.

(Não monitore o console: o Access bloqueia o robô, e a API já cobre o servidor.)

Para olhar os logs quando quiser **(na VM)**:

```bash
$COMPOSE ps
$COMPOSE logs --tail=200 api
$COMPOSE logs --tail=200 console
$COMPOSE logs --tail=200 caddy
```

---

## Parte 17 — Importar o histórico de chamados do DataRunner (uma vez)

Faça logo depois do deploy do DataRunner com a branch `feat/pitwall` (esse deploy renomeia as tabelas
antigas para `legacy_*`; entre um e outro, os chamados antigos ficam invisíveis para o cliente).

Você vai precisar: a connection string do Postgres do DataRunner (Railway → Postgres → **Connect** →
URL pública) e as credenciais do bucket R2 onde o DataRunner guarda anexos.

**(na VM)** Crie o arquivo de credenciais temporário:

```bash
nano /opt/pitwall/import.env
```

Conteúdo (troque os `< >`; se a senha tiver espaço, `$`, `&`, `;` ou aspas, envolva o valor inteiro
da linha em aspas simples):

```dotenv
Import__SourceConnectionString=Host=<host>;Port=<porta>;Database=<banco>;Username=<usuário>;Password=<senha>
Import__SourceStorage__Provider=s3
Import__SourceStorage__ServiceUrl=https://<account-id>.r2.cloudflarestorage.com
Import__SourceStorage__Bucket=<bucket do DataRunner>
Import__SourceStorage__AccessKey=<access key>
Import__SourceStorage__SecretKey=<secret key>
```

```bash
chmod 600 /opt/pitwall/import.env
cd /opt/pitwall
```

**Simulação** (não grava nada):

```bash
$COMPOSE run --rm --env-from-file /opt/pitwall/import.env api import-datarunner --dry-run
```

A última linha mostra quantos chamados, mensagens, anexos (e anexos sem arquivo), erros e itens
pulados. Confira se bate com o que o DataRunner tinha.

**Importação de verdade:**

```bash
$COMPOSE run --rm --env-from-file /opt/pitwall/import.env api import-datarunner
```

**Limpeza:**

```bash
rm -f /opt/pitwall/import.env
```

Confira no console: **Chamados**, filtrando pelo sistema DataRunner. Rodar de novo não duplica nada.

---

## Parte 18 — Atualizar o Pitwall

Depois da parte 19, isto acontece sozinho; os comandos abaixo são para atualizar à mão (ou
entender o que o automático faz).

Quando houver mudanças novas na `main` **(na VM)**:

```bash
cd /opt/pitwall
git log --oneline -1
$COMPOSE exec -T postgres pg_dump -U pitwall -Fc pitwall > /opt/pitwall/backups/antes-da-atualizacao.dump
git pull
$COMPOSE up -d --build
$COMPOSE ps
curl -sS https://pitwall-api.braatz.com.br/health
```

As migrações do banco rodam sozinhas quando a API sobe.

O primeiro `git log` mostra o commit em uso antes de atualizar; anote-o.

**Voltar** para ele, se a atualização der errado:

```bash
cd /opt/pitwall
git checkout <commit anotado>
$COMPOSE up -d --build
```

Depois, para seguir a `main` de novo: `git switch main`.

Se a versão nova tiver mudado o banco, restaure também o `antes-da-atualizacao.dump` (parte 15.4).

---

## Parte 19 — Atualização automática (CI/CD)

Com isto, todo commit que entra na `main` do Pitwall e **passa no CI** do GitHub chega sozinho na
VM em até uns 5 minutos depois do CI terminar. Você não precisa entrar na VM para atualizar.

**Como funciona.** Quem pergunta é a VM, não o GitHub: a cada 5 minutos um timer do sistema roda o
`deploy/auto-update.sh`, que:

1. busca a `main` no GitHub; se não há commit novo, não faz nada;
2. consulta o resultado do workflow **CI** daquele commit; só segue se terminou com sucesso
   (se ainda está rodando, espera a próxima volta; se falhou, ignora esse commit). O CI sobe este
   mesmo `docker-compose.prod.yml`, anexa um vídeo de verdade no SeaweedFS e testa o backup (job `prod-stack`);
3. faz um dump do banco em `/opt/pitwall/backups/antes-de-<commit>.dump` (guarda os 5 últimos);
4. atualiza o código e roda `docker compose up -d --build` (as migrações rodam quando a API sobe);
5. confere a saúde da API e do console por até 3 minutos;
6. se a versão nova não subir, **volta o código para a anterior**, sobe de novo e marca o commit
   como falho (ele não é tentado de novo; o próximo commit é).

Por isso o GitHub não precisa de acesso à VM: nenhuma chave SSH do servidor fica em lugar nenhum e a
porta 22 continua só para você.

### 19.1 Conferir a VM

**(na VM)**

```bash
cd /opt/pitwall
git branch --show-current
git status --short
```

- O primeiro comando tem que imprimir `main`. Se imprimir vazio (você está numa tag ou num commit
  solto), rode `git switch main`.
- O segundo não pode listar arquivos com `M` na frente (mudanças locais em arquivos do
  repositório). O `.env` e a pasta `backups/` não aparecem: eles são ignorados pelo git.

Traga a versão mais nova uma vez à mão, para o script e os arquivos do timer existirem na VM:

```bash
git pull
$COMPOSE up -d --build
```

### 19.2 Instalar o que o script usa

```bash
sudo apt -y install jq
ls -l /opt/pitwall/deploy/auto-update.sh
```

O `ls` deve mostrar `-rwxr-xr-x` (executável). Se não mostrar o `x`, rode
`chmod +x /opt/pitwall/deploy/auto-update.sh`.

### 19.3 Testar sem mudar nada

```bash
/opt/pitwall/deploy/auto-update.sh --dry-run
```

Respostas possíveis, todas normais:

| Mensagem | Significado |
|---|---|
| `nada novo (abc1234)` | a VM já está no commit mais novo da `main` |
| `atualizando abc1234 → def5678: …` e `(dry-run) pararia aqui` | há versão nova com CI verde; sem o `--dry-run`, ela seria instalada |
| `CI de def5678 ainda não terminou (in_progress null)` | o CI do commit novo ainda está rodando |

Se aparecer `command not found: jq`, volte ao 19.2.

### 19.4 Ligar o timer

```bash
sudo cp /opt/pitwall/deploy/systemd/pitwall-update.service /etc/systemd/system/
sudo cp /opt/pitwall/deploy/systemd/pitwall-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pitwall-update.timer
systemctl list-timers pitwall-update.timer
```

O último comando mostra a próxima execução (coluna `NEXT`), em até 5 minutos.

Rode uma vez agora, para ver funcionando:

```bash
sudo systemctl start pitwall-update.service
journalctl -u pitwall-update.service -n 20 --no-pager
```

Se não havia nada novo, o `journalctl` não mostra mensagem do script (ele só escreve quando há o que
fazer); aparece apenas `Finished pitwall-update.service`.

### 19.5 O dia a dia

- **Publicar uma atualização:** faça commit e push na `main` do Pitwall (ou merge de um PR). O CI
  roda no GitHub (uns 5 minutos); em até 5 minutos depois de ele ficar verde, a VM atualiza. Uma
  atualização com build leva de 5 a 15 minutos na VM, durante os quais o Pitwall continua no ar com
  a versão anterior até os containers novos subirem.
- **Ver o que aconteceu:**

  ```bash
  journalctl -u pitwall-update.service --since today --no-pager
  ```

- **Forçar uma verificação agora:** `sudo systemctl start pitwall-update.service`.
- **Pausar as atualizações automáticas** (por exemplo antes de mexer à mão no servidor):

  ```bash
  sudo systemctl stop pitwall-update.timer
  ```

  e para voltar: `sudo systemctl start pitwall-update.timer`.
- **Um commit foi marcado como falho e você corrigiu o problema no servidor** (não no código):
  apague a marca para ele ser tentado de novo:

  ```bash
  rm -f /opt/pitwall/.deploy-failed
  sudo systemctl start pitwall-update.service
  ```

  Se o problema era no código, basta mandar um commit novo com a correção.
- **Voltar o banco** depois de uma atualização que mudou o banco e deu errado: os dumps
  `antes-de-<commit>.dump` ficam em `/opt/pitwall/backups/`; restaure como na parte 15.4.

### 19.6 Ser avisado quando der errado

O monitor do UptimeRobot (parte 16) avisa se o Pitwall sair do ar. Para saber também de uma
atualização que voltou sozinha para a versão anterior, olhe o `journalctl` do 19.5 de vez em quando,
ou procure por `não subiu` e `ATENÇÃO`:

```bash
journalctl -u pitwall-update.service --since "7 days ago" --no-pager | grep -E "não subiu|ATENÇÃO|não atualizo"
```

---

## Parte 20 — Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `ssh` dá timeout | IP errado, ou a VM não está *Running*. Confira na página da instância |
| `curl https://api…/health` dá timeout | Falta a regra 80/443 na Security List (parte 4) **ou** no iptables (parte 5.3). Precisa das duas |
| Caddy não pega o certificado | DNS ainda não aponta para a VM (`Resolve-DnsName`), nuvem laranja ligada antes da emissão (parte 9 pede cinza), ou porta 80 fechada. Veja `$COMPOSE logs caddy`. O Let's Encrypt limita tentativas: espere 10 minutos e rode `$COMPOSE restart caddy` |
| Console dá 403 pelo navegador | O DNS do `pitwall` está cinza (sem proxy) mas o 11.3 já foi aplicado: ligue a nuvem laranja. Ou as faixas da Cloudflare mudaram: refaça o 11.3 |
| Erro 526 da Cloudflare no console | Regra *Full (strict)* do 11.1 ativa, mas o Caddy ainda sem certificado: confira o 10 (certificado emitido) |
| Erro 525 ou loop de redirecionamento no console | A regra do 11.1 não pegou e a zona está em *Flexible*: confira o *Hostname* da regra (`pitwall.braatz.com.br`) |
| `api` reiniciando em loop | `$COMPOSE logs api`. Normalmente `.env` incompleto (`PITWALL_SECRET_KEY` vazio) ou Postgres ainda subindo |
| Não chega e-mail | Dados de SMTP ou remetente não verificado no provedor. Veja `$COMPOSE logs api \| grep -i smtp` |
| "Out of capacity" ao criar a VM | Sem ARM livre na região: outro *availability domain*, outro horário, ou conta Pay As You Go |
| A VM parou sozinha depois de dias | Recuperação de VM ociosa: passe a conta para Pay As You Go (1.2) e ligue a VM de novo |
| Depois de reiniciar a VM o site não volta | `sudo iptables -L INPUT -n` (as regras do 5.3 continuam?) e `$COMPOSE ps`; se precisar, `sudo systemctl restart docker && $COMPOSE up -d` |
| Webhook **Testar** falha | O sistema ainda não tem `…WebhookSecret`/`PITWALL_WEBHOOK_SECRET` igual ao gerado, ou a branch `feat/pitwall` ainda não está no ar, ou a URL está errada |
| A VM não atualizou depois do push | `journalctl -u pitwall-update.service -n 50 --no-pager`. Causas comuns: CI vermelho ou ainda rodando, commit marcado em `.deploy-failed` (parte 19.5), mudanças locais no servidor (`git status`), timer parado (`systemctl list-timers`) |
| `required variable SEAWEEDFS_ACCESS_KEY is missing` | `.env` de antes do SeaweedFS: acrescente as linhas de "Já tem uma VM do Pitwall?", no início do guia |
| `api` reiniciando e o log fala em bucket | O SeaweedFS não respondeu ou a chave do `.env` está errada. Veja `$COMPOSE logs seaweedfs` |
| Fotos do login dão 404 | O console está numa imagem antiga: `$COMPOSE up -d --build console` |
| Console mostra 401 em `/v1/staff/auth/login` | É a resposta normal a senha errada ou a login que ainda precisa do código 2FA; a tela pede o código em seguida. Só o navegador registra isso como erro |
| Console mostra `ERR_BLOCKED_BY_CLIENT` | Uma extensão do navegador (bloqueador de anúncios) barrou um script, normalmente o de análise da Cloudflare. Não afeta o Pitwall |
| Vídeo recusado com 413 | Passou de 90 MB. Acima de 100 MB, a própria Cloudflare recusa antes de chegar ao Pitwall |

---

## Parte 21 — Checklist final

- [ ] Conta Oracle em Pay As You Go, com orçamento de US$ 1 e alerta.
- [ ] VM `pitwall` (A1.Flex, Ubuntu 24.04 aarch64) com portas 80/443 na Security List e no iptables.
- [ ] Docker instalado, logs limitados, `$COMPOSE` no `~/.bashrc`.
- [ ] `.env` com `chmod 600`; todas as chaves da parte 8 no item "Pitwall produção" do gerenciador de senhas.
- [ ] `https://pitwall-api.braatz.com.br/health` responde `{"status":"ok"}`; DNS do `pitwall-api` cinza.
- [ ] DNS do `pitwall` laranja, regra *Full (strict)* só para `pitwall.braatz.com.br`, `PITWALL_CONSOLE_ALLOWED_IPS` aplicado (IP direto dá 403).
- [ ] Cloudflare Access pedindo e-mail antes do console.
- [ ] Primeiro login, 2FA ativo, `PITWALL_ADMIN_*` vazios no `.env` e `api` recriado.
- [ ] DataRunner, RH Flex e metrifree cadastrados, cada um com chave `backend`, chave `ci` e webhook.
- [ ] Variáveis em cada sistema e `PITWALL_RELEASE_KEY` / `PITWALL_URL` no GitHub de cada um.
- [ ] SeaweedFS no ar, bucket `pitwall-anexos` criado (`$COMPOSE logs api | grep -i "attachments bucket"`) e o print de teste abrindo no console.
- [ ] Backups: cron do `deploy/backup.sh`, cópia em outra máquina (15.2), política do boot volume.
- [ ] Monitor do UptimeRobot no `/health`.
- [ ] Timer `pitwall-update.timer` ativo (`systemctl list-timers pitwall-update.timer`).
- [ ] Importação do DataRunner feita e `import.env` apagado.

---

## Apêndice A — Anexos em outro bucket (S3 ou R2), sem SeaweedFS

Faça a escolha antes de ter anexos: trocar depois não move os arquivos que já existem. Crie o bucket
você mesmo, privado, e acrescente ao `.env` **(na VM)**:

```dotenv
STORAGE_CREATE_BUCKET=false
STORAGE_BUCKET=pitwall-anexos
STORAGE_SERVICE_URL=https://<ACCOUNT-ID>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY=<Access Key ID>
STORAGE_SECRET_KEY=<Secret Access Key>
```

Depois, `$COMPOSE up -d api`. O container do SeaweedFS continua de pé, sem uso. O `deploy/backup.sh` só
sabe copiar o SeaweedFS: comente a etapa do `rclone` nele e cuide do backup dos anexos no próprio bucket.
