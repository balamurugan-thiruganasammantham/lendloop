# LendLoop – n8n automation

n8n handles LendLoop's outbound email: it receives signed events from Convex,
sends (or mocks) the email, and reports results back to Convex over signed HTTP
calls. Convex stays the source of truth for dedup, retries and audit.

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| A – Request Notification (`lendloopReqNotif`) | `workflows/lendloop-request-notification.json` | `POST /webhook/lendloop-events` | Email for borrow-request / loan / admin events |
| B – Daily Overdue Reminders (`lendloopOverdueR`) | `workflows/lendloop-overdue-reminders.json` | Daily 09:00 UTC + manual | Reminder email per overdue loan, run summary |
| C – Error Handler (`lendloopErrorHdl`) | `workflows/lendloop-error-handler.json` | Error Trigger | Sends a redacted failure record to Convex |

A and B use C as their error workflow (`settings.errorWorkflow`). The exports
have fixed ids and contain **no credentials or secrets**: secrets come from
environment variables via `$env`, and the SMTP node references a credential
named `LendLoop SMTP` that you create yourself (only needed for real email).

Other files: `../docker-compose.yml` (n8n service), `.env.example` (settings
template), `scripts/import-workflows.sh` (import + publish + restart),
`scripts/send-test-event.mjs` (signed test events, no dependencies).

## Setup (local)

Prerequisites: Docker with Compose, Node 18+ (for the test script), and the
Convex dev deployment running (`npx convex dev`, HTTP actions on port 3211).

```bash
# 1. Settings file (git-ignored)
cp n8n/.env.example n8n/.env
openssl rand -hex 32   # -> N8N_ENCRYPTION_KEY
openssl rand -hex 32   # -> LENDLOOP_N8N_WEBHOOK_SECRET
npx convex env get AUTOMATION_INBOUND_SECRET   # -> LENDLOOP_AUTOMATION_SECRET
#    edit n8n/.env and paste the three values

# 2. Point Convex at n8n (same webhook secret as in n8n/.env)
npx convex env set N8N_WEBHOOK_URL http://127.0.0.1:5678/webhook/lendloop-events
npx convex env set N8N_WEBHOOK_SECRET <LENDLOOP_N8N_WEBHOOK_SECRET value>

# 3. Start n8n, then import + publish the workflows (restarts n8n once)
docker compose up -d
sh n8n/scripts/import-workflows.sh
```

Open http://localhost:5678 and create the owner account on first visit; the
imported workflows are in that account's Overview. n8n is bound to
`127.0.0.1` only (set `N8N_BIND_ADDRESS=0.0.0.0` in your shell to expose it).

### Environment variables (`n8n/.env`)

| Variable | Secret | Purpose |
| --- | --- | --- |
| `N8N_ENCRYPTION_KEY` | yes | Encrypts credentials in n8n's database. Keep it stable. |
| `LENDLOOP_N8N_WEBHOOK_SECRET` | yes | Verifies Convex → n8n webhooks. Equals Convex `N8N_WEBHOOK_SECRET`. |
| `LENDLOOP_AUTOMATION_SECRET` | yes | Signs n8n → Convex calls. Equals Convex `AUTOMATION_INBOUND_SECRET`. |
| `LENDLOOP_CONVEX_SITE_URL` | no | Convex HTTP actions URL as seen from the container. Local: `http://host.docker.internal:3211`; cloud: `https://<deployment>.convex.site`. |
| `LENDLOOP_EMAIL_MODE` | no | `mock` (default, nothing is sent, result `MOCKED`) or `smtp`. Any other value behaves like `mock`. |
| `LENDLOOP_EMAIL_FROM` | no | From address in smtp mode, e.g. `LendLoop <no-reply@example.com>`. |

`docker-compose.yml` loads this file with `env_file` and adds fixed n8n
settings: `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (Code nodes sign with
`require('crypto')`), `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (workflows read
`$env`), `GENERIC_TIMEZONE=UTC`, telemetry/version checks off, and execution
pruning after `N8N_EXECUTIONS_MAX_AGE_HOURS` (default 168). After editing
`n8n/.env`, run `docker compose up -d` to recreate the container.

