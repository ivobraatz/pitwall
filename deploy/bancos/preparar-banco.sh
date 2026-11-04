#!/usr/bin/env bash
# Liga um sistema ao backup central (docs/operacao/backup-bancos.md). Rode uma vez por sistema, na VM:
#
#   preparar-banco.sh rhflex | datarunner | metrifree     pede a URL pública de admin do Postgres
#   preparar-banco.sh pitwall                             usa o Postgres local do Pitwall
#
# Nos sistemas da Railway, cria o usuário backup_ro, que só lê. A URL de admin fica só na memória deste
# script: nem ela nem a senha nova aparecem na tela. Rodar de novo troca a senha do backup_ro.
set -euo pipefail

dir="${BACKUPS_DIR:-/opt/backups}"
bancos="$dir/bancos"
imagem="postgres:17-alpine"
sistema="${1:-}"

case "$sistema" in
  rhflex) tabelas="Tenants Funcionarios RegistrosPonto" ;;
  datarunner) tabelas="tenants users connections" ;;
  metrifree) tabelas="users posts" ;;
  pitwall) tabelas="tickets products team_tasks" ;;
  *) echo "uso: preparar-banco.sh rhflex|datarunner|metrifree|pitwall" >&2; exit 2 ;;
esac

mkdir -p -m 700 "$bancos"
arquivo="$bancos/$sistema.env"
umask 077

if [[ "$sistema" == pitwall ]]; then
  pitwall_env="${PITWALL_ENV:-/opt/pitwall/.env}"
  senha=$(grep -m1 '^POSTGRES_PASSWORD=' "$pitwall_env" | cut -d= -f2-)
  rede="${PITWALL_REDE:-pitwall_default}"
  cat > "$arquivo" <<EOF
PGHOST=postgres
PGPORT=5432
PGUSER=pitwall
PGPASSWORD=$senha
PGDATABASE=pitwall
PGSSLMODE=disable
REDE=$rede
TABELAS=$tabelas
EOF
else
  read -rsp "Cole a URL pública de admin do Postgres de $sistema e aperte Enter: " url
  echo
  if [[ ! "$url" =~ ^postgres(ql)?://([^:]+):([^@]+)@([^:/]+):([0-9]+)/([^?]+) ]]; then
    echo "A URL precisa ter o formato postgresql://usuario:senha@host:porta/banco" >&2
    exit 1
  fi
  admin_usuario=${BASH_REMATCH[2]}
  admin_senha=${BASH_REMATCH[3]}
  host=${BASH_REMATCH[4]}
  porta=${BASH_REMATCH[5]}
  banco=${BASH_REMATCH[6]}
  ssl="${PGSSLMODE_BACKUP:-require}"
  senha=$(openssl rand -hex 24)

  docker run --rm -i -e PGHOST="$host" -e PGPORT="$porta" -e PGUSER="$admin_usuario" \
    -e PGPASSWORD="$admin_senha" -e PGDATABASE="$banco" -e PGSSLMODE="$ssl" "$imagem" \
    psql -q -v ON_ERROR_STOP=1 <<EOF
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'backup_ro') THEN
    CREATE ROLE backup_ro LOGIN;
  END IF;
END \$\$;
ALTER ROLE backup_ro WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$senha';
ALTER ROLE backup_ro SET default_transaction_read_only = on;
GRANT pg_read_all_data TO backup_ro;
EOF

  cat > "$arquivo" <<EOF
PGHOST=$host
PGPORT=$porta
PGUSER=backup_ro
PGPASSWORD=$senha
PGDATABASE=$banco
PGSSLMODE=$ssl
TABELAS=$tabelas
EOF
fi

chmod 600 "$arquivo"

rede_args=()
[[ "$sistema" == pitwall ]] && rede_args=(--network "$rede")
versao=$(docker run --rm "${rede_args[@]}" --env-file "$arquivo" "$imagem" psql -Atc 'SHOW server_version')
for tabela in $tabelas; do
  total=$(docker run --rm "${rede_args[@]}" --env-file "$arquivo" "$imagem" psql -Atc "SELECT count(*) FROM \"$tabela\"")
  echo "$tabela: $total registros"
done
echo "Pronto: $sistema conectado (Postgres $versao), em $arquivo."
