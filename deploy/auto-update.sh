#!/usr/bin/env bash
# Pitwall auto-update for a single server (docker-compose.prod.yml).
#
# Run by deploy/systemd/pitwall-update.timer every few minutes. It deploys the newest commit of the
# branch only after GitHub's CI passed for it, dumps the database first, checks the health of the
# new version and rolls the code back if it doesn't come up. Nothing on GitHub can reach the server:
# the server asks.
#
#   deploy/auto-update.sh            check and deploy if there is something new
#   deploy/auto-update.sh --dry-run  only say what would happen
#
# A commit that failed to come up is remembered in .deploy-failed and skipped until a newer one
# arrives. Database migrations only go forward: a rollback restores the code, not the schema (the
# dump taken before the update is in backups/).
set -euo pipefail

# Everything lives in main(): bash reads a script as it runs, and `git merge` below rewrites this
# very file. A function is parsed whole before it starts.
main() {
  local dir="${PITWALL_DIR:-/opt/pitwall}"
  local branch="${PITWALL_BRANCH:-main}"
  local repo="${PITWALL_REPO:-ivobraatz/pitwall}"
  local workflow="${PITWALL_CI_WORKFLOW:-CI}"
  local dry_run=false
  [[ "${1:-}" == "--dry-run" ]] && dry_run=true

  local compose=(docker compose -f "$dir/docker-compose.prod.yml" --profile caddy)
  local backups="$dir/backups"
  local failed_file="$dir/.deploy-failed"

  log() { echo "$(date '+%F %T') $*"; }

  cd "$dir"
  exec 9>"$dir/.deploy.lock"
  if ! flock -n 9; then log "outra atualização em andamento; saindo"; return 0; fi

  git fetch --quiet origin "$branch"
  local current target
  current=$(git rev-parse HEAD)
  target=$(git rev-parse "origin/$branch")
  if [[ "$current" == "$target" ]]; then
    $dry_run && log "nada novo (${current:0:7})"
    return 0
  fi
  if [[ -f "$failed_file" && "$(cat "$failed_file")" == "$target" ]]; then
    $dry_run && log "${target:0:7} já falhou antes; esperando um commit mais novo"
    return 0
  fi

  # Only what passed CI. Public repository: the API needs no token (60 calls/hour per address).
  local ci
  ci=$(curl -fsS --max-time 20 \
        "https://api.github.com/repos/$repo/actions/runs?head_sha=$target&event=push&per_page=20" \
      | jq -r --arg wf "$workflow" '[.workflow_runs[] | select(.name == $wf)] | first | "\(.status) \(.conclusion)"' \
      ) || { log "não consegui consultar o CI de ${target:0:7}; tento de novo depois"; return 0; }
  case "$ci" in
    "completed success") ;;
    "completed "*) log "CI de ${target:0:7} terminou como '${ci#completed }'; não atualizo"; echo "$target" > "$failed_file"; return 0 ;;
    *) $dry_run && log "CI de ${target:0:7} ainda não terminou ($ci)"; return 0 ;;
  esac

  log "atualizando ${current:0:7} → ${target:0:7}: $(git log -1 --format=%s "$target")"
  if $dry_run; then log "(dry-run) pararia aqui"; return 0; fi

  if ! git merge --ff-only --quiet "origin/$branch"; then
    log "o código no servidor tem mudanças locais; atualize à mão (git status em $dir)"
    echo "$target" > "$failed_file"
    return 1
  fi

  mkdir -p "$backups"
  local dump="$backups/antes-de-${target:0:7}.dump"
  "${compose[@]}" exec -T postgres pg_dump -U pitwall -Fc pitwall > "$dump"
  ls -1t "$backups"/antes-de-*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f
  log "banco salvo em $dump"

  if "${compose[@]}" up -d --build --remove-orphans && healthy; then
    rm -f "$failed_file"
    docker image prune -f > /dev/null
    log "ok: ${target:0:7} no ar"
    return 0
  fi

  log "a versão ${target:0:7} não subiu; voltando o código para ${current:0:7}"
  echo "$target" > "$failed_file"
  git reset --hard --quiet "$current"
  "${compose[@]}" up -d --build --remove-orphans
  if healthy; then
    log "voltou para ${current:0:7}. Se a versão nova mudou o banco, restaure $dump (docs/deploy-oracle.md, parte 15.4)"
  else
    log "ATENÇÃO: nem a versão anterior respondeu. Veja: ${compose[*]} logs --tail=200 api"
  fi
  return 1
}

# API and console answer on the loopback ports the compose file publishes. Up to 3 minutes: the
# API runs the migrations before it listens.
healthy() {
  for _ in $(seq 1 36); do
    if curl -fsS --max-time 5 http://127.0.0.1:5180/health > /dev/null 2>&1 \
       && curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3200/login 2>/dev/null; then
      return 0
    fi
    sleep 5
  done
  return 1
}

main "$@"
