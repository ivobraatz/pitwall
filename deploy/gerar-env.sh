#!/usr/bin/env bash
# Writes the production .env: generates every internal secret and asks only for what comes from
# outside. Refuses to overwrite an existing .env, because PITWALL_SECRET_KEY must never change.
#
#   deploy/gerar-env.sh [arquivo .env]
#
# Each value below can come from an environment variable of the same name; the script asks only for
# the ones left empty:
#
#   PITWALL_CONSOLE_DOMAIN  e.g. pitwall.example.com      (the team's console)
#   PITWALL_API_DOMAIN      e.g. pitwall-api.example.com  (the products' backends call it)
#   PITWALL_INBOX_EMAIL     e.g. suporte@example.com      (the team's inbox for new tickets)
#   SMTP_FROM_EMAIL         e.g. pitwall@example.com      (sender, on a domain verified in Resend)
#   PITWALL_ADMIN_EMAIL     the first admin's login (the same one allowed in Cloudflare Access)
#   SMTP_PASSWORD           Resend key, re_… (may stay empty)
#   ANTHROPIC_API_KEY       sk-ant-… (may stay empty)
set -euo pipefail

env_file="${1:-$(cd "$(dirname "$0")/.." && pwd)/.env}"
if [[ -e "$env_file" ]]; then
  echo "Já existe $env_file. Não vou sobrescrever: a PITWALL_SECRET_KEY dele não pode mudar." >&2
  exit 1
fi

# The variable's value when set, otherwise the answer to the question.
ask() {
  local answer="${!1:-}"
  [[ -n "$answer" ]] || read -r -p "$2: " answer
  echo "$answer"
}

domain() {
  if [[ ! "$2" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]; then
    echo "$1 precisa ser um domínio, como pitwall.example.com (sem https://)." >&2
    exit 1
  fi
}

email() {
  if [[ ! "$2" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
    echo "$1 precisa ser um e-mail, como suporte@example.com." >&2
    exit 1
  fi
}

console_domain=$(ask PITWALL_CONSOLE_DOMAIN "Domínio do console da equipe (ex.: pitwall.example.com)")
api_domain=$(ask PITWALL_API_DOMAIN "Domínio da API (ex.: pitwall-api.example.com)")
inbox_email=$(ask PITWALL_INBOX_EMAIL "E-mail da equipe, que recebe os avisos de chamado (ex.: suporte@example.com)")
from_email=$(ask SMTP_FROM_EMAIL "Remetente dos e-mails, num domínio verificado no Resend (ex.: pitwall@example.com)")
admin_email=$(ask PITWALL_ADMIN_EMAIL "Seu e-mail de login no Pitwall (o mesmo do Cloudflare Access)")
smtp_password=$(ask SMTP_PASSWORD "Chave do Resend, começa com re_ (Enter para configurar depois)")
anthropic_key=$(ask ANTHROPIC_API_KEY "Chave da Anthropic, começa com sk-ant- (Enter para não usar)")

domain "O domínio do console" "$console_domain"
domain "O domínio da API" "$api_domain"
if [[ "$console_domain" == "$api_domain" ]]; then
  echo "O console e a API precisam de domínios diferentes." >&2
  exit 1
fi
email "O e-mail da equipe" "$inbox_email"
email "O remetente" "$from_email"
email "O e-mail de login" "$admin_email"

# Hex only: Docker Compose reads $ in .env as a variable.
postgres_password=$(openssl rand -hex 24)
secret_key=$(openssl rand -base64 32)
seaweedfs_secret=$(openssl rand -hex 24)
admin_password=$(openssl rand -hex 12)

umask 077
cat > "$env_file" <<EOF
POSTGRES_PASSWORD=$postgres_password
PITWALL_SECRET_KEY=$secret_key
SEAWEEDFS_ACCESS_KEY=pitwall
SEAWEEDFS_SECRET_KEY=$seaweedfs_secret
PITWALL_CONSOLE_URL=https://$console_domain
PITWALL_INBOX_EMAIL=$inbox_email
PITWALL_REQUIRE_TOTP=true
PITWALL_ADMIN_EMAIL=$admin_email
PITWALL_ADMIN_PASSWORD=$admin_password
ANTHROPIC_API_KEY=$anthropic_key
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=$smtp_password
SMTP_FROM="Pitwall <$from_email>"
PITWALL_API_DOMAIN=$api_domain
PITWALL_CONSOLE_DOMAIN=$console_domain
EOF

cat <<EOF

$env_file criado. Copie agora para o item "Pitwall produção" do gerenciador de senhas:

  PITWALL_SECRET_KEY      $secret_key
  POSTGRES_PASSWORD       $postgres_password
  SEAWEEDFS_SECRET_KEY    $seaweedfs_secret
  PITWALL_ADMIN_PASSWORD  $admin_password

Sem a PITWALL_SECRET_KEY, um backup do banco não serve para nada.
EOF
