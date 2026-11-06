# Convex backend setup

This guide takes you from a fresh clone to a working LendLoop backend: database, functions, auth with Clerk, secrets, seed data and an admin account. The last two sections cover production deployment and troubleshooting.

Convex hosts everything in `convex/`: the schema, queries and mutations, actions (OTP, email, n8n delivery), HTTP endpoints for n8n, crons and file storage. The Next.js app talks to it over a live WebSocket.

---

## 0. Prerequisites

- Node.js 20.9+ and npm. Run `npm install` in the repo root.
- A Clerk application. See step 2; you only need its keys and Frontend API URL.
- Optional: a Convex account (free) at https://dashboard.convex.dev. Without one you can run Convex locally.

---

## 1. Create a dev deployment

Choose **one** of these options.

### Option A — Convex cloud (recommended)

```bash
npx convex login            # opens the browser once
npx convex dev              # choose "create a new project", e.g. "lendloop"
```

`npx convex dev`:
- creates a **dev deployment**;
- writes `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` (and `NEXT_PUBLIC_CONVEX_SITE_URL`) into `.env.local`;
- pushes the functions;
- keeps watching `convex/` for changes.

Leave it running in its own terminal. The dashboard (data, logs, functions, crons, env vars) is at https://dashboard.convex.dev.

### Option B — Local, no account

```bash
npx convex dev              # choose "Start without an account (run Convex locally)"
# or non-interactively:
CONVEX_AGENT_MODE=anonymous npx convex dev
```

This downloads the open-source Convex backend and runs it on your machine:
- client API: `http://127.0.0.1:3210`
- HTTP actions: `http://127.0.0.1:3211`

The URLs are written to `.env.local`. Data lives in `.convex/`, which is git-ignored.

> The first `npx convex dev` will fail with *"Environment variable CLERK_JWT_ISSUER_DOMAIN is used in auth config file but its value was not set"*. That's expected — step 3 fixes it.

---

## 2. Connect Clerk (authentication)

Convex verifies the JWT that Clerk issues for each signed-in user (`convex/auth.config.ts`, audience `convex`).

1. In the **Clerk Dashboard**, open your application.
2. Make Clerk issue Convex tokens. Use **either** of these:
   - **Integrations → Convex → Activate.** This is Clerk's native Convex integration; its exact place in the dashboard menu may vary.
   - **Configure → JWT templates → New template → "Convex" preset.** The template **must be named `convex`**.
