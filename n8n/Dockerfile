# n8n image for hosts where you can't run `docker compose exec` (Render, Koyeb, Railway, Cloud Run…).
# It bakes in the LendLoop workflows and imports + publishes them on every start, then runs n8n.
# Local development keeps using docker-compose.yml + n8n/scripts/import-workflows.sh.
#
#   docker build -t lendloop-n8n n8n/
#
# Secrets (N8N_ENCRYPTION_KEY, LENDLOOP_*) and the database settings come from the host's
# environment variables. See docs/DEPLOY.md.
FROM docker.n8n.io/n8nio/n8n:2.46.6

USER root
COPY workflows /workflows
COPY scripts/start-with-workflows.sh /start-with-workflows.sh
RUN chmod 755 /start-with-workflows.sh && chmod -R a+rX /workflows
USER node

# Non-secret defaults (same as docker-compose.yml). Override on the host if needed.
ENV N8N_PORT=5678 \
    GENERIC_TIMEZONE=UTC \
    TZ=UTC \
    NODE_FUNCTION_ALLOW_BUILTIN=crypto \
    N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
    N8N_DIAGNOSTICS_ENABLED=false \
    N8N_VERSION_NOTIFICATIONS_ENABLED=false \
    N8N_PERSONALIZATION_ENABLED=false \
    N8N_HIRING_BANNER_ENABLED=false \
    EXECUTIONS_DATA_PRUNE=true \
    EXECUTIONS_DATA_MAX_AGE=168

EXPOSE 5678
ENTRYPOINT ["tini", "--", "/start-with-workflows.sh"]
