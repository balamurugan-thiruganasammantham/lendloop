#!/usr/bin/env sh
# Imports the LendLoop workflows from n8n/workflows into the running n8n
# container, publishes them and restarts n8n so the webhook/schedule go live.
#
#   sh n8n/scripts/import-workflows.sh        (run from the repo root)
#
# Re-running is safe: workflows are overwritten by id (UI edits are lost) and
# importing unpublishes them, which is why they are published again here.
# The error handler must be published too: n8n 2.x only runs published
# error workflows.
set -eu

cd "$(dirname "$0")/../.."

# Wait until n8n has connected to its database and finished migrations; a CLI
# command started earlier would run migrations concurrently (SQLITE_BUSY).
wait_ready() {
  printf 'Waiting for n8n'
  i=0
  until docker compose exec -T n8n wget -qO- http://127.0.0.1:5678/healthz/readiness >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 90 ]; then echo ' timed out'; exit 1; fi
    printf '.'
    sleep 2
  done
  echo ' ready.'
}

wait_ready
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows

for id in lendloopErrorHdl lendloopReqNotif lendloopOverdueR; do
  docker compose exec -T n8n n8n publish:workflow --id="$id"
done

# Publishing via the CLI only takes effect after a restart.
docker compose restart n8n
wait_ready

echo 'Published workflows:'
docker compose exec -T n8n n8n list:workflow --active=true
