#!/usr/bin/env bash
# Backup central dos Postgres da Braatz (docs/operacao/backup-bancos.md). Roda na VM Oracle, pelo cron.
#
#   backup-bancos.sh                      todos os sistemas de /opt/backups/bancos
#   backup-bancos.sh rhflex               só este sistema, sempre em diario/
#   backup-bancos.sh --restaurar          todos, com o teste de restauração
#
# Para cada sistema: pg_dump com o usuário somente leitura, confere o arquivo, cifra com age (a VM só
# tem a chave pública) e envia ao R2. Nada é apagado daqui: a expiração é regra do bucket, e o bloqueio
# do bucket impede que uma invasão da VM apague os backups recentes. Cada resultado vai para o Kuma.
set -uo pipefail

dir="${BACKUPS_DIR:-/opt/backups}"
config="$dir/backups.env"
bancos="$dir/bancos"
trabalho="$dir/tmp"
imagem_rclone="rclone/rclone:1.71"
imagem_cliente="postgres:17-alpine"
minimo="${MINIMO_BYTES:-10240}"
teste=""

log() { echo "$(date '+%F %T') $*"; }
valor() { grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2-; }

# Avisa o Kuma. A URL de push pode vir com os parâmetros de exemplo da tela; eles são trocados aqui.
avisar() {
  local url="${1%%\?*}"
  [[ -n "$url" ]] || return 0
  curl -fsS -m 15 -o /dev/null -G "$url" --data-urlencode "status=$2" --data-urlencode "msg=$3" \
    || log "não consegui avisar o Kuma ($2: $3)"
}

