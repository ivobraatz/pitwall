# Deploy do Pitwall no Oracle Cloud Always Free — passo a passo completo

Este guia leva o Pitwall do zero até produção numa VM gratuita da Oracle (Ampere A1, ARM), com
Docker Compose, Postgres, a API, o console e o Caddy (HTTPS automático), o console protegido pelo
Cloudflare Access, backups e monitoramento. Cada passo tem o comando exato e como conferir que deu
certo. Faça na ordem.

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

A regra da porta 22 (SSH) já existe. **Não** abra 5180, 3200 nem 5432.

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

## Parte 8 — Chaves e o arquivo `.env`

O `.env` guarda tudo que o Pitwall precisa. Antes de preenchê-lo, você vai buscar cada chave no
serviço de onde ela vem. Abra o gerenciador de senhas e crie um item **"Pitwall produção"**: cada
valor abaixo vai para lá assim que aparecer (vários aparecem uma vez só).

| Variável do `.env`                                                                  | De onde vem                 | Passo |
| ----------------------------------------------------------------------------------- | --------------------------- | ----- |
| `POSTGRES_PASSWORD`, `PITWALL_SECRET_KEY`                                           | gerados na VM               | 8.1   |
| `SMTP_PASSWORD`                                                                     | Resend                      | 8.2   |
| `PITWALL_INBOX_EMAIL`                                                               | Email Routing da Cloudflare | 8.3   |
| `STORAGE_BUCKET`, `STORAGE_SERVICE_URL`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | Cloudflare R2               | 8.4   |
| `ANTHROPIC_API_KEY`                                                                 | Anthropic                   | 8.5   |
| `PITWALL_ADMIN_EMAIL`, `PITWALL_ADMIN_PASSWORD`                                     | você escolhe                | 8.6   |
| `PITWALL_CONSOLE_URL` = `https://pitwall.braatz.com.br` | valor fixo: endereço do console, usado nos links dos e-mails | 8.7 |
| `PITWALL_REQUIRE_TOTP` = `true` | valor fixo: obriga o 2FA para a equipe | 8.7 |
| `PITWALL_API_DOMAIN` = `pitwall-api.braatz.com.br`, `PITWALL_CONSOLE_DOMAIN` = `pitwall.braatz.com.br` | valores fixos: os nomes para os quais o Caddy emite certificado | 8.7 |
| `SMTP_HOST` = `smtp.resend.com`, `SMTP_PORT` = `587`, `SMTP_USER` = `resend`, `SMTP_FROM` = `"Pitwall <pitwall@braatz.com.br>"` | valores fixos do Resend | 8.7 |
| `PITWALL_CONSOLE_ALLOWED_IPS` | faixas de IP da Cloudflare, acrescentadas por comando mais tarde | 11.3 |
| `PITWALL_STAFF_HOSTS` | não precisa: o padrão (`api`) já é o certo para este deploy | — |

Os valores fixos já estão escritos no `.env` completo do passo 8.7: é só copiar.

### 8.1 Gerar as senhas internas (na VM)

**(na VM)**

```bash
cd /opt/pitwall
cp .env.example .env
chmod 600 .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^PITWALL_SECRET_KEY=.*|PITWALL_SECRET_KEY=$(openssl rand -base64 32)|" .env
grep -E '^(POSTGRES_PASSWORD|PITWALL_SECRET_KEY)=' .env
```

O último comando mostra os dois valores gerados. **Copie os dois para o item "Pitwall produção"
agora:**

- `PITWALL_SECRET_KEY`: **nunca pode mudar nem se perder.** Ela cifra os segredos de webhook e as
  sementes do 2FA guardadas no banco. Sem ela, um backup do banco não serve para nada.
- `POSTGRES_PASSWORD`: a senha do banco do Pitwall. Só vale na primeira subida (é quando o banco é
  criado).

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