Note on `host.docker.internal`: compose maps it to the host gateway. With
Docker Engine on Linux this only works because the Convex local backend
listens on `0.0.0.0:3211`.

## Import, publish, re-import

`scripts/import-workflows.sh` runs these commands, which you can also run by hand:

```bash
docker compose exec n8n n8n import:workflow --separate --input=/workflows
docker compose exec n8n n8n publish:workflow --id=lendloopErrorHdl
docker compose exec n8n n8n publish:workflow --id=lendloopReqNotif
docker compose exec n8n n8n publish:workflow --id=lendloopOverdueR
docker compose restart n8n        # CLI publishing only takes effect after a restart
docker compose exec n8n n8n list:workflow --active=true
```

- `./n8n/workflows` is mounted read-only at `/workflows`.
- Importing overwrites workflows with the same id (UI edits are lost) and
  **unpublishes** them, so always publish again afterwards.
- n8n 2.x only runs **published** error workflows, so C is published too
  (it has no trigger of its own; publishing it does nothing else).
- `import:workflow --activeState=fromJson` is not supported in regular
  (non-queue) mode, which is why the exports have `"active": false`.
- To export UI changes back into the repo:
  `docker compose exec n8n n8n export:workflow --id=lendloopReqNotif --pretty --output=/tmp/a.json`
  then `docker compose cp n8n:/tmp/a.json n8n/workflows/lendloop-request-notification.json`.
  Check the diff for credential ids before committing (credential ids are not secrets, but keep the file portable).

## Request signing

The same scheme is used in both directions:

```
x-lendloop-timestamp: <unix seconds>
x-lendloop-nonce:     <unique per request, e.g. crypto.randomUUID()>
x-lendloop-signature: sha256=<hex HMAC_SHA256(secret, `${timestamp}.${nonce}.${rawBody}`)>
```

Requests older/newer than 300 s are rejected; signatures are compared in
constant time (`crypto.timingSafeEqual` on equal-length buffers).

- **Convex → n8n** (Workflow A, secret `LENDLOOP_N8N_WEBHOOK_SECRET`): Convex
  also sends `x-lendloop-event-id`, which must match the body's `eventId`.
  n8n's Webhook node gives the parsed body, so the "Verify Signature" Code node
  re-serialises it with `JSON.stringify($json.body)`. This reproduces the exact
  bytes **because** Convex sends compact `JSON.stringify(payload)` output with
  only strings/numbers/nulls in a fixed key order. If Convex ever sends
  pretty-printed JSON, numbers like `1.0`, or escapes that `JSON.stringify`
  writes differently, verification fails closed (401). Replay of a captured
  request within the 5-minute window is harmless: the event claim makes it a
  `duplicate`.
- **n8n → Convex** (all `/automation/*` calls, secret
  `LENDLOOP_AUTOMATION_SECRET`): a Code node builds the JSON body string,
  signs exactly that string, and the next HTTP Request node sends it as a raw
  `application/json` body (`{{ $json.request.body }}`) with the three headers.
  Convex additionally rejects reused nonces (409). HTTP Request nodes retry 3
  times, 2 s apart, with a 10 s timeout (15 s for the candidate list).

## What each workflow does

### A – Request Notification

1. **Verify Signature** → invalid/missing/stale: `401 {"error":"unauthorized"}`
   (`503 {"error":"not_configured"}` if the webhook secret is not set).
2. **Validate Payload** (strict schemaVersion 1: every field required, unknown
   fields rejected, `eventId` `^evt_[A-Za-z0-9]+$`, known `eventType`, email
   shape, ISO `occurredAt`, http(s) `link`, no control characters in single-line
   fields) → `400 {"error":"invalid_payload","issues":[<field paths>]}`.
3. **Claim Event** `POST /automation/events/claim {"eventId","executionId"}`.
   - `duplicate` or `unknown` → `200 {"ok":true,"status":...}` and stop.
   - `in_progress` → `409 {"ok":false,"status":"in_progress"}` so Convex's
     outbox retries later rather than marking the event delivered while the
     other attempt might still fail.
