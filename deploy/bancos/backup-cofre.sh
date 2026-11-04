#!/usr/bin/env bash
# Leva o backup do Vaultwarden para fora da VM (docs/operacao/backup-bancos.md). Roda como root, pelo
# cron, depois do /opt/vaultwarden/backup.sh, que gera a cópia consistente do SQLite e da chave RSA.
# Pega o arquivo mais recente, cifra com age e envia ao R2. Sem o cofre, nenhum outro backup se recupera:
# ele guarda os segredos de cada sistema.
set -uo pipefail

dir="${BACKUPS_DIR:-/opt/backups}"
config="$dir/backups.env"
origem="${COFRE_BACKUPS:-/opt/vaultwarden/backups}"
trabalho="$dir/tmp-cofre"
imagem_rclone="rclone/rclone:1.71"
minimo="${MINIMO_BYTES:-1024}"

log() { echo "$(date '+%F %T') $*"; }
valor() { grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2-; }

avisar() {
  local url
  url=$(valor "$config" PUSH_COFRE)
  url="${url%%\?*}"
  [[ -n "$url" ]] || return 0
  curl -fsS -m 15 -o /dev/null -G "$url" --data-urlencode "status=$1" --data-urlencode "msg=$2" \
    || log "não consegui avisar o Kuma ($1: $2)"
}

falhar() {
  log "cofre: FALHOU: $1"
  avisar down "$1"
  exit 1
}

recipient=$(valor "$config" AGE_RECIPIENT)
bucket=$(valor "$config" R2_BUCKET)
if [[ -z "$recipient" || -z "$bucket" ]]; then
  log "faltam AGE_RECIPIENT ou R2_BUCKET em $config"
  exit 1
fi

mkdir -p -m 700 "$trabalho"
trap 'rm -f "$trabalho"/*' EXIT

arquivo=$(find "$origem" -maxdepth 1 -name '*.tar.gz' -mtime -1 -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)
[[ -n "$arquivo" ]] || falhar "sem backup do cofre nas últimas 24 horas em $origem"

tamanho=$(stat -c %s "$arquivo")
((tamanho >= minimo)) || falhar "backup do cofre com só $tamanho bytes"

conteudo=$(tar -tzf "$arquivo") || falhar "backup do cofre não abre"
grep -q 'sqlite' <<< "$conteudo" || falhar "backup do cofre sem o banco"
grep -q 'rsa_key' <<< "$conteudo" || falhar "backup do cofre sem a chave RSA"

cifrado="$trabalho/vaultwarden.tar.gz.age"
age -r "$recipient" -o "$cifrado" "$arquivo" || falhar "age falhou"

pasta=diario
[[ "$(date +%d)" == 01 ]] && pasta=mensal
nome="$pasta/vaultwarden/vaultwarden-$(date -u +%Y-%m-%dT%H%M%SZ).tar.gz.age"
tamanho=$(stat -c %s "$cifrado")

docker run --rm -i --env-file "$config" "$imagem_rclone" -q rcat "r2:$bucket/$nome" < "$cifrado" \
  || falhar "envio ao R2 falhou"
enviado=$(docker run --rm --env-file "$config" "$imagem_rclone" -q lsf --format s "r2:$bucket/$nome")
[[ "$enviado" == "$tamanho" ]] || falhar "no R2 o arquivo tem '$enviado' bytes, deveria ter $tamanho"

log "cofre: $nome ($((tamanho / 1024)) KB)"
avisar up "$nome ($((tamanho / 1024)) KB)"