### 8.4 Cloudflare R2: onde ficam os anexos (`STORAGE_*`)

Os prints e as gravações de tela dos chamados ficam num bucket **privado** do R2 (o gratuito do R2
cobre 10 GB). Aqui você cria dois buckets, um para os anexos e outro para os backups (parte 15), e
uma chave de acesso que só enxerga esses dois.

**Criar os buckets**

1. https://dash.cloudflare.com → menu à esquerda **R2 Object Storage** → **Overview**.
2. Anote o **Account ID** que aparece à direita da página (em *Account details*). É um código de 32
   letras e números. Ao longo do guia ele é `<ACCOUNT-ID>`.
3. **Create bucket** → *Bucket name* `pitwall-anexos` → *Location* **Automatic** → *Default storage
   class* **Standard** → **Create bucket**.
   - **Não** ative acesso público (*Public access* fica desligado, que é o padrão).
   - **Não** escolha *jurisdiction* (EU/FedRAMP): ela muda o endereço do bucket.
4. Volte para **R2 Object Storage** → **Create bucket** → `pitwall-backups`, com as mesmas opções.

**Criar a chave de acesso**

5. Em **R2 Object Storage** → **Overview**, clique em **API** (ou **Manage API tokens**, conforme a
   versão do painel) → **Create Account API token** (se só houver **Create API token**, use esse).
6. Preencha:
   - *Token name*: `pitwall`
   - *Permissions*: **Object Read & Write**
   - *Specify bucket(s)*: **Apply to specific buckets only** → selecione `pitwall-anexos` e
     `pitwall-backups`
   - *TTL*: **Forever**
   - *Client IP Address Filtering*: opcional. Se quiser, *Include* o `<IP-DA-VM>` (só a VM consegue
     usar a chave; se um dia o IP da VM mudar, atualize aqui).
7. **Create API Token**. A tela seguinte mostra os valores **uma vez**. Copie para o gerenciador de
   senhas:
   - **Access Key ID** → vai em `STORAGE_ACCESS_KEY`
   - **Secret Access Key** → vai em `STORAGE_SECRET_KEY`
   - o endereço em *Use jurisdiction-specific endpoints for S3 clients* (ou *S3 API*), no formato
     `https://<ACCOUNT-ID>.r2.cloudflarestorage.com` → vai em `STORAGE_SERVICE_URL`, **sem** nome
     de bucket no final.

   (O *Token value* não é usado.)

Os valores do `.env` ficam:

```dotenv
STORAGE_PROVIDER=s3
STORAGE_BUCKET=pitwall-anexos
STORAGE_SERVICE_URL=https://<ACCOUNT-ID>.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY=<Access Key ID>
STORAGE_SECRET_KEY=<Secret Access Key>
```

### 8.5 Anthropic: notas de versão (`ANTHROPIC_API_KEY`)

O Claude Haiku escreve as notas de versão a partir dos commits. Sem essa chave o resto do Pitwall
funciona; só as notas não são escritas. Custa centavos por versão.

1. Entre em https://console.anthropic.com.
2. **Settings** → **Billing**: confira que há crédito (se não houver, **Buy credits**; US$ 5 duram
   bastante para isso).
3. **Settings** → **API Keys** → **Create Key** → *Name* `pitwall` → **Add**.
4. A chave aparece **uma vez** e começa com `sk-ant-`. Copie para o gerenciador de senhas como
   `ANTHROPIC_API_KEY`.

### 8.6 Seu login no Pitwall (`PITWALL_ADMIN_EMAIL`, `PITWALL_ADMIN_PASSWORD`)

O primeiro administrador é criado a partir destas duas linhas, na primeira subida. Depois do
primeiro login você as apaga (parte 12).

- `PITWALL_ADMIN_EMAIL`: o e-mail com que você vai entrar (por exemplo um `@braatz.com.br`). Use o
  mesmo e-mail que vai liberar no Cloudflare Access (parte 11.4).