limpar() {
  [[ -n "$teste" ]] && docker rm -f "$teste" >/dev/null 2>&1
  rm -f "$trabalho"/*
}
trap limpar EXIT

restaurar=false
alvos=()
for arg in "$@"; do
  case "$arg" in
    --restaurar) restaurar=true ;;
    -*) echo "uso: backup-bancos.sh [--restaurar] [sistema...]" >&2; exit 2 ;;
    *) alvos+=("$arg") ;;
  esac
done

mensal=false
if ((${#alvos[@]} == 0)); then
  for arquivo in "$bancos"/*.env; do
    [[ -f "$arquivo" ]] && alvos+=("$(basename "$arquivo" .env)")
  done
  [[ "$(date +%d)" == 01 ]] && mensal=true
fi
if ((${#alvos[@]} == 0)); then
  log "nenhum sistema em $bancos; rode preparar-banco.sh"
  exit 1
fi

recipient=$(valor "$config" AGE_RECIPIENT)
bucket=$(valor "$config" R2_BUCKET)
if [[ -z "$recipient" || -z "$bucket" ]]; then
  log "faltam AGE_RECIPIENT ou R2_BUCKET em $config"
  exit 1
fi

mkdir -p -m 700 "$trabalho"
exec 9>"$dir/.lock"
flock -w 7200 9 || { log "outro backup está rodando há mais de 2 horas"; exit 1; }

consulta() {
  docker run --rm "${rede[@]}" --env-file "$env" "$imagem" psql -Atc "$1"
}

consulta_teste() {
  docker exec "$teste" psql -U postgres -d teste -Atc "$1"
}

sql_tabelas="SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')"

# Restaura o dump num Postgres sem rede e compara com o banco de origem. O dump ainda não foi cifrado:
# a VM não tem a chave privada, então o teste precisa acontecer aqui.
testar_restauracao() {
  local sistema=$1 dump=$2 tabela origem copia tentativa
  teste="backup-teste-$sistema"
  docker rm -f "$teste" >/dev/null 2>&1
  docker run -d --rm --name "$teste" --network none --memory 2g \
    -e POSTGRES_HOST_AUTH_METHOD=trust "$imagem" >/dev/null || return 1

  # Por TCP: durante a inicialização o Postgres só escuta no socket e depois reinicia.
  for tentativa in {1..60}; do
    docker exec "$teste" pg_isready -q -h 127.0.0.1 -U postgres && break
    sleep 1
  done
  docker exec "$teste" createdb -U postgres teste || return 1
  docker exec -i "$teste" pg_restore -U postgres -d teste --no-owner --no-acl --exit-on-error < "$dump" \
    || { log "$sistema: pg_restore falhou"; return 1; }

  origem=$(consulta "$sql_tabelas") && copia=$(consulta_teste "$sql_tabelas") || return 1
  if [[ "$origem" != "$copia" ]]; then
    log "$sistema: origem tem $origem tabelas e a restauração tem $copia"
    return 1
  fi

  for tabela in $(valor "$env" TABELAS); do
    origem=$(consulta "SELECT count(*) FROM \"$tabela\"") || return 1
    copia=$(consulta_teste "SELECT count(*) FROM \"$tabela\"") || return 1
    log "$sistema: $tabela tem $origem na origem e $copia na restauração"
    # A origem segue recebendo dados depois do dump: aceita até 5% a menos, nunca mais que isso.
    if ((copia * 100 < origem * 95)); then
      log "$sistema: $tabela ficou abaixo do esperado"
      return 1
    fi
  done

  docker rm -f "$teste" >/dev/null 2>&1
  teste=""
}

falhas=()
restauracoes_falhas=()

fazer_backup() {
  local sistema=$1 versao tamanho tabelas pasta nome enviado
  dump="$trabalho/$sistema.dump"
  motivo=""

  env="$bancos/$sistema.env"
  if [[ ! -f "$env" ]]; then motivo="sem $env"; return 1; fi

  rede=()
  local nome_rede
  nome_rede=$(valor "$env" REDE)
  [[ -n "$nome_rede" ]] && rede=(--network "$nome_rede")

  # pg_dump não aceita servidor mais novo que ele: usa a mesma versão do servidor.
  imagem="$imagem_cliente"
  versao=$(consulta 'SHOW server_version_num') || { motivo="não conectou no banco"; return 1; }
  imagem="postgres:$((versao / 10000))-alpine"

  if ! timeout 3h docker run --rm "${rede[@]}" --env-file "$env" "$imagem" \
    pg_dump -Fc --no-owner --no-acl --lock-wait-timeout=60000 > "$dump"; then
    motivo="pg_dump falhou"
    return 1
  fi

  tamanho=$(stat -c %s "$dump")
  if ((tamanho < minimo)); then motivo="dump com só $tamanho bytes"; return 1; fi

  tabelas=$(docker run --rm -i "$imagem" pg_restore --list < "$dump" | grep -c 'TABLE DATA')
  if ((tabelas == 0)); then motivo="dump sem dados de tabela"; return 1; fi

  if $restaurar; then
    testar_restauracao "$sistema" "$dump" || restauracoes_falhas+=("$sistema")
    [[ -n "$teste" ]] && docker rm -f "$teste" >/dev/null 2>&1
    teste=""
  fi

  if ! age -r "$recipient" -o "$dump.age" "$dump"; then motivo="age falhou"; return 1; fi
  rm -f "$dump"

  pasta=diario
  $mensal && pasta=mensal
  nome="$pasta/$sistema/$sistema-$(date -u +%Y-%m-%dT%H%M%SZ).dump.age"
  tamanho=$(stat -c %s "$dump.age")

  if ! docker run --rm -i --env-file "$config" "$imagem_rclone" -q rcat "r2:$bucket/$nome" < "$dump.age"; then
    motivo="envio ao R2 falhou"
    return 1
  fi
  enviado=$(docker run --rm --env-file "$config" "$imagem_rclone" -q lsf --format s "r2:$bucket/$nome")
  if [[ "$enviado" != "$tamanho" ]]; then
    motivo="no R2 o arquivo tem '$enviado' bytes, deveria ter $tamanho"
    return 1
  fi

  rm -f "$dump.age"
  motivo="$nome ($((tamanho / 1024)) KB, $tabelas tabelas)"
}

for sistema in "${alvos[@]}"; do
  chave="PUSH_$(echo "$sistema" | tr '[:lower:]' '[:upper:]')"
  if fazer_backup "$sistema"; then
    log "$sistema: $motivo"
    avisar "$(valor "$config" "$chave")" up "$motivo"
  else
    log "$sistema: FALHOU: $motivo"
    avisar "$(valor "$config" "$chave")" down "$motivo"
    falhas+=("$sistema")
  fi
  rm -f "$trabalho"/*
done

if $restaurar; then
  if ((${#restauracoes_falhas[@]} > 0)); then
    log "restauração FALHOU: ${restauracoes_falhas[*]}"
    avisar "$(valor "$config" PUSH_RESTAURACAO)" down "falhou: ${restauracoes_falhas[*]}"
  else
    log "restauração ok: ${alvos[*]}"
    avisar "$(valor "$config" PUSH_RESTAURACAO)" up "ok: ${alvos[*]}"
  fi
fi

((${#falhas[@]} == 0 && ${#restauracoes_falhas[@]} == 0))