3. Copy your **Frontend API URL** (Clerk → Configure → API keys, or the template's *Issuer*), e.g. `https://your-app-12.clerk.accounts.dev`.
4. Put the Clerk keys in `.env.local` (see `.env.example`):
   ```
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…
   CLERK_SECRET_KEY=sk_test_…
   ```

> No Clerk account yet? `npx clerk@latest init --accountless --framework next` writes temporary development keys to `.env.local`. You can claim the app later with `clerk auth login`.

---

## 3. Set the backend environment variables

Convex environment variables are **separate** from `.env.local`; they live on the deployment. The helper script generates fresh random secrets (it never prints them) and sets everything a development deployment needs:

```bash
sh scripts/setup-convex-env.sh https://your-app-12.clerk.accounts.dev
```

Or set them by hand with `npx convex env set NAME value` (add `--prod` for production):

| Variable | Required | What it does |
| --- | --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | **yes** | Clerk Frontend API URL from step 2 |
| `OTP_PEPPER` | **yes** | ≥32 random chars. Key for hashing pickup/return codes (`openssl rand -hex 32`). |
| `APP_URL` | recommended | Base URL used in email links (`http://localhost:3000` in dev) |
| `EMAIL_DELIVERY_MODE` | optional | `mock` (default: codes appear in the in-app **Dev mailbox**) or `smtp` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `EMAIL_FROM` | with `smtp` | Real email for hand-over codes |
| `AUTOMATION_INBOUND_SECRET` | for n8n | Verifies n8n → Convex requests. Same value as n8n's `LENDLOOP_AUTOMATION_SECRET`. |
| `N8N_WEBHOOK_URL` `N8N_WEBHOOK_SECRET` | for n8n | Where Convex sends notification events, and the signing key. See `docs/N8N_SETUP.md`. |
| `SEED_ENABLED` | dev only | `true` enables `seed:run` / `seed:reset` |
| `DEPLOYMENT_ENV` | prod | `production` forbids storing codes in the mock mailbox |

Check what's set (names only — values stay secret):

```bash
npx convex env list --names-only
```

After setting `CLERK_JWT_ISSUER_DOMAIN`, the running `npx convex dev` pushes successfully. If it has exited, restart it.

---

## 4. Seed the sample neighbourhood (optional)

```bash
npm run seed          # = npx convex run seed:run && node scripts/seed-images.mjs
npm run seed:reset    # removes every seed record (and seed photos)
npx convex run seed:refresh   # re-sync seed tool text after editing convex/seed.ts (keeps history)
```

This creates 8 sample members and 19 tools around Indiranagar, Bengaluru, plus loan history, reviews and a damage report. The tools get licensed demo photos from `seed-assets/`. Everything is marked **Sample** in the UI, and seed accounts can't sign in or receive email.

---

## 5. Run the app and create your account

```bash
npm run dev           # http://localhost:3000
```

1. Sign up, then complete onboarding.
2. Make yourself an administrator. Roles can only change server-side; there is no client path to ADMIN.
   ```bash
   npx convex run admin:setRoleByEmail '{"email":"you@example.com","role":"ADMIN"}'
   ```
3. Reload the app. **Admin** now appears in the left rail.

To test a full loan you need two people: use a second browser or a private window for the borrower. In `mock` email mode, the pickup and return codes are in **Account menu → Dev mailbox**. The borrower can also press *Show pickup code* on the loan page.

---

## 6. Verify the backend

```bash
# HTTP actions are up (local: http://127.0.0.1:3211, cloud: https://<deployment>.convex.site)
curl "$(grep NEXT_PUBLIC_CONVEX_SITE_URL .env.local | cut -d= -f2)/health"
# → {"ok":true,"service":"lendloop-convex"}

# Public data works without auth
npx convex run tools:publicPreview

# The automated test-suite exercises every function against an in-memory Convex
npm test
```

In the dashboard you should see:
- the tables (`users`, `tools`, `loans`, …);
- four crons: overdue loans, stale requests, missed pickups, housekeeping;
- function logs.

---

## 7. Deploy to production

1. In the Convex dashboard, open the project → **Settings → Deploy keys** → create a **production deploy key**.
2. Set the production environment once:
   ```bash
   npx convex env set --prod CLERK_JWT_ISSUER_DOMAIN https://clerk.yourdomain.com
   npx convex env set --prod OTP_PEPPER "$(openssl rand -hex 32)"
   npx convex env set --prod AUTOMATION_INBOUND_SECRET "$(openssl rand -hex 32)"
   npx convex env set --prod APP_URL https://lendloop.yourdomain.com
   npx convex env set --prod EMAIL_DELIVERY_MODE smtp
   npx convex env set --prod DEPLOYMENT_ENV production
   # + SMTP_* and N8N_* — never SEED_ENABLED
   ```
   The Clerk production instance needs its own `convex` JWT template, or the Convex integration activated.
3. Build and deploy together (e.g. as the Vercel build command), with `CONVEX_DEPLOY_KEY` set in the hosting environment:
   ```bash
   npx convex deploy --cmd 'npm run build'
   ```
   This pushes the functions to production and builds Next.js against the production `NEXT_PUBLIC_CONVEX_URL`.
4. Promote the first admin:
   ```bash
   npx convex run --prod admin:setRoleByEmail '{"email":"you@example.com","role":"ADMIN"}'
   ```

Production checklist:
- Enable Convex scheduled **backups**.
- Restrict your Mapbox token to your domain.
- Point n8n at `https://<prod-deployment>.convex.site`.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN … value was not set` on push | Run step 3. |
| App says *"We couldn't verify your session with the backend"* | Convex rejected the Clerk token. Check that there is a JWT template named exactly `convex` (or the Convex integration is active), and that `CLERK_JWT_ISSUER_DOMAIN` equals that instance's Frontend API URL — no trailing slash, same dev/prod instance. |
| Stuck on the loading splash after sign-in | `NEXT_PUBLIC_CONVEX_URL` missing or wrong in `.env.local`. Restart `npm run dev` after editing it. |
| *"Hand-over codes are not configured (OTP_PEPPER)"* | Set `OTP_PEPPER` (≥32 chars). |
| `Seeding is disabled` | `npx convex env set SEED_ENABLED true` (dev deployments only). |
| `Function execution timed out (maximum duration: 1s)` locally | The local backend was starved of CPU, e.g. during the first Next.js compile. Reload; it doesn't happen on cloud deployments. |
| Admin → Automation shows events as **SKIPPED** | `N8N_WEBHOOK_URL` / `N8N_WEBHOOK_SECRET` are not set. Expected until you set up n8n. |
| `npx convex run` talks to the wrong deployment | It uses `CONVEX_DEPLOYMENT` from `.env.local`. Use `--prod` for production. |
