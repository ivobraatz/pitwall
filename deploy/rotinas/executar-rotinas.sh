#!/usr/bin/env bash
# Runs the routines registered in the Atlas, one after the other, each as a headless Claude Code
# session (claude -p) with the Pitwall MCP. Called by cron with the frequency to run:
#
#   executar-rotinas.sh daily | weekly | monthly
#
# The script knows nothing about any routine: it fetches the list from Pitwall and hands each
# routine's own instruction to the agent. What the routines are lives in the database.
# Settings come from rotinas.env beside this file (see rotinas.env.example and docs/operacao/atlas.md).
set -euo pipefail

FREQUENCY="${1:-}"
case "$FREQUENCY" in daily | weekly | monthly) ;; *) echo "uso: $0 daily|weekly|monthly" >&2; exit 2 ;; esac

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${PITWALL_ROUTINES_ENV:-$HERE/rotinas.env}"
[ -f "$ENV_FILE" ] || { echo "falta $ENV_FILE (copie de rotinas.env.example)" >&2; exit 2; }
set -a; . "$ENV_FILE"; set +a

: "${PITWALL_URL:?defina PITWALL_URL em rotinas.env}"
: "${PITWALL_TOKEN:?defina PITWALL_TOKEN em rotinas.env}"
: "${CLAUDE_CODE_OAUTH_TOKEN:?defina CLAUDE_CODE_OAUTH_TOKEN em rotinas.env (claude setup-token)}"
WORKDIR="${ROUTINES_WORKDIR:-$HOME}"
TIMEOUT="${ROUTINE_TIMEOUT_SECONDS:-1800}"
# What the agent may do without asking. The default reads and talks to Pitwall; a routine that
# opens pull requests needs more (see the guide).
CLAUDE_ARGS="${ROUTINE_CLAUDE_ARGS:---allowedTools mcp__pitwall,Read,Glob,Grep}"

for bin in curl jq claude flock timeout; do
  command -v "$bin" >/dev/null || { echo "falta o comando $bin" >&2; exit 2; }
done

# One run at a time: a slow daily never overlaps the weekly.
exec 9>"${TMPDIR:-/tmp}/pitwall-rotinas.lock"
flock -n 9 || { echo "outra execução em andamento"; exit 0; }

api() { # method path [json]
  curl -fsS --max-time 30 -X "$1" -H "Authorization: Bearer $PITWALL_TOKEN" -H "Content-Type: application/json" \
    ${3:+--data "$3"} "${PITWALL_URL%/}/v1/staff/atlas$2"
}

umask 077
MCP_CONFIG="$(mktemp)"
trap 'rm -f "$MCP_CONFIG"' EXIT
if [ -n "${PITWALL_MCP_BIN:-}" ]; then command=node; args="$(jq -nc --arg b "$PITWALL_MCP_BIN" '[$b]')"
else command=npx; args='["-y","pitwall-mcp"]'; fi
jq -n --arg c "$command" --argjson a "$args" --arg u "$PITWALL_URL" --arg t "$PITWALL_TOKEN" \
  '{mcpServers:{pitwall:{command:$c,args:$a,env:{PITWALL_URL:$u,PITWALL_TOKEN:$t}}}}' >"$MCP_CONFIG"

routines="$(api GET "/routines?frequency=$FREQUENCY&enabled=true")"
count="$(jq length <<<"$routines")"
echo "$(date -Is) $FREQUENCY: $count rotina(s)"

for i in $(seq 0 $((count - 1))); do
  slug="$(jq -r ".[$i].slug" <<<"$routines")"
  prompt="$(jq -r ".[$i].prompt" <<<"$routines")"
  [ -n "$prompt" ] || { echo "$slug: sem instrução, pulada"; continue; }
  run="$(api POST "/routines/$slug/runs" | jq -r .id)"
  echo "$(date -Is) $slug: execução $run"

  full="$prompt

---
Você está rodando a rotina \"$slug\" sem ninguém acompanhando. A execução já foi aberta no Pitwall.
Ao terminar, chame finish_routine_run com id=\"$run\", status ok ou failed, um resumo curto em result
e, em links, cada PR, tarefa ou alerta que você criou. O que precisar de uma pessoa vira create_task."

  set +e
  # shellcheck disable=SC2086
  output="$(cd "$WORKDIR" && timeout "$TIMEOUT" claude -p "$full" --mcp-config "$MCP_CONFIG" $CLAUDE_ARGS 2>&1)"
  code=$?
  set -e

  # Closes the run if the agent did not: the first result stands, so this never overwrites the agent's.
  status=ok; [ "$code" -eq 0 ] || status=failed
  summary="$(tail -c 3000 <<<"$output")"
  [ "$code" -ne 124 ] || summary="Passou do tempo limite de ${TIMEOUT}s. $summary"
  api POST "/runs/$run/finish" "$(jq -n --arg s "$status" --arg r "$summary" '{status:$s,result:$r}')" >/dev/null \
    || echo "$slug: não consegui fechar a execução $run" >&2
  echo "$(date -Is) $slug: $status (saída $code)"
done