4. **Build Email**: subject = `message.title`, plain text = `message.body` +
   blank line + `link`. Nothing else from the payload is used.
5. `LENDLOOP_EMAIL_MODE=smtp` → **Send Email (SMTP)** (On Error: continue);
   otherwise **Mock Send** (no email, result `MOCKED`). `SENT` is only reported
   when the SMTP server accepted the message.
6. **Report Delivery** `POST /automation/events/report {"eventId","executionId","result","error"?}`.
7. Respond `200 {"ok":true,"status":"SENT"|"MOCKED"}` or
   `502 {"ok":false,"status":"FAILED"}`; Convex retries non-2xx with backoff,
   and a FAILED report releases the claim so the retry can send again.

If a Convex call still fails after retries, A responds
`502 {"ok":false,"error":"automation_backend_error"}` and stops with an error
whose message names the event (`Claim Event failed for evt_...`), so Workflow C
records it with `relatedEventId` (Convex then releases that event's claim).
Responses and error records never contain the recipient email.

### B – Daily Overdue Reminders

`POST /automation/overdue/candidates {"executionId"}` → for each item (one at a
time, so retries never resend another item's nonce):
`POST /automation/reminders/claim {"loanId","period","executionId"}`. Only
`claimed` is emailed (SMTP or mock, as in A) and then reported with
`POST /automation/reminders/report {"loanId","period","result","error"?}`;
`duplicate`/`in_progress`/`not_overdue`/`skipped`/`unknown` count as skipped,
and a Convex call that fails after retries counts as failed without aborting
the run. Finally `POST /automation/runs` records
`{workflowName:"lendloop-overdue-reminders", executionId, processed, sent (SENT+MOCKED), skipped, failed, startedAt}`
— also when there are no candidates. Re-running the same day is safe.

### C – Error Handler

Error Trigger → builds `{workflowName, executionId, failedNode, errorMessage, relatedEventId?, occurredAt}`
from the error metadata only (never the failed execution's input), redacts
emails, `sha256=…`, bearer tokens, `password=/secret=/token=/api_key=` values,
6+ digit runs and the LendLoop secrets themselves, truncates to 1000 chars,
and sends it to `POST /automation/errors`. Errors only reach C from production
(webhook/schedule) executions; editor test runs and `n8n execute` CLI runs do
not produce failure records.

## Testing

```bash
# Workflow A without the app (signs like Convex; reads the secret from n8n/.env)
node n8n/scripts/send-test-event.mjs                 # 200 {"ok":true,"status":"unknown"} (random evt_ id)
node n8n/scripts/send-test-event.mjs --event-id evt_<id from automationEvents>   # 200 MOCKED, then "duplicate"
node n8n/scripts/send-test-event.mjs --bad-signature # 401
node n8n/scripts/send-test-event.mjs --stale         # 401
node n8n/scripts/send-test-event.mjs --malformed     # 400 with field paths
node n8n/scripts/send-test-event.mjs --help
```

The same with curl + openssl:

```bash
SECRET=<LENDLOOP_N8N_WEBHOOK_SECRET>
BODY='{"schemaVersion":1,"eventId":"evt_curltest1","eventType":"borrow_request.created","occurredAt":"2026-11-05T10:00:00.000Z","recipient":{"userId":"u1","email":"a@example.com","displayName":"Arun K."},"subject":{"requestId":null,"loanId":null,"toolId":null,"toolName":"Cordless Drill","status":"PENDING"},"message":{"title":"New borrow request","body":"Priya wants to borrow your Cordless Drill."},"link":"http://localhost:3000/incoming"}'
TS=$(date +%s); NONCE=$(openssl rand -hex 16)
SIG="sha256=$(printf '%s.%s.%s' "$TS" "$NONCE" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.*= //')"
curl -i -X POST http://localhost:5678/webhook/lendloop-events \
  -H 'content-type: application/json' -H "x-lendloop-timestamp: $TS" \
  -H "x-lendloop-nonce: $NONCE" -H "x-lendloop-signature: $SIG" --data-raw "$BODY"
```

End to end through the app: any email-worthy action for a non-seed user
creates an `automationEvents` row that Convex delivers to n8n (seed users are
excluded by design). Check the result with
`npx convex data automationEvents` (`status: DELIVERED`, `deliveryResult: MOCKED`).

Workflow B on demand (the extra broker port avoids clashing with the running
instance's task runner):

```bash
docker compose exec -e N8N_RUNNERS_BROKER_PORT=5681 n8n n8n execute --id=lendloopOverdueR
npx convex data automationRuns
```

Or open the workflow in the editor and click **Execute workflow**. Failures
recorded by Workflow C appear in `npx convex data automationFailures` and the
admin panel.

## Mock vs real

Everything is real except the email itself in `mock` mode: signature checks,
validation, event/reminder claims, delivery reports, run records and failure
records all hit Convex. In mock mode no SMTP connection is made and results
are `MOCKED` (Convex treats them like `SENT` for dedup).

## Switching to real SMTP

1. In n8n: **Credentials → Add credential → SMTP**, name it exactly
   `LendLoop SMTP`, fill in host, port, user, password and SSL/TLS, save.
2. In `n8n/.env`: `LENDLOOP_EMAIL_MODE=smtp` and a `LENDLOOP_EMAIL_FROM` your
   provider accepts; then `docker compose up -d`.
3. Run `sh n8n/scripts/import-workflows.sh` again: on import n8n binds the
   nodes' `LendLoop SMTP` reference to your credential by name. (Alternatively
   open **Send Email (SMTP)** in A and **Send Reminder (SMTP)** in B, select
   the credential, save and publish.) The JSON in the repo stays credential-free.
4. Test with `node n8n/scripts/send-test-event.mjs --event-id <real evt_ id>`
   or a real app action. For a local SMTP sink, run e.g. Mailpit on the
   compose network (`docker run -d --name mailpit --network lendloop_default axllent/mailpit`,
   SMTP host `mailpit`, port 1025, SSL off).

If the credential is missing in smtp mode, the send is reported as `FAILED`
(never `SENT`) and Convex retries. The n8n Send Email node has no connect
timeout, so an unreachable SMTP server can keep an execution busy for up to
~2 minutes; Convex's 10 s webhook timeout then triggers a retry, which gets
`409 in_progress` until the first attempt finishes.

## Troubleshooting

- **Webhook returns 404**: the workflow is not published or n8n was not
  restarted after CLI publishing; run `scripts/import-workflows.sh`.
- **Convex calls return 401**: `LENDLOOP_AUTOMATION_SECRET` differs from
  Convex `AUTOMATION_INBOUND_SECRET`, or the clocks differ by more than 5 min.
  **503 `not_configured`**: the secret is not set in Convex.
- **Convex shows `n8n responded with HTTP 401`**: `N8N_WEBHOOK_SECRET` in Convex
  and `LENDLOOP_N8N_WEBHOOK_SECRET` in `n8n/.env` differ.
- **`n8n Task Broker's port 5679 is already in use`** when running
  `n8n execute`: add `-e N8N_RUNNERS_BROKER_PORT=5681` as shown above.
- **Nothing reaches Convex from the container**: check
  `docker compose exec n8n wget -qO- http://host.docker.internal:3211/health`.
- Execution data stored by n8n includes webhook payloads (recipient email);
  it is pruned after 7 days by default. Lower `N8N_EXECUTIONS_MAX_AGE_HOURS`
  (shell variable read by compose) if needed.

## Production notes

Use the deployment's `https://<name>.convex.site` as `LENDLOOP_CONVEX_SITE_URL`,
expose n8n over HTTPS and set `N8N_PUBLIC_WEBHOOK_URL` (compose) and Convex
`N8N_WEBHOOK_URL` to the public webhook URL, generate fresh secrets per
environment, and back up the `n8n_data` volume together with
`N8N_ENCRYPTION_KEY`.
