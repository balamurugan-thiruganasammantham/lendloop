#!/bin/sh
# Container start command for n8n/Dockerfile: make sure the LendLoop workflows
# are imported and published, then hand over to the stock n8n entrypoint.
#
# On small hosts (Render Free = 0.1 CPU) every n8n CLI command takes about a
# minute to boot, so importing + publishing three workflows takes ~4 minutes.
# With Postgres we remember a fingerprint of the workflow files and skip that
# work on restarts when nothing changed (e.g. Render waking a sleeping service).
# Set LENDLOOP_FORCE_IMPORT=true to re-import anyway.
#
# Importing overwrites the workflows by id, so edits made in the n8n UI are lost
# whenever the workflow files change; export them into n8n/workflows first.
set -eu

hash=$(cat /workflows/*.json | sha256sum | cut -c1-16)
use_marker=false
[ "${DB_TYPE:-sqlite}" = "postgresdb" ] && use_marker=true

if [ "$use_marker" = true ] && [ "${LENDLOOP_FORCE_IMPORT:-false}" != true ] && node /workflow-marker.cjs check "$hash"; then
  echo "LendLoop workflows unchanged ($hash): skipping import."
else
  echo "Importing LendLoop workflows ($hash)…"
  n8n import:workflow --separate --input=/workflows
  # Publishing via the CLI takes effect when n8n starts, which happens right after.
  for id in lendloopErrorHdl lendloopReqNotif lendloopOverdueR; do
    n8n publish:workflow --id="$id"
  done
  if [ "$use_marker" = true ]; then node /workflow-marker.cjs set "$hash" || true; fi
fi

exec /docker-entrypoint.sh "$@"