- `PITWALL_ADMIN_PASSWORD`: gere uma senha de 24 caracteres no gerenciador de senhas, **sem o
  caractere `$`** (o Docker Compose interpreta `$` no `.env`).

### 8.7 Preencher o `.env`

**(na VM)**

```bash
cd /opt/pitwall
nano .env
```

Apague o conteúdo que veio do modelo **menos as duas linhas** `POSTGRES_PASSWORD` e
`PITWALL_SECRET_KEY` (geradas no 8.1) e deixe o arquivo assim, trocando os `< >` pelos valores que
você guardou:

```dotenv
POSTGRES_PASSWORD=<já gerado no 8.1, não mexa>
PITWALL_SECRET_KEY=<já gerado no 8.1, não mexa>
PITWALL_CONSOLE_URL=https://pitwall.braatz.com.br
PITWALL_INBOX_EMAIL=suporte@braatz.com.br
PITWALL_REQUIRE_TOTP=true
PITWALL_ADMIN_EMAIL=<8.6>
PITWALL_ADMIN_PASSWORD=<8.6>
ANTHROPIC_API_KEY=<8.5, começa com sk-ant->
STORAGE_PROVIDER=s3
STORAGE_BUCKET=pitwall-anexos
STORAGE_SERVICE_URL=https://<ACCOUNT-ID>.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY=<8.4, Access Key ID>
STORAGE_SECRET_KEY=<8.4, Secret Access Key>
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=<8.2, começa com re_>
SMTP_FROM="Pitwall <pitwall@braatz.com.br>"
PITWALL_API_DOMAIN=pitwall-api.braatz.com.br
PITWALL_CONSOLE_DOMAIN=pitwall.braatz.com.br
```

No nano, `Ctrl+K` apaga a linha onde está o cursor (útil para limpar o modelo) e o botão direito do
mouse cola no terminal. Salve com `Ctrl+O`, Enter, e saia com `Ctrl+X`.

Confira que nada ficou por preencher:

```bash
grep -n '<' .env
grep -c . .env
```

O primeiro comando só pode mostrar a linha do `SMTP_FROM` (o formato `"Pitwall <…>"` é esse mesmo).
O segundo deve mostrar `20` (vinte linhas preenchidas).

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

Os quatro serviços devem aparecer: `postgres` (`healthy`), `api`, `console` e `caddy` (`Up`/`running`).

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

Deve aparecer `Created the first admin, <seu e-mail>.`

Teste a API **(no seu computador)**:

```powershell
curl.exe -sS https://pitwall-api.braatz.com.br/health
```

Resposta esperada: `{"status":"ok"}`.

Se algo falhar aqui, veja a parte 19 (problemas comuns).

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
2. **Access** → **Applications** → **Add an application** → **Self-hosted**.
3. *Application name*: `Pitwall console`; *Session Duration*: `24 hours`.
4. **Add public hostname**: *Subdomain* `pitwall`, *Domain* `braatz.com.br`, *Path* vazio.
   **Não** adicione o `pitwall-api`.
5. Avance até **Policies** → **Add a policy**:
   - *Policy name*: `Equipe`; *Action*: **Allow**;
   - *Include* → *Selector*: **Emails** → *Value*: o seu e-mail (e o de quem mais for da equipe).
6. *Login methods*: deixe **One-time PIN** (código por e-mail) marcado.
7. Salve (**Save application**).

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
5. Anexe um print no chamado de teste. Em Cloudflare → **R2 Object Storage** → `pitwall-anexos`,
   deve aparecer a pasta `tickets/`. Se o anexo falhar, veja `$COMPOSE logs api | grep -i s3`
   (quase sempre é `STORAGE_SERVICE_URL` com o nome do bucket no fim, ou a chave sem acesso ao
   bucket).
6. Feche o chamado de teste.

---

## Parte 15 — Backups

