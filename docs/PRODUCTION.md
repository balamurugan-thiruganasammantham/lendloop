# LendLoop in production — what's live, what to click, what to expect

This is the operator's guide for the live deployment. It assumes **no custom domain** (free addresses only). Section 6 explains what changes if you buy one later.

Values marked *(secret)* are not in this repository. Your copy of every value is in the git-ignored `secrets/` folder on the machine that did the deployment.

---

## 1. What is live

| Piece | Address | Dashboard |
| --- | --- | --- |
| Website (Next.js on Vercel) | **https://lendloopapp.vercel.app** | https://vercel.com/infobalamurugan22-2290s-projects/lendloop |
| Backend (Convex, production deployment `acrobatic-alpaca-862`, eu-west-1) | `https://acrobatic-alpaca-862.eu-west-1.convex.cloud` (client) · `https://acrobatic-alpaca-862.eu-west-1.convex.site/health` (HTTP) | https://dashboard.convex.dev/t/bala-murugan-fce20/lendloop/acrobatic-alpaca-862 |
| Automation (n8n on Render, Frankfurt, free) | **https://looplend-n8n.onrender.com** | https://dashboard.render.com/web/srv-dbmq1r0m7kps73c2564g |
| n8n database (Render Postgres, free, **expires 2026-12-06**) | internal only | https://dashboard.render.com/d/dpg-dbmq10jrjlhs73c6nes0-a |
| Sign-in (Clerk, **development** instance `humble-stork-7162`) | `https://humble-stork-7162.clerk.accounts.dev` | https://dashboard.clerk.com |
| Email (Resend, free) | `smtp.resend.com:465` | https://resend.com/emails |
| Code + CI/CD (GitHub, private) | https://github.com/balamurugan-thiruganasammantham/lendloop | Actions: https://github.com/balamurugan-thiruganasammantham/lendloop/actions |

`lendloop.vercel.app`, `lend-loop.vercel.app` and `lendloop-app.vercel.app` were already taken by other Vercel users; `lendloopapp.vercel.app` was the closest free name.

### What "production" means without a domain

| Area | Live now | Needs a domain you own |
| --- | --- | --- |
| Website, backend, automation, CI/CD | ✅ Production deployments | — |
| Sign-in | ✅ Works for everyone, on Clerk's **development** keys (the "Development mode" label is hidden with Clerk's `unsafe_disableDevelopmentModeWarnings` appearance option) | Clerk production instance (no 100-user cap) |
| Google sign-in | ✅ Works; Google's screen says "accounts.dev" | Your own app name + logo on Google's screen |
| Hand-over code emails | ✅ Sent by Convex through Resend, **but only to your Resend account email** | Emails to every user |
| n8n notification emails | Recorded, not emailed (Render Free blocks SMTP) | — (needs a paid host or Oracle VM, not a domain) |

---

## 2. Do these now (free, about 20 minutes)

### 2.1 Make Google sign-in work for everyone

If you created your own Google OAuth client and switched it on in Clerk ("Use custom credentials"), Google only lets **test users** sign in until the app is published. Pick **one** option.

**Option A — use Clerk's shared Google login (simplest, recommended without a domain)**
1. Open https://dashboard.clerk.com → app **Leenloop** → **Development** → **Configure** → **SSO connections**.
2. Click **Google** (or its ⚙ icon).
3. Turn **Use custom credentials** **off** → **Save**.
4. *Expect:* anyone can sign in with Google. Google's screen reads "Sign in to accounts.dev" / "to continue to clerk.accounts.dev".

**Option B — keep your own Google client and publish it**
1. Open https://console.cloud.google.com/auth/audience (select your project at the top).
2. Under **Publishing status: Testing**, click **Publish app** → **Confirm**.
3. *Expect:* status changes to **In production**. Because LendLoop only asks for `openid`, `email` and `profile` (non-sensitive), Google does **not** require verification and shows no "unverified app" warning.
4. Open https://console.cloud.google.com/auth/clients → your **Web client** → **Authorized JavaScript origins** → **Add URI** → `https://lendloopapp.vercel.app` → **Save**. Leave the redirect URI as the Clerk one (`https://humble-stork-7162.clerk.accounts.dev/v1/oauth_callback`).
5. *Expect:* the Google screen still says "accounts.dev". Your name and logo only appear after **brand verification**, which needs a domain you own (section 6).

### 2.2 Check the Clerk settings that block sign-ups

Both are in https://dashboard.clerk.com → **Leenloop** → **Development** → **Configure**:

| Page | Setting | Must be |
| --- | --- | --- |
| **Organizations → Settings** | Danger zone → **Disable organizations** (or Membership options → **Membership optional**) | Disabled / optional. Otherwise every new user sees "Setup your organization". |
| **Protect → Protections** | **Require Device Intelligence checks** | Off. Otherwise visitors with ad/tracker blockers get "We couldn't complete this request". |

