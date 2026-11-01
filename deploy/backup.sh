#!/usr/bin/env bash
# Daily backup, run by cron (docs/operacao/deploy-oracle.md, parte 15). Writes everything to backups/:
# database dumps (14 days) and a mirror of the attachments. An attachment removed from the bucket moves
# to anexos-apagados/<date> and stays 30 days. This protects against mistakes, not against losing the
# VM: another machine must pull this folder, as the guide explains.
set -euo pipefail

dir="${PITWALL_DIR:-/opt/pitwall}"
backups="$dir/backups"
compose=(docker compose -f "$dir/docker-compose.prod.yml" --profile caddy)
log() { echo "$(date '+%F %T') $*"; }

mkdir -p "$backups"
today=$(date +%F)
dump="$backups/pitwall-$today.dump"
"${compose[@]}" exec -T postgres pg_dump -U pitwall -Fc pitwall > "$dump.tmp"
mv "$dump.tmp" "$dump"
find "$backups" -name 'pitwall-*.dump' -mtime +14 -delete
log "banco salvo em $dump"

docker compose -f "$dir/docker-compose.prod.yml" --profile backup run --rm --no-deps --user "$(id -u):$(id -g)" rclone \
  sync bucket:pitwall-anexos /backups/anexos --backup-dir "/backups/anexos-apagados/$today" --config /tmp/rclone.conf
if [[ -d "$backups/anexos-apagados" ]]; then
  find "$backups/anexos-apagados" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
fi
log "anexos copiados para $backups/anexos"