### 15.1 Dump diário do banco

**(na VM)**

```bash
mkdir -p /opt/pitwall/backups
crontab -e
```

Se perguntar o editor, escolha `1` (nano). Cole no fim do arquivo esta linha (é uma linha só):

```cron
15 3 * * * docker compose -f /opt/pitwall/docker-compose.prod.yml exec -T postgres pg_dump -U pitwall -Fc pitwall > /opt/pitwall/backups/pitwall-$(date +\%F).dump 2>>/opt/pitwall/backups/backup.log && find /opt/pitwall/backups -name 'pitwall-*.dump' -mtime +14 -delete
```

Salve (`Ctrl+O`, Enter, `Ctrl+X`). O `\%` é obrigatório no crontab. Mantém 14 dias.

Os anexos não entram aqui: eles já estão no bucket `pitwall-anexos` do R2, fora da VM.

Teste agora, sem esperar a madrugada:

```bash
$COMPOSE exec -T postgres pg_dump -U pitwall -Fc pitwall > /opt/pitwall/backups/teste.dump
ls -lh /opt/pitwall/backups
rm /opt/pitwall/backups/teste.dump
```

O arquivo `teste.dump` deve ter tamanho maior que zero.

### 15.2 Cópia fora da Oracle (bucket R2)

Um backup no mesmo disco não protege contra perder a VM.

O bucket `pitwall-backups` e a chave de acesso já foram criados no 8.4. Use os mesmos valores
(*Access Key ID*, *Secret Access Key* e o `<ACCOUNT-ID>`).

**(na VM)**

```bash
sudo apt -y install rclone
rclone config create r2 s3 provider Cloudflare access_key_id <Access Key ID> secret_access_key <Secret Access Key> endpoint https://<ACCOUNT-ID>.r2.cloudflarestorage.com acl private
rclone copy /opt/pitwall/backups r2:pitwall-backups/pitwall
rclone ls r2:pitwall-backups
```

O último comando lista os arquivos no bucket. Agende a cópia diária:

```bash
crontab -e
```

Acrescente:

```cron
0 4 * * * rclone copy /opt/pitwall/backups r2:pitwall-backups/pitwall --max-age 48h >> /opt/pitwall/backups/backup.log 2>&1
```

Em R2 → bucket `pitwall-backups` → **Settings** → **Object lifecycle rules**, crie uma regra
apagando objetos com mais de 30 dias, se quiser limitar o espaço.

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

Lembre: o backup só abre com a mesma `PITWALL_SECRET_KEY` (parte 8.1). Os anexos continuam no R2 e
não precisam ser restaurados.

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

## Parte 19 — Problemas comuns

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

---

## Parte 20 — Checklist final

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
- [ ] Anexos no bucket privado `pitwall-anexos` do R2 (o print de teste aparece lá).
- [ ] Backups: cron do banco, cópia diária para `pitwall-backups` no R2, política do boot volume.
- [ ] Monitor do UptimeRobot no `/health`.
- [ ] Importação do DataRunner feita e `import.env` apagado.

---

## Apêndice A — Anexos no disco da VM, sem R2

Se um dia preferir não usar o R2, os anexos podem ficar no disco da VM (volume `pitwall_blobs`):

1. **(na VM)** `nano /opt/pitwall/.env` e deixe `STORAGE_PROVIDER=fs` (as outras `STORAGE_*` vazias).
2. `$COMPOSE up -d api`.
3. Inclua o volume no backup diário (`crontab -e`):

   ```cron
   30 3 * * * docker run --rm -v pitwall_blobs:/data:ro -v /opt/pitwall/backups:/backup alpine tar czf /backup/blobs-$(date +\%F).tgz -C /data . && find /opt/pitwall/backups -name 'blobs-*.tgz' -mtime +14 -delete
   ```

Faça a escolha antes de ter anexos: trocar depois não move os arquivos que já existem.
