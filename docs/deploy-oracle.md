# Deploy do Pitwall no Oracle Cloud (Always Free)

O Pitwall cabe com folga numa VM **Ampere A1** do plano Always Free da Oracle (ARM, até 4 OCPU e
24 GB de RAM sem custo). Este guia cobre só o que é próprio da Oracle: conta, instância e rede.
Do servidor pronto em diante, siga o [guia de VPS](deploy-vps.md), com as diferenças indicadas aqui.

Todas as imagens usadas (`dotnet/sdk`, `dotnet/aspnet`, `node:22-alpine`, `postgres:17-alpine`,
`caddy:2-alpine`) têm versão ARM64; o build roda direto na VM.

---

## 1. Conta: dois cuidados antes de tudo

**Região de origem (home region).** As instâncias A1 gratuitas só existem na região escolhida no
cadastro, e ela não muda depois. As regiões mais procuradas costumam ficar sem capacidade de A1
("Out of host capacity"). Se puder, escolha uma região menos disputada; a latência para o Brasil
importa pouco aqui (quem chama a API são os backends dos sistemas).

**Recuperação de instâncias ociosas.** Em contas só Free Tier, a Oracle pode recuperar uma instância
Always Free que fica ociosa por 7 dias (CPU, rede e memória baixas). O Pitwall passa a maior parte do
tempo ocioso, então isso é um risco real. A saída é passar a conta para **Pay As You Go**
(*Billing → Upgrade and Manage Payment*): os recursos Always Free continuam gratuitos, a regra de
ociosidade deixa de valer e fica mais fácil conseguir capacidade de A1. Ao fazer isso, crie um
**orçamento com alerta** (*Billing → Budgets*, por exemplo US$ 1) para ser avisado se algo sair do
gratuito.

---

## 2. Criar a instância

*Compute → Instances → Create instance*:

| Campo | Valor |
|---|---|
| Image | **Canonical Ubuntu 24.04** (a variante aarch64 aparece ao escolher o shape A1) |
| Shape | *Ampere* → **VM.Standard.A1.Flex**, 2 OCPU e 12 GB (ou 4 e 24, se não for usar a cota para mais nada) |
| Networking | crie uma VCN nova com sub-rede **pública**; marque *Assign a public IPv4 address* |
| SSH keys | envie a sua chave pública (`~/.ssh/id_ed25519.pub`) |
| Boot volume | 100 GB (o Always Free soma 200 GB de volumes) |

Se der "Out of host capacity", tente outro *availability domain* ou repita mais tarde.

Anote o IP público. O usuário padrão é `ubuntu`:

```bash
ssh ubuntu@<ip-público>
```

**IP fixo (opcional).** O IP público efêmero dura enquanto a instância existir. Se quiser um IP que
sobreviva a recriar a instância, em *Networking → Reserved public IPs* reserve um e associe à VNIC.

---

## 3. Abrir as portas 80 e 443 (dois lugares)

Na Oracle, uma porta só chega à VM se estiver liberada **na VCN e no iptables da própria VM**.

**Na VCN.** *Networking → Virtual cloud networks → (sua VCN) → Security Lists → Default Security
List → Add Ingress Rules*, duas regras:

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

A porta 22 já vem liberada. Não abra 5180, 3200 nem 5432: no compose eles ficam só em `127.0.0.1`.

**Na VM.** As imagens Ubuntu da Oracle já vêm com regras de iptables que recusam tudo além do SSH.
Faça isto **antes de instalar o Docker**, para não gravar as regras do Docker junto:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
sudo iptables -L INPUT -n --line-numbers   # as duas regras ACCEPT aparecem antes do REJECT
```

**Não use o UFW** (o passo de firewall do guia de VPS): ele briga com as regras que a Oracle já
instala. A Security List e o iptables acima fazem esse papel.

---

## 4. Seguir o guia de VPS

Com a VM acessível, siga o [deploy-vps.md](deploy-vps.md) a partir da seção 2, com estas diferenças:

- **Seção 2 (preparar o servidor):** faça a atualização do sistema e a instalação do Docker; **pule
  o bloco do UFW**. O código vem do repositório público:
  `git clone https://github.com/ivobraatz/pitwall.git /opt/pitwall`.
- **Seção 3 (`.env`):** para os anexos, o mais simples é `STORAGE_PROVIDER=fs` (ficam no volume
  `blobs`, no disco da VM, e entram no backup da seção 9) ou um bucket R2 privado (`s3`). Não use o
  Object Storage da Oracle por enquanto: a API ainda não configura a região de assinatura que a
  compatibilidade S3 da Oracle exige.
- **Seção 4 (subir):** o primeiro `up -d --build` compila a API e o console na VM ARM; leva alguns
  minutos.
- **DNS e Cloudflare:** crie os registros `A` de `api.<domínio>` e `pitwall.<domínio>` com o IP da
  VM, primeiro como **DNS only** (nuvem cinza), para o Caddy emitir os certificados. Depois de
  `curl https://api.<domínio>/health` responder, ligue a nuvem laranja **só no `pitwall.<domínio>`**
  e crie nele a aplicação do Cloudflare Access (seção 5 do guia de VPS). Deixe o SSL/TLS da zona em
  **Full (strict)** e o *Always Use HTTPS* desligado para esse host (o Caddy já redireciona para
  HTTPS e precisa da porta 80 para renovar o certificado).
- **Seção 9 (backups):** além do `pg_dump` diário, ative backups do disco da VM: *Block Storage →
  Boot Volumes → (volume da VM) → Backup policies*. O Always Free inclui 5 backups de volume. Copie os
  dumps também para fora da Oracle (um bucket R2, por exemplo).

---

## 5. Conferir

```bash
curl -sS https://api.<domínio>/health                                               # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' https://api.<domínio>/v1/staff/auth/me      # 404
```

E pelo navegador: `https://pitwall.<domínio>/login` pede o login do Cloudflare Access antes do
Pitwall.

## 6. Problemas comuns na Oracle

| Sintoma | Causa provável |
|---|---|
| `curl` para a porta 80/443 dá timeout | falta a regra na Security List **ou** no iptables (precisa dos dois) |
| Caddy não emite o certificado | DNS ainda não propagou, nuvem laranja ligada antes da emissão, ou porta 80 fechada |
| "Out of host capacity" ao criar a VM | sem A1 livre na região; tente outro availability domain, mais tarde, ou a conta Pay As You Go |
| A VM foi parada sozinha | recuperação de instância ociosa; passe a conta para Pay As You Go (seção 1) |
| Docker funcionava e parou depois de reiniciar | regras do Docker gravadas no `netfilter-persistent`; refaça a seção 3 antes do Docker, ou reinicie o serviço `docker` |
