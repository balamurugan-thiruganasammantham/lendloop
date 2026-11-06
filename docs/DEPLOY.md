# Deploy LendLoop for free

This guide puts LendLoop on the internet using only free plans. It is written for a demo or assessment deployment; the last section lists what changes for a real launch.

Free-plan limits and policies change. Every figure below was checked on **2026-11-06**; the links in [Limits and sources](#limits-and-sources) let you re-check them.

---

## 0. What runs where

LendLoop is not one server. It is five services, and each one has its own free home:

| Piece | What it does | Free home | Status today |
| --- | --- | --- | --- |
| **Next.js app** | The website (pages, map, API routes for geocoding/routing) | **Vercel Hobby** | Not deployed yet |
| **Convex** | Database, backend functions, file storage, crons, HTTP endpoints, **sends the pickup/return code emails** | **Convex Free** (cloud) | Dev deployment running (`brave-ibex-89`); production deployment to create |
| **Clerk** | Sign-in (email + Google) | **Clerk Hobby** | Development instance running (`humble-stork-7162`) |
| **Resend** | Delivers email over SMTP | **Resend Free** | Working (tested from Convex cloud on 2026-11-06) |
| **n8n** | Notification emails, daily overdue reminders, error log | **Render Free** (with caveats), **Oracle Cloud Always Free**, or your laptop + a tunnel | Running locally in Docker |
| **Mapbox** | Map tiles and style | **Mapbox free tier** | Token in `.env.local` |

```
Browser ──HTTPS──▶ Vercel (Next.js)
   │                   │
   │ WebSocket         │ (no email, no database here)
   ▼                   │
Convex cloud ◀─────────┘
   │  ├─ SMTP 465 ──▶ Resend  (pickup/return codes)
   │  └─ signed webhook ──▶ n8n ──▶ email (notifications) ──▶ Resend
   ▲                          │
   └──── signed HTTP calls ───┘  (claim/report, overdue list)
```

### Your question: "On Render only the server port runs — will the email port be blocked?"

Two different things are mixed up here, and the answer is different for each:

1. **Inbound port.** A Render web service receives public traffic on **one** HTTP port: the one in the `PORT` variable. That is about *incoming* requests and has nothing to do with email. n8n listens on 5678, so you set `PORT=5678` and Render routes `https://<name>.onrender.com` to it.
2. **Outbound email.** Sending email means your server *connects out* to `smtp.resend.com` on port 465 or 587. Since **September 2025, Render's free web services block outbound traffic on ports 25, 465 and 587**. Paid Render instances allow 465/587. So yes: **n8n on Render Free cannot send email over SMTP.**

What that means for LendLoop:

| Email | Sent by | Works on free hosting? |
| --- | --- | --- |
| Pickup and return **codes** | **Convex** (cloud), over SMTP 465 | **Yes.** Verified: a test email from the Convex cloud deployment was accepted by Resend on 2026-11-06. It doesn't matter where the website runs. |
| "New request / approved / declined" notifications and overdue reminders | **n8n** | On **Render Free: no** (SMTP blocked). Keep n8n in `mock` mode there (deliveries are still recorded and visible in **Admin → Automation**), or host n8n on Oracle Cloud Always Free, where 465/587 are open. |
| Anything from the Next.js app | — | The website never sends email, so Vercel/Render rules don't matter for it. (Vercel only blocks port 25 anyway.) |

> Untested idea: Resend also accepts SMTP on ports **2465** and **2587**, which are not on Render's block list. Setting the n8n SMTP credential to port 2465 (SSL) might work on Render Free. Treat it as an experiment, not a promise.

---

## 1. Choose your path

| Path | Effort | Result |
| --- | --- | --- |
| **A. Vercel + Convex + Render (n8n in mock mode)** | ~1 hour | Everything online. Codes are emailed; n8n notifications are recorded but not emailed. n8n sleeps when idle. |
| **B. Vercel + Convex + Oracle VM (n8n)** | ~2 hours | Everything online and always on, including real n8n emails. Oracle signup can be slow. |
| **C. Vercel + Convex, n8n on your laptop + tunnel** | 15 minutes on demo day | Fine for a live demo; n8n is only online while your laptop is. |

All paths share sections 2–5. Then pick **6A**, **6B** or **6C** for n8n.

---

## 2. Before you start

You already have accounts for Convex, Clerk, Resend and Mapbox. You will also need:

- A **GitHub** account (Vercel and Render deploy from a repository).
- A **Vercel** account (sign in with GitHub).
- For path A: a **Render** account and a **Neon** account (free Postgres, so n8n doesn't lose its data on restarts).
- For path B: an **Oracle Cloud** account.

Install nothing new: you'll use `npx convex`, `git` and a browser.

---

## 3. Put the code on GitHub

1. Create an **empty private repository** on GitHub, e.g. `lendloop`.
2. Make sure no secrets get committed. These must all be ignored (they are, via `.gitignore`):
   `.env.local`, `.env.convex.local`, `n8n/.env`, `.clerk/`.
   ```bash
   git status --short | grep -E "\.env|\.clerk" || echo "no secret files staged"
   ```
3. Commit and push:
   ```bash
   git add -A
   git commit -m "LendLoop"
   git branch -M main
   git remote add origin https://github.com/<you>/lendloop.git
   git push -u origin main
   ```

---

## 4. Convex production deployment

Your project `lendloop` already has a **development** deployment (`brave-ibex-89`) that `npx convex dev` uses. The website should talk to a separate **production** deployment, created on first deploy.

### 4.1 Get a production deploy key

1. Open the Convex dashboard → project **lendloop**.
2. Switch the deployment selector at the top from *Development* to **Production**.
3. **Settings → URL & Deploy Key → Generate Production Deploy Key.** Copy it; you'll paste it into Vercel in step 5. Treat it like a password.

### 4.2 Set the production environment variables

Run these from the repo root. `--prod` targets the production deployment.

```bash
# Auth: the Clerk instance your users sign in with (here: the development instance; see section 7)
npx convex env set --prod CLERK_JWT_ISSUER_DOMAIN https://humble-stork-7162.clerk.accounts.dev

# Fresh secrets for production (never reuse the dev ones)
npx convex env set --prod OTP_PEPPER "$(openssl rand -hex 32)"
npx convex env set --prod AUTOMATION_INBOUND_SECRET "$(openssl rand -hex 32)"

# Email (Resend SMTP) – copies SMTP_* , EMAIL_FROM and EMAIL_DELIVERY_MODE=smtp from your local file
npx convex env set --prod --from-file .env.convex.local

# Production safety: refuse to keep codes in the in-app mock mailbox
npx convex env set --prod DEPLOYMENT_ENV production

# APP_URL is set in step 5.4, once Vercel gives you the address
```

Check (names only, values stay hidden):
```bash
npx convex env list --prod | sed 's/=.*//'
```

### 4.3 Push the backend once and seed demo data (optional)

The first Vercel build (step 5) pushes the functions automatically. If you want the sample neighbourhood on production for a demo, do it **after** step 5 has deployed once:

```bash
npx convex env set --prod SEED_ENABLED true
npx convex run --prod seed:run
node scripts/seed-images.mjs --prod
npx convex env remove --prod SEED_ENABLED      # switch seeding off again
```

---

## 5. Website on Vercel

### 5.1 Import the repository

1. vercel.com → **Add New… → Project** → import your `lendloop` repository.
2. **Framework Preset:** Next.js (detected automatically).
3. **Build Command** (Override): 
   ```
   npx convex deploy --cmd 'npm run build'
   ```
   This pushes the Convex functions to production *and* builds Next.js against the production Convex URL (it sets `NEXT_PUBLIC_CONVEX_URL` for the build itself).
4. Leave Install Command and Output Directory as default.

### 5.2 Environment variables

Add these under **Environment Variables** (scope: **Production**). Values come from your `.env.local`, except the deploy key.

| Name | Value |
| --- | --- |
| `CONVEX_DEPLOY_KEY` | The production deploy key from step 4.1 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_…` (from `.env.local`) |
| `CLERK_SECRET_KEY` | `sk_test_…` (from `.env.local`) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/explore` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/onboarding` |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `pk.…` (from `.env.local`) |
| `GEOCODER_USER_AGENT` | `LendLoop/1.0 (your-email@example.com)` — Nominatim's usage policy requires contact details |

Do **not** add `CONVEX_DEPLOYMENT` or `NEXT_PUBLIC_CONVEX_URL`; the build command provides the URL.

> Preview deployments (every pull request) would need their own *Preview* deploy key. If you don't add one, preview builds fail; production is unaffected. You can switch previews off under **Settings → Git**.

### 5.3 Deploy

Click **Deploy**. The first build takes 2–4 minutes. You get an address like `https://lendloop-<random>.vercel.app` (you can rename the project to get `https://lendloop.vercel.app` if it's free).

### 5.4 Tell the other services about the new address

```bash
npx convex env set --prod APP_URL https://<your-app>.vercel.app
```

- **Mapbox:** account.mapbox.com → Tokens → your token → **URL restrictions**: add `https://<your-app>.vercel.app` (and keep `http://localhost:3000` for development). Without a restriction anyone can reuse your token.
- **Clerk (development instance):** nothing to add; dev keys work on any domain.
- **Google sign-in with your own Google OAuth client** (optional): add `https://<your-app>.vercel.app` to **Authorized JavaScript origins**. The redirect URI stays the Clerk one.

### 5.5 Make yourself admin on production

Sign up on the live site, finish onboarding, then:
```bash
npx convex run --prod admin:setRoleByEmail '{"email":"you@example.com","role":"ADMIN"}'
```

---

## 6. n8n

Whichever option you choose, n8n and Convex **production** must share two secrets:

| n8n variable | must equal Convex (prod) variable |
| --- | --- |
| `LENDLOOP_N8N_WEBHOOK_SECRET` | `N8N_WEBHOOK_SECRET` |
| `LENDLOOP_AUTOMATION_SECRET` | `AUTOMATION_INBOUND_SECRET` |

and point at each other:

| Setting | Value |
| --- | --- |
| n8n `LENDLOOP_CONVEX_SITE_URL` | `https://<prod-deployment>.convex.site` (Convex dashboard → Production → Settings → *HTTP Actions URL*) |
| Convex `N8N_WEBHOOK_URL` | `https://<your-n8n-host>/webhook/lendloop-events` |

Generate the webhook secret once and set it on both sides:
```bash
SECRET=$(openssl rand -hex 32)
npx convex env set --prod N8N_WEBHOOK_SECRET "$SECRET"
echo "$SECRET"   # paste into n8n as LENDLOOP_N8N_WEBHOOK_SECRET, then clear your terminal
npx convex env get --prod AUTOMATION_INBOUND_SECRET   # paste into n8n as LENDLOOP_AUTOMATION_SECRET
```

Until `N8N_WEBHOOK_URL` is set, Convex marks notification events **SKIPPED** — the app keeps working.

### 6A. Render Free + Neon Postgres (n8n in mock mode)

Render's free plan has no persistent disk, so n8n's default SQLite file would be wiped on every restart (workflows, credentials, owner account gone). Neon gives n8n a free Postgres database that survives.

**Step 1 – Neon database**
1. neon.com → sign up → **Create project** `lendloop-n8n` (pick a region near Render's, e.g. Frankfurt/Oregon).
2. **Connect** → choose the **direct** connection (connection pooling **off**; n8n's migrations don't like a transaction pooler).
3. Note host (`ep-…neon.tech`), database (`neondb`), user and password.

**Step 2 – Render web service**
1. render.com → **New → Web Service** → connect your GitHub repo.
2. **Language/Runtime:** Docker. **Root Directory:** `n8n` (Render then uses `n8n/Dockerfile`, which bakes in the three workflows and imports + publishes them at every start).
3. **Instance type:** Free.
4. **Health check path:** `/healthz`.
5. **Environment variables:**

| Name | Value |
| --- | --- |
| `PORT` | `5678` (tells Render which port n8n listens on) |
| `WEBHOOK_URL` | `https://<service-name>.onrender.com/` |
| `N8N_HOST` | `<service-name>.onrender.com` |
| `N8N_PROTOCOL` | `https` |
| `N8N_PROXY_HOPS` | `1` |
| `N8N_ENCRYPTION_KEY` | `openssl rand -hex 32` — **never change it later**, it decrypts saved credentials |
| `DB_TYPE` | `postgresdb` |
| `DB_POSTGRESDB_HOST` | Neon host |
| `DB_POSTGRESDB_PORT` | `5432` |
| `DB_POSTGRESDB_DATABASE` | `neondb` |
| `DB_POSTGRESDB_USER` | Neon user |
| `DB_POSTGRESDB_PASSWORD` | Neon password |
| `DB_POSTGRESDB_SSL_ENABLED` | `true` |
| `LENDLOOP_N8N_WEBHOOK_SECRET` | from section 6 |
| `LENDLOOP_AUTOMATION_SECRET` | from section 6 |
| `LENDLOOP_CONVEX_SITE_URL` | `https://<prod-deployment>.convex.site` |
| `LENDLOOP_EMAIL_MODE` | `mock` (SMTP is blocked on Render Free) |
| `LENDLOOP_EMAIL_FROM` | `LendLoop <onboarding@resend.dev>` |

6. **Create Web Service.** The first start runs database migrations and imports the workflows (2–4 minutes).
7. Open `https://<service-name>.onrender.com` **immediately** and create the n8n owner account. Until you do, anyone who finds the URL could claim it.

**Step 3 – connect Convex**
```bash
npx convex env set --prod N8N_WEBHOOK_URL https://<service-name>.onrender.com/webhook/lendloop-events
```

**Living with Render Free**
- **Sleeps after 15 minutes without traffic** and takes about a minute to wake. Convex gives up on a webhook after 10 s and retries after ~30 s, ~2 min, ~10 min…, so the first notification after a quiet period arrives a minute or two late. Nothing is lost.
- **The daily 09:00 UTC overdue run won't fire while n8n is asleep.** If you need it, ping `https://<service-name>.onrender.com/healthz` every 10 minutes with a free uptime monitor (one always-on service fits in the 750 free hours a month; check Render's current terms first).
- **Edits made in the n8n UI are overwritten on the next restart** (the image re-imports the workflows). Export changes into `n8n/workflows/` and push.
- Neon's free compute suspends after 5 minutes idle and wakes on the next query (a short delay, no data loss).

### 6B. Oracle Cloud Always Free VM (always on, real emails)

An Always Free VM is a normal Linux server: Docker Compose works exactly as on your laptop, the disk persists, and outbound 465/587 are not blocked (only port 25 is).

1. **Create the VM.** cloud.oracle.com → Compute → Instances → **Create instance**: Ubuntu 24.04, shape **VM.Standard.A1.Flex** (1–2 OCPU, 6–12 GB RAM, Always Free) or **VM.Standard.E2.1.Micro**. Add your SSH public key. Note the **public IP**.
2. **Open ports 80 and 443.**
   - Networking → your VCN → Security List → **Add Ingress Rules**: source `0.0.0.0/0`, TCP, destination ports `80` and `443`.
   - On the VM (Oracle's Ubuntu images also filter with iptables):
     ```bash
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```
3. **Install Docker and get the code.**
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER && newgrp docker
   git clone https://github.com/<you>/lendloop.git && cd lendloop
   ```
4. **A free HTTPS hostname.** `sslip.io` maps `<ip-with-dashes>.sslip.io` to your IP, so Caddy can get a Let's Encrypt certificate without buying a domain. For IP `203.0.113.7` the host is `203-0-113-7.sslip.io`. (A domain of your own works the same way.)
5. **Create three files on the VM** (they stay on the server; don't commit them):

   `.env` (Compose variables):
   ```ini
   N8N_DOMAIN=203-0-113-7.sslip.io
   N8N_PUBLIC_WEBHOOK_URL=https://203-0-113-7.sslip.io/
   ```

   `Caddyfile`:
   ```
   {$N8N_DOMAIN} {
     reverse_proxy n8n:5678
   }
   ```

   `docker-compose.override.yml` (Compose loads it automatically):
   ```yaml
   services:
     n8n:
       environment:
         N8N_HOST: ${N8N_DOMAIN}
         N8N_PROTOCOL: https
         N8N_PROXY_HOPS: "1"
     caddy:
       image: caddy:2
       restart: unless-stopped
       ports: ["80:80", "443:443"]
       environment:
         N8N_DOMAIN: ${N8N_DOMAIN}
       volumes:
         - ./Caddyfile:/etc/caddy/Caddyfile:ro
         - caddy_data:/data
       depends_on: [n8n]
   volumes:
     caddy_data:
   ```

   And `n8n/.env` (copy `n8n/.env.example` and fill in): a **new** `N8N_ENCRYPTION_KEY`, the two shared secrets from section 6, `LENDLOOP_CONVEX_SITE_URL=https://<prod-deployment>.convex.site`, `LENDLOOP_EMAIL_MODE=smtp`, `LENDLOOP_EMAIL_FROM=LendLoop <onboarding@resend.dev>`.
6. **Start and import.**
   ```bash
   docker compose up -d
   sh n8n/scripts/import-workflows.sh
   ```
7. Open `https://<ip-with-dashes>.sslip.io` **right away** and create the owner account.
8. **Email credential:** n8n → Credentials → Add → SMTP, named exactly **`LendLoop SMTP`**: host `smtp.resend.com`, port `465`, SSL on, user `resend`, password = your Resend API key. Then run `sh n8n/scripts/import-workflows.sh` again so the workflows link to it.
9. **Connect Convex:**
   ```bash
   npx convex env set --prod N8N_WEBHOOK_URL https://203-0-113-7.sslip.io/webhook/lendloop-events
   ```

Oracle reclaims Always Free VMs that stay almost completely idle (CPU, network and memory under 20% for 7 days). A lightly used n8n can hit that; a small cron job or real traffic keeps it alive.

### 6C. Your laptop + Cloudflare quick tunnel (demo day)

```bash
# n8n/.env: point the workflows at production Convex
#   LENDLOOP_CONVEX_SITE_URL=https://<prod-deployment>.convex.site
#   plus the two production secrets from section 6
docker compose up -d
cloudflared tunnel --url http://localhost:5678      # prints https://<random>.trycloudflare.com
npx convex env set --prod N8N_WEBHOOK_URL https://<random>.trycloudflare.com/webhook/lendloop-events
```

No account needed. The URL changes every time you start the tunnel, so repeat the last command each time. Create the n8n owner account before starting the tunnel (the editor becomes public too).

---

## 7. Clerk: development keys vs. production

For a demo you can keep using the **development instance** on Vercel. Know its limits:

- At most **100 users**, a "Development mode" badge on the sign-in card, and Google sign-in through Clerk's shared Google app (the Google screen says "accounts.dev").
- Settings you already changed stay: Organizations off, "Require Device Intelligence checks" off.

A **production instance** removes those limits but needs **a domain you own** — Clerk does not accept `*.vercel.app` for production. When you have a domain:

1. Clerk → **Go to prod** (top bar) → create the production instance for `yourdomain.com`; add the DNS records Clerk lists.
2. Recreate settings there: Google (with **your own** Google OAuth client, see the Google setup notes), Organizations off, Protect settings, and a JWT template named **`convex`**.
3. Vercel → set the production keys (`pk_live_…`, `sk_live_…`) and add `yourdomain.com` under **Settings → Domains**.
4. `npx convex env set --prod CLERK_JWT_ISSUER_DOMAIN https://clerk.yourdomain.com`
5. Users from the development instance don't carry over; everyone signs up again.

---

## 8. Email: what Resend Free allows

- 3,000 emails a month, **100 a day**.
- Without a verified domain, Resend only delivers **from `onboarding@resend.dev` to the email address you signed up to Resend with**. Codes sent to other people fail (logged in Convex); borrowers can still open the code in the app with **Show pickup code**.
- To email anyone: Resend → **Domains → Add domain**, add the DNS records it shows, wait for *Verified*, then:
  ```bash
  npx convex env set --prod EMAIL_FROM "LendLoop <no-reply@yourdomain.com>"
  ```
  (and `LENDLOOP_EMAIL_FROM` in n8n).

---

## 9. Alternative: the website on Render instead of Vercel

Possible, but slower for visitors: a free Render web service sleeps after 15 minutes, so the first visitor after a quiet period waits about a minute.

- New → Web Service → your repo, Runtime **Node**, Instance **Free**.
- Build command: `npm ci && npx convex deploy --cmd 'npm run build'`
- Start command: `npm start` (Next.js reads Render's `PORT` automatically).
- Same environment variables as section 5.2.

The website never sends email, so Render's SMTP block doesn't affect it.

---

## 10. After deploying: smoke test

| Check | Expected |
| --- | --- |
| `curl https://<prod-deployment>.convex.site/health` | `{"ok":true,"service":"lendloop-convex"}` |
| Open `https://<your-app>.vercel.app` | Landing page, globe intro, tool cards; asks for location |
| Sign up (email or Google) → onboarding | Lands on the map with **Your location** and distances |
| Two accounts: request → approve | Owner sees the request live; borrower gets the pickup code by email (or *Show pickup code*) |
| Admin → Automation | Events **DELIVERED** (n8n result `MOCKED` or `SENT`), or **SKIPPED** if n8n isn't connected |
| `LENDLOOP_N8N_WEBHOOK_SECRET=<prod secret> node n8n/scripts/send-test-event.mjs --url https://<your-n8n-host>/webhook/lendloop-events` | `200` (and `401` with `--bad-signature`) |

---

## 11. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Vercel build: *"CONVEX_DEPLOY_KEY is not set"* or deploys to the wrong place | Add the **production** deploy key as `CONVEX_DEPLOY_KEY` (scope Production) and redeploy. |
| Signed in, but *"We couldn't verify your session with the backend"* | `CLERK_JWT_ISSUER_DOMAIN` on the **prod** Convex deployment must match the Clerk instance whose keys are on Vercel, and that instance needs the `convex` JWT template. |
| Map is grey/blank on the live site | Mapbox token URL restriction doesn't include the Vercel address. |
| Place search returns nothing | Set `GEOCODER_USER_AGENT` with contact details (Nominatim policy). |
| Sign-up blocked: *"We couldn't complete this request"* | Clerk Protect → disable "Require Device Intelligence checks", or check the visitor's ad blocker. |
| Sign-in asks to "Set up your organization" | Clerk → Organizations → Disable (or Membership optional). |
| Events **FAILED → DEAD** | n8n URL wrong or n8n asleep for too long. Fix, then use **Retry** in Admin → Automation. |
| n8n answers **401** | `LENDLOOP_N8N_WEBHOOK_SECRET` ≠ Convex `N8N_WEBHOOK_SECRET`. |
| Convex answers **401** to n8n | `LENDLOOP_AUTOMATION_SECRET` ≠ Convex `AUTOMATION_INBOUND_SECRET`. |
| n8n forgets workflows/owner/credentials after a restart (Render) | Postgres variables missing (SQLite on an ephemeral disk), or `N8N_ENCRYPTION_KEY` changed. |
| n8n emails fail on Render | Expected: SMTP ports are blocked on Render Free. Use `mock`, Oracle (6B), or a paid instance. |
| Codes reach you but not other people | Resend domain not verified (section 8). |

---

## 12. Going from demo to real launch

- Own domain; Clerk **production** instance; your own Google OAuth client with verified branding.
- Resend with a verified domain.
- Vercel Hobby is for **non-commercial** use only. Anything that makes money (ads, payments, a paid client project) needs Vercel Pro.
- Convex: scheduled backups; watch the free limits below.
- n8n: an always-on host with persistent storage (Oracle VM, a paid Render instance, or n8n Cloud).
- Replace the public OSRM demo routing servers and the Nominatim geocoder with your own or paid ones.

---

## Limits and sources

Checked 2026-11-06.

| Service | Free plan | Source |
| --- | --- | --- |
| Vercel Hobby | Free, **non-commercial personal use only**. Functions up to 300 s; 100 GB fast data transfer, 1M invocations / month. Outbound SMTP allowed except port 25. | [Hobby plan](https://vercel.com/docs/plans/hobby), [fair use](https://vercel.com/docs/limits/fair-use-guidelines), [SMTP](https://vercel.com/kb/guide/serverless-functions-and-smtp) |
| Convex Free | 1M function calls, 0.5 GB database, 1 GB file storage, 1 GB egress / month; dev + prod deployments. | [Pricing](https://www.convex.dev/pricing), [limits](https://docs.convex.dev/production/state/limits) |
| Clerk Hobby | 50,000 monthly retained users per app. Dev instances: max 100 users. Production needs your own domain (not `*.vercel.app`). | [Pricing](https://clerk.com/pricing), [environments](https://clerk.com/docs/guides/development/managing-environments), [Vercel guide](https://clerk.com/docs/guides/development/deployment/vercel) |
| Resend Free | 3,000 emails / month, 100 / day; verified domain needed for other recipients. SMTP on 25/465/587/2465/2587. | [Pricing](https://resend.com/pricing), [SMTP](https://resend.com/docs/send-with-smtp), [403 testing domain](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) |
| Render Free | Sleeps after 15 min; 750 instance hours / month; no persistent disk; free Postgres expires after 30 days; **outbound 25/465/587 blocked since Sept 2025**; one public HTTP port (`PORT`). | [Free plan](https://render.com/docs/free), [SMTP change](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports), [web services](https://render.com/docs/web-services), [n8n on Render](https://render.com/docs/deploy-n8n) |
| Neon Free | 0.5 GB per project; compute suspends after 5 min idle; no expiry. | [Pricing](https://neon.com/pricing) |
| Oracle Always Free | Ampere A1 up to 2 OCPU / 12 GB RAM (or 2 AMD micro VMs), 200 GB storage; port 25 blocked by default; idle VMs may be reclaimed. | [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| n8n | Self-hosted Community Edition is free. n8n Cloud: no free plan (14-day trial, then from ~€20 / month). | [Pricing](https://n8n.io/pricing/) |
| Cloudflare quick tunnels | Free, no account; random URL per run; for testing. | [Quick tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) |
| n8n Postgres settings | `DB_TYPE=postgresdb`, `DB_POSTGRESDB_*`, `DB_POSTGRESDB_SSL_ENABLED`. | [n8n database variables](https://docs.n8n.io/hosting/configuration/environment-variables/database/) |
