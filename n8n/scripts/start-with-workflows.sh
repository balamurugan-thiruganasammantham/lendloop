#!/bin/sh
# Container start command for n8n/Dockerfile: import and publish the LendLoop
# workflows, then hand over to the stock n8n entrypoint.
#
# Importing overwrites the workflows by id (edits made in the n8n UI are lost on
# restart; export them into n8n/workflows first). Publishing must happen before
# n8n starts, because the CLI's publish only takes effect on the next start.
set -eu

n8n import:workflow --separate --input=/workflows
for id in lendloopErrorHdl lendloopReqNotif lendloopOverdueR; do
  n8n publish:workflow --id="$id"
done

exec /docker-entrypoint.sh "$@"
