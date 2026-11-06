# n8n automation setup

n8n sends LendLoop's notification emails and daily overdue reminders. Convex remains the source of truth: it decides what to send, signs every webhook, deduplicates deliveries and retries failures. n8n receives, verifies, sends (or mocks) and reports back.

```
Convex ──(HMAC-signed webhook)──▶ n8n  A: Request notification ──▶ email (or mock)
   ▲                                │   B: Daily overdue reminders (09:00 UTC)
   └──(HMAC-signed HTTP calls)──────┘   C: Error handler (records failures in Convex)
```

Workflow files live in `n8n/workflows/`. They have fixed IDs and contain no credentials. For deeper reference — signing details, re-importing, exporting edits — see [`n8n/README.md`](../n8n/README.md).

---

## 0. Prerequisites

- **Docker** with Compose v2 (`docker compose version`).
- The **Convex backend running** (`docs/CONVEX_SETUP.md`). You need its HTTP actions URL:
  - local: `http://127.0.0.1:3211`
  - cloud: `https://<deployment>.convex.site` (shown in the Convex dashboard)
- `AUTOMATION_INBOUND_SECRET` already set on Convex (`scripts/setup-convex-env.sh` does this).

---

## 1. Create the n8n settings file

```bash
cp n8n/.env.example n8n/.env
openssl rand -hex 32                           # → N8N_ENCRYPTION_KEY
openssl rand -hex 32                           # → LENDLOOP_N8N_WEBHOOK_SECRET
npx convex env get AUTOMATION_INBOUND_SECRET   # → LENDLOOP_AUTOMATION_SECRET
```

Edit `n8n/.env` (git-ignored) and fill in:

```ini
N8N_ENCRYPTION_KEY=<random 64 hex>            # keep it stable: it encrypts n8n credentials
LENDLOOP_N8N_WEBHOOK_SECRET=<random 64 hex>   # must equal Convex N8N_WEBHOOK_SECRET
LENDLOOP_AUTOMATION_SECRET=<from Convex>      # must equal Convex AUTOMATION_INBOUND_SECRET
LENDLOOP_CONVEX_SITE_URL=http://host.docker.internal:3211   # cloud: https://<deployment>.convex.site
LENDLOOP_EMAIL_MODE=mock                      # mock | smtp
LENDLOOP_EMAIL_FROM=LendLoop <no-reply@example.com>
```

## 2. Tell Convex where n8n is

```bash
npx convex env set N8N_WEBHOOK_URL http://127.0.0.1:5678/webhook/lendloop-events
npx convex env set N8N_WEBHOOK_SECRET <same value as LENDLOOP_N8N_WEBHOOK_SECRET>
```

## 3. Start n8n and import the workflows

```bash
docker compose up -d                 # n8n on http://127.0.0.1:5678 (loopback only)
sh n8n/scripts/import-workflows.sh   # imports A, B, C, publishes them, restarts n8n once
```

Open **http://localhost:5678** and create the n8n owner account; this is only asked on the first visit. You should then see three published workflows:
- **LendLoop - Request Notification**
- **LendLoop - Daily Overdue Reminders**
- **LendLoop - Error Handler**

```bash
docker compose exec n8n n8n list:workflow --active=true   # should list all three
```

## 4. Test it

**Without the app.** The script signs a request exactly as Convex does:

```bash
node n8n/scripts/send-test-event.mjs                   # 200 {"ok":true,"status":"unknown"} (random event id)
node n8n/scripts/send-test-event.mjs --bad-signature   # 401
node n8n/scripts/send-test-event.mjs --stale           # 401
node n8n/scripts/send-test-event.mjs --malformed       # 400
```

**With the app (end to end).**
1. With two accounts, create a borrow request, then approve it.
2. As an admin, open **Admin → Automation**.
   - Under **Recent deliveries**, the events should show `DELIVERED`, with an n8n result of `MOCKED` (or `SENT` in smtp mode).
   - n8n's **Executions** tab shows each run.

**Workflow B (overdue reminders).** It runs daily at 09:00 UTC. To run it now, open the workflow in n8n and click **Execute workflow**. Each run is recorded under **Admin → Automation → Workflow runs**. It reminds each overdue loan at most once per day.

**Workflow C (errors).** Any failure in A or B appears under **Admin → Automation → Failures**, with secrets and emails redacted.

## 5. Send real email (optional)

1. In n8n: **Credentials → Add credential → SMTP**. Name it exactly **`LendLoop SMTP`** and enter your provider's host, port, user and password (Postmark, SES, Resend, Mailgun, …).
2. Set `LENDLOOP_EMAIL_MODE=smtp` and a real `LENDLOOP_EMAIL_FROM` in `n8n/.env`.
3. Apply the change:
   ```bash
   docker compose up -d                 # recreate with the new env
   sh n8n/scripts/import-workflows.sh   # re-import links the credential by name
   ```

> Pickup and return **codes** never go through n8n. Convex emails them itself, using `EMAIL_DELIVERY_MODE=smtp` and `SMTP_*` on Convex (see `docs/CONVEX_SETUP.md`).

---

## Using a Convex **cloud** deployment

Cloud Convex can't reach `127.0.0.1` on your laptop, so n8n must be reachable over **public HTTPS**:

- **Development:** expose the local n8n with a tunnel, e.g.
  ```bash
  cloudflared tunnel --url http://localhost:5678    # or: ngrok http 5678
  ```
  Then set:
  ```bash
  npx convex env set N8N_WEBHOOK_URL https://<tunnel-host>/webhook/lendloop-events
  ```
  In `n8n/.env`, set `LENDLOOP_CONVEX_SITE_URL=https://<deployment>.convex.site`, then run `docker compose up -d`.
- **Production:** run n8n on a server behind HTTPS (or use n8n Cloud).
  - Set `N8N_PUBLIC_WEBHOOK_URL=https://n8n.yourdomain.com/` when starting compose, so n8n generates correct webhook URLs.
  - Use `--prod` for the Convex env vars.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Admin → Automation shows **SKIPPED** | Convex has no `N8N_WEBHOOK_URL` / `N8N_WEBHOOK_SECRET` (step 2). |
| Events **FAILED → DEAD** with `HTTP 404` | Workflow A isn't published, or the URL path is wrong. Re-run `import-workflows.sh`. Convex keeps retrying with backoff; use **Retry** in the admin panel once it's fixed. |
| n8n responds **401** | `LENDLOOP_N8N_WEBHOOK_SECRET` ≠ Convex `N8N_WEBHOOK_SECRET`, or the clocks differ by more than 5 minutes. |
| n8n can't reach Convex (`ECONNREFUSED`) | Wrong `LENDLOOP_CONVEX_SITE_URL`. From inside Docker, the local backend is `http://host.docker.internal:3211`, not `127.0.0.1`. |
| Convex answers **401** to n8n | `LENDLOOP_AUTOMATION_SECRET` ≠ Convex `AUTOMATION_INBOUND_SECRET`. |
| Convex answers **503** | `AUTOMATION_INBOUND_SECRET` isn't set on Convex. |
| **409 in_progress** in executions | Another execution is already sending that event. This is expected under retries and stops duplicate emails. |
| Workflows imported but not triggering | Publishing via CLI needs a restart. The import script does it; otherwise run `docker compose restart n8n`. |
| Edits made in the n8n UI disappeared | Re-importing overwrites workflows by ID. Export your changes first (see `n8n/README.md`). |
| Port 5678 already in use | Another n8n is running, e.g. an old Docker Desktop context. Stop it with `docker compose down` in that context. |
