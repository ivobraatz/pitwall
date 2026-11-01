#!/usr/bin/env bash
# Writes the production .env: generates every internal secret and asks only for what comes from
# outside. Refuses to overwrite an existing .env, because PITWALL_SECRET_KEY must never change.
#
#   deploy/gerar-env.sh
set -euo pipefail

env_file="${1:-$(cd "$(dirname "$0")/.." && pwd)/.env}"
if [[ -e "$env_file" ]]; then
  echo "Já existe $env_file. Não vou sobrescrever: a PITWALL_SECRET_KEY dele não pode mudar." >&2
  exit 1
fi

ask() { local answer; read -r -p "$1: " answer; echo "$answer"; }

admin_email=$(ask "Seu e-mail de login no Pitwall (o mesmo do Cloudflare Access)")
smtp_password=$(ask "Chave do Resend, começa com re_ (Enter para configurar depois)")
anthropic_key=$(ask "Chave da Anthropic, começa com sk-ant- (Enter para não usar)")
if [[ -z "$admin_email" || "$admin_email" != *@* ]]; then
  echo "O e-mail de login é obrigatório." >&2
  exit 1
fi

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
PITWALL_CONSOLE_URL=https://pitwall.braatz.com.br
PITWALL_INBOX_EMAIL=suporte@braatz.com.br
PITWALL_REQUIRE_TOTP=true
PITWALL_ADMIN_EMAIL=$admin_email
PITWALL_ADMIN_PASSWORD=$admin_password
ANTHROPIC_API_KEY=$anthropic_key
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=$smtp_password
SMTP_FROM="Pitwall <pitwall@braatz.com.br>"
PITWALL_API_DOMAIN=pitwall-api.braatz.com.br
PITWALL_CONSOLE_DOMAIN=pitwall.braatz.com.br
EOF

cat <<EOF

$env_file criado. Copie agora para o item "Pitwall produção" do gerenciador de senhas:

  PITWALL_SECRET_KEY      $secret_key
  POSTGRES_PASSWORD       $postgres_password
  SEAWEEDFS_SECRET_KEY    $seaweedfs_secret
  PITWALL_ADMIN_PASSWORD  $admin_password

Sem a PITWALL_SECRET_KEY, um backup do banco não serve para nada.
EOF