Optional: rename the application from "Leenloop" to "LendLoop" (application **Settings** page) so the sign-in card says "Sign in to LendLoop".

### 2.3 Restrict the Mapbox token to your sites

1. Open https://account.mapbox.com/access-tokens/ → click the token used by LendLoop (starts with `pk.`; it is `NEXT_PUBLIC_MAPBOX_TOKEN` in `secrets/vercel.production.env`).
2. **URL restrictions** → add `https://lendloopapp.vercel.app` and `http://localhost:3000` → **Update token**.
3. *Expect:* the live map still loads; the token no longer works on other websites.

### 2.4 Make yourself an administrator on production

1. Open https://lendloopapp.vercel.app → **Sign up** → finish onboarding.
2. On your computer, in the project folder:
   ```bash
   npx convex run --prod admin:setRoleByEmail '{"email":"YOUR_SIGN_IN_EMAIL","role":"ADMIN"}'
   ```
3. Reload the site. *Expect:* **Admin** appears in the left rail. **Admin → Automation** shows deliveries to n8n.

### 2.5 Log in to n8n and change its password

1. Open https://looplend-n8n.onrender.com (the first request after 15 idle minutes takes ~1 minute: Render Free wakes the service).
2. Sign in with the owner account in `secrets/accounts.md` (email `infobalamurugan22@gmail.com`).
3. Bottom-left avatar → **Settings** → **Personal** → change the password.
4. *Expect:* **Workflows** lists *LendLoop - Request Notification*, *LendLoop - Daily Overdue Reminders* and *LendLoop - Error Handler*, all **Published**.

### 2.6 Rotate the credentials that were pasted in chat

These values were shared in plain text during setup. Replace them, then update the places that use them.

