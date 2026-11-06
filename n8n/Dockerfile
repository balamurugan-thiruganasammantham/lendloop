# n8n image for hosts where you can't run `docker compose exec` (Render, Koyeb, Railway, Cloud Run…).
# It bakes in the LendLoop workflows and imports + publishes them on every start, then runs n8n.
# Local development keeps using docker-compose.yml + n8n/scripts/import-workflows.sh.
#
#   docker build -t lendloop-n8n n8n/
#
# Secrets (N8N_ENCRYPTION_KEY, LENDLOOP_*) and the database settings come from the host's
# environment variables. See docs/DEPLOY.md.
# Docker Hub mirror of the official image (docker.n8n.io rate-limits shared build hosts such as Render).
FROM docker.io/n8nio/n8n:2.46.6

USER root
COPY workflows /workflows
COPY scripts/start-with-workflows.sh /start-with-workflows.sh
COPY scripts/workflow-marker.cjs /workflow-marker.cjs
RUN chmod 755 /start-with-workflows.sh && chmod 644 /workflow-marker.cjs && chmod -R a+rX /workflows
USER node

# Non-secret defaults (same as docker-compose.yml). Override on the host if needed.
# N8N_LISTEN_ADDRESS: n8n defaults to "::" (IPv6); hosts such as Render only route to 0.0.0.0.
# N8N_RUNNERS_GRANT_TOKEN_TTL (seconds, default 30): on 0.1 CPU the JS task runner (it runs the
# HMAC Code nodes) can take longer than 30 s to start and is then rejected with "invalid or expired grant token".
# N8N_DISABLED_MODULES: optional n8n 2.x modules LendLoop doesn't use (AI agents, chat hub, MCP, SSO/LDAP,
# source control, insights, …). Fewer modules = less memory on Render Free's 512 MB.
ENV N8N_PORT=5678 \
    N8N_LISTEN_ADDRESS=0.0.0.0 \
    N8N_RUNNERS_GRANT_TOKEN_TTL=120 \
    N8N_DISABLED_MODULES=insights,external-secrets,community-packages,data-table,oauth-server,mcp,mcp-discovery,provisioning,breaking-changes,source-control,dynamic-credentials,chat-hub,sso-oidc,sso-saml,log-streaming,ldap,quick-connect,workflow-builder,favorites,otel,token-exchange,mcp-registry,workflow-reviews,inbox,skills,instance-ai,knowledge,agents,agent-evals,scim \
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
