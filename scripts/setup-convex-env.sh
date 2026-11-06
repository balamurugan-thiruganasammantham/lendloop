#!/usr/bin/env sh
# Configure a *development* Convex deployment for LendLoop.
#
#   sh scripts/setup-convex-env.sh https://<your-instance>.clerk.accounts.dev
#
# Generates fresh random secrets (never printed) and sets the variables the
# backend needs. Existing values are left untouched unless FORCE=1 is set.
# For production, set these manually with `npx convex env set --prod`.
set -eu

ISSUER="${1:-}"
if [ -z "$ISSUER" ]; then
  echo "usage: sh scripts/setup-convex-env.sh <CLERK_JWT_ISSUER_DOMAIN>" >&2
  exit 1
fi

current() { npx convex env get "$1" 2>/dev/null || true; }

set_if_missing() {
  name="$1"; value="$2"
  if [ "${FORCE:-0}" = "1" ] || [ -z "$(current "$name")" ]; then
    npx convex env set "$name" "$value" >/dev/null
    echo "set   $name"
  else
    echo "keep  $name (already set)"
  fi
}

set_if_missing CLERK_JWT_ISSUER_DOMAIN "$ISSUER"
set_if_missing OTP_PEPPER "$(openssl rand -hex 32)"
set_if_missing AUTOMATION_INBOUND_SECRET "$(openssl rand -hex 32)"
set_if_missing EMAIL_DELIVERY_MODE mock
set_if_missing APP_URL http://localhost:3000
set_if_missing SEED_ENABLED true

echo
echo "Optional (n8n): set N8N_WEBHOOK_URL and N8N_WEBHOOK_SECRET — see n8n/README.md."
echo "Optional (SMTP for hand-over codes): EMAIL_DELIVERY_MODE=smtp, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM."