| Credential | Create the new one at | Then update | Delete the old one |
| --- | --- | --- | --- |
| **GitHub token** (`ghp_…`, has admin + delete-repo rights) | Not needed by CI (it uses GitHub's built-in token). Create one only for local pushes: https://github.com/settings/personal-access-tokens/new (fine-grained, *only* this repo, Contents: read/write) | Nothing | https://github.com/settings/tokens → **Delete** |
| **Vercel token** (`vcp_…`) | https://vercel.com/account/settings/tokens → **Create** (scope: your team) | GitHub → https://github.com/balamurugan-thiruganasammantham/lendloop/settings/secrets/actions → `VERCEL_TOKEN` → **Update** | same Vercel page → old token → **Delete** |
| **Render API key** (`rnd_…`) | https://dashboard.render.com/u/settings#api-keys → **Create API Key** | GitHub secret `RENDER_API_KEY` | same page → **Delete** |
| **Resend API key** (`re_…`, also the SMTP password) | https://resend.com/api-keys → **Create API Key** (Sending access) | `npx convex env set --prod SMTP_PASS <new>`; `npx convex env set SMTP_PASS <new>` (dev); your local `.env.convex.local` | same page → **Revoke** |
| **Clerk secret key** (`sk_test_…`) | https://dashboard.clerk.com → **Configure → API keys** → **Add new key** | Vercel → https://vercel.com/infobalamurugan22-2290s-projects/lendloop/settings/environment-variables → `CLERK_SECRET_KEY` → **Edit**; local `.env.local`; then re-run the deploy (section 5) | API keys page → old key → **Revoke** |

*Expect after each change:* push to `main` (or Actions → Deploy → **Run workflow**) and the pipeline goes green.

---

## 3. Free-plan limits you will notice

| Service | Limit | What happens / what to do |
| --- | --- | --- |
| Clerk development instance | Max **100 users** (the "Development mode" label is hidden in the UI, but the instance is still a development one) | Fine for a demo. Section 6 for production. |
| Resend without a domain | Sends only **to your Resend account email**, from `onboarding@resend.dev`; 100 emails/day | Other users don't get code emails; they press **Show pickup code** on the loan page instead. |
| Render Free (n8n) | Sleeps after **15 min** idle (~1 min to wake); **SMTP blocked**; 750 h/month | Convex retries webhooks (≈30 s, 2 min, 10 min, 30 min, 2 h), so nothing is lost. n8n email mode stays `mock`. The 09:00 UTC overdue run only fires if n8n is awake. |
| Render Free Postgres | **Deleted after 30 days** (expires **2026-12-06**, 14-day grace) | Before then, follow section 4. |
| Vercel Hobby | Non-commercial use only | Upgrade to Pro before charging money or showing ads. |
| Convex Free | 1M function calls, 0.5 GB DB, 1 GB files / month | Usage: Convex dashboard → **Usage**. |

---

## 4. Before 2026-12-06: move n8n's database to Neon (free, no expiry)

1. https://neon.com → **Sign up** → **Create project** `looplend-n8n` (region: **AWS Europe Central (Frankfurt)**).
2. On the project page click **Connect** → turn **Connection pooling off** → copy host, database, user and password.
3. Render → https://dashboard.render.com/web/srv-dbmq1r0m7kps73c2564g → **Environment** → edit:
   `DB_POSTGRESDB_HOST`, `DB_POSTGRESDB_DATABASE`, `DB_POSTGRESDB_USER`, `DB_POSTGRESDB_PASSWORD` (Neon values), and **add** `DB_POSTGRESDB_SSL_ENABLED` = `true` → **Save, rebuild, and deploy**.
4. *Expect:* the first start on the empty database takes ~5 minutes (migrations + workflow import), then the logs show "n8n ready on 0.0.0.0, port 5678".
   The very first boot on a new database also does one-time setup that needs more memory than the normal 256 MB heap cap. If the log shows `JavaScript heap out of memory` on that first boot, add `LENDLOOP_N8N_HEAP_MB` = `400` in **Environment**, let it start once (look for "Instance registered"), then **delete** the variable so later starts use the safe default.
5. Open https://looplend-n8n.onrender.com → n8n asks you to **set up the owner account** again (new database) → do it immediately.
6. Delete the old Render database: https://dashboard.render.com/d/dpg-dbmq10jrjlhs73c6nes0-a → **Settings** → **Delete Database**.

(Alternative: Render → the database → **Upgrade** to a paid plan and nothing else changes.)

---

## 5. Day-to-day operations

| Task | How | Expect |
| --- | --- | --- |
| Deploy | `git push origin main` | Actions → **Deploy**: CI → Convex → Vercel (+ n8n if `n8n/` changed) → smoke test, all green in ~8–12 min |
| Deploy without a code change | https://github.com/balamurugan-thiruganasammantham/lendloop/actions/workflows/deploy.yml → **Run workflow** (tick *Redeploy n8n on Render* if needed) | Same as above |
| Check a pull request | Open a PR | **CI** runs lint, types, tests, build, n8n image |
| Roll back the website | Vercel → **Deployments** → a previous production deployment → ⋯ → **Promote to Production** (Instant Rollback) | Old version live within seconds. Convex is not rolled back; revert the commit and push for that. |
| Website logs | Vercel project → **Logs** | Request logs of the API routes (geocode/directions) and server rendering |
| Backend logs / data | Convex dashboard → **Logs**, **Data**, **Functions**, **Schedules** | Every query/mutation/action, crons (overdue loans, stale requests, missed pickups, housekeeping) |
| Automation | Website **Admin → Automation**; n8n **Executions** | Deliveries `DELIVERED` (n8n result `MOCKED`), runs, failures |
| n8n service logs | Render → service → **Logs** | "LendLoop workflows unchanged …: skipping import." on restarts |
| Change a production env var | Convex: `npx convex env set --prod NAME value`; Vercel: project → Settings → Environment Variables (then redeploy); Render: service → Environment | Convex applies instantly; Vercel needs a new deploy; Render redeploys |
| Remove the sample data | `npx convex env set --prod SEED_ENABLED true && npx convex run --prod seed:reset && npx convex env remove --prod SEED_ENABLED` | All "Sample" members, tools, loans and photos removed; real data untouched |

### Reading the n8n logs on Render

| Log line | Meaning | Action |
| --- | --- | --- |
| `Importing LendLoop workflows (<hash>)…` then `Publishing workflow …` ×3 | The workflow files changed (or the database is new): one-time import, ~4–5 min on 0.1 CPU | Wait |
| `No open ports detected, continuing to scan...` | Render waiting while that import runs | Wait (it continues scanning) |
| `LendLoop workflows unchanged (<hash>): skipping import.` | Normal restart / wake-up | — |
| `n8n ready on 0.0.0.0, port 5678` → `Your service is live 🎉` | Up | — |
| `Task runner … invalid or expired grant token` / `[runner:js] … 403` | The code runner started slower than its token lifetime; it retries. The image sets `N8N_RUNNERS_GRANT_TOKEN_TTL=120` to avoid it | Only act if it repeats forever: raise the value in Render → Environment |
| `Failed to start Python task runner …` | No Python in the image; LendLoop only uses JavaScript Code nodes | Ignore |
| `There are deprecations…`, `DeprecationWarning: Calling client.query()…` | Informational | Ignore |
| `Postgres 16 is outside the supported range…` | Works ("compatibility support"); Neon (section 4) uses PostgreSQL 17 | Fixed by the move in section 4 |
| `Database ping failed (1/3)` once | A slow ping while the CPU is busy; it recovers | Ignore unless it reaches 3/3 |
| `Port scan timeout reached` followed by restarts | n8n never opened its port | Check `N8N_LISTEN_ADDRESS=0.0.0.0` and the database variables |
| `n8n ready …` then, ~1 minute later, the start-up lines again (no error) | The container was killed for using more than Render Free's **512 MB** | The image caps n8n's heap at 256 MB (`LENDLOOP_N8N_HEAP_MB`) and the code runner at 96 MB (`N8N_RUNNERS_MAX_OLD_SPACE_SIZE`). Don't raise them on the free plan. |
| `FATAL ERROR: … JavaScript heap out of memory` | The heap cap is too small for the work n8n is doing | Raise `LENDLOOP_N8N_HEAP_MB` a little (e.g. 288) only if memory allows; otherwise a paid instance |

---

## 6. Later: going fully production with your own domain

Only needed to remove the Clerk development limits, show your own name/logo on Google, and email every user. You need a domain (≈ $10/year, e.g. Cloudflare Registrar or Namecheap). Example below: `lendloop.in`.

### 6.1 Point the domain at Vercel
1. Vercel → project → **Settings → Domains** → **Add** → `lendloop.in` (and `www.lendloop.in`).
2. Add the DNS records Vercel shows (an `A` record and a `CNAME`) at your registrar.
3. *Expect:* "Valid Configuration" with a certificate within minutes.

### 6.2 Clerk production instance
1. https://dashboard.clerk.com → **Leenloop** → top bar **Go to prod** (or the instance switcher → **Production** → **Create production instance**).
2. Choose **Clone development instance** (copies sign-in options and settings), enter `lendloop.in` → **Create instance**.
3. **Configure → Domains**: Clerk lists ~5 DNS records (`clerk.lendloop.in`, `accounts.lendloop.in`, email DKIM records). Add them at your registrar → **Verify**. *Expect:* all green, then "SSL certificates issued" (can take up to an hour).
4. **SSO connections → Google**: production **requires your own Google client** (custom credentials). Copy the **Authorized Redirect URI** shown (`https://clerk.lendloop.in/v1/oauth_callback`).
5. **JWT templates → New template → Convex** preset, name **`convex`** → **Save**.
6. Re-check **Organizations** (disabled) and **Protect** settings in the production instance.
7. **API keys**: copy `pk_live_…` and `sk_live_…`.
8. Vercel env vars: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = `pk_live_…`, `CLERK_SECRET_KEY` = `sk_live_…`. GitHub variable `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = `pk_live_…`.
9. `npx convex env set --prod CLERK_JWT_ISSUER_DOMAIN https://clerk.lendloop.in`
10. Push to `main`. *Expect:* sign-in card without the "Development mode" badge. Users from the development instance must sign up again.

### 6.3 Google: your own client, branding, publish
1. https://console.cloud.google.com/auth/clients → **Create client** → *Web application* → origins `https://lendloop.in` → redirect URI from step 6.2.4 → **Create** → copy ID + secret into Clerk (production → SSO connections → Google → custom credentials) → **Save**.
2. https://console.cloud.google.com/auth/branding → App name **LendLoop**, logo `public/brand/lendloop-logo-120.png`, home page `https://lendloop.in`, privacy `https://lendloop.in/privacy`, terms `https://lendloop.in/terms` (these pages need to exist first), **Authorized domains** `lendloop.in` → **Save**.
3. Verify domain ownership when asked (Google Search Console, DNS TXT record).
4. **Verify branding** → *Expect:* "Ready to publish" (usually minutes) → **Publish branding**.
5. https://console.cloud.google.com/auth/audience → **Publish app** → **Confirm**.
6. *Expect:* Google's screen says "Sign in to LendLoop" with your logo.

### 6.4 Resend domain (emails to everyone)
1. https://resend.com/domains → **Add Domain** → `lendloop.in` → add the DKIM/SPF/MX records shown → **Verify**. *Expect:* **Verified**.
2. `npx convex env set --prod EMAIL_FROM "LendLoop <no-reply@lendloop.in>"`
3. *Expect:* pickup/return code emails reach every borrower.

### 6.5 Final updates
- `npx convex env set --prod APP_URL https://lendloop.in`
- GitHub variable `APP_URL` = `https://lendloop.in`; `GEOCODER_USER_AGENT` on Vercel = `LendLoop/1.0 (+https://lendloop.in)`
- Mapbox token URL restriction: add `https://lendloop.in`.
- n8n emails: Render paid instance (SMTP allowed) or Oracle VM (`docs/DEPLOY.md` §6B), then `LENDLOOP_EMAIL_MODE=smtp` + the "LendLoop SMTP" credential.
