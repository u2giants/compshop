# CompShop — Self-Hosting Runbook (Lovable Cloud → Coolify VPS)

**Audience:** A developer (or AI agent) executing the migration end-to-end.
**Goal:** Move CompShop off Lovable Cloud and onto a self-hosted stack on a single Hong Kong VPS running [Coolify](https://coolify.io), so users in mainland China get a CN2 GIA route to both the frontend and the backend.
**Outcome:** Two Coolify "applications" running on one server:
1. **`compshop-web`** — the Vite/React frontend, served by nginx.
2. **`compshop-supabase`** — self-hosted Supabase (Postgres, GoTrue auth, PostgREST, Realtime, Storage, Edge Functions, Studio, Kong gateway), deployed from Supabase's official `docker-compose.yml`.

> **Read this whole document once before touching anything.** The order matters. Several steps depend on values generated in earlier steps (JWT secret, anon key, service role key, project URL).

> **You do not need to buy the server yet to start preparing.** See [§3.5 — Preparation you can do before provisioning the VPS](#35-preparation-you-can-do-before-provisioning-the-vps). About 60% of this runbook can be done on your laptop against a local staging Supabase with zero risk to the running Lovable Cloud app.

---

## Table of Contents

1. [Architecture overview](#1-architecture-overview)
2. [What we are NOT migrating (and why)](#2-what-we-are-not-migrating-and-why)
3. [Prerequisites & cost estimate](#3-prerequisites--cost-estimate)
3.5. [Preparation you can do before provisioning the VPS](#35-preparation-you-can-do-before-provisioning-the-vps)
4. [Phase 0 — VPS & Coolify setup](#4-phase-0--vps--coolify-setup)
5. [Phase 1 — Domains & DNS](#5-phase-1--domains--dns)
6. [Phase 2 — Deploy self-hosted Supabase](#6-phase-2--deploy-self-hosted-supabase)
7. [Phase 3 — Configure auth (Google SSO, email, invite-only)](#7-phase-3--configure-auth-google-sso-email-invite-only)
8. [Phase 4 — Migrate the database schema](#8-phase-4--migrate-the-database-schema)
9. [Phase 5 — Migrate the data](#9-phase-5--migrate-the-data)
10. [Phase 6 — Migrate Storage buckets & files](#10-phase-6--migrate-storage-buckets--files)
11. [Phase 7 — Deploy edge functions](#11-phase-7--deploy-edge-functions)
12. [Phase 8 — Build & deploy the frontend container](#12-phase-8--build--deploy-the-frontend-container)
13. [Phase 9 — Cutover & smoke test](#13-phase-9--cutover--smoke-test)
14. [Phase 10 — Backups, monitoring, and ongoing ops](#14-phase-10--backups-monitoring-and-ongoing-ops)
15. [Troubleshooting](#15-troubleshooting)
16. [Rollback plan](#16-rollback-plan)
17. [Appendix A — Full file references](#17-appendix-a--full-file-references)

---

## 1. Architecture overview

### Current (Lovable Cloud)

```
[China users] ──(Great Firewall, slow)──▶ [lovable.app frontend (US/EU)]
                                                  │
                                                  ▼
                                  [Supabase.com backend (US/EU)]
                                  ├─ Postgres
                                  ├─ Auth (GoTrue)
                                  ├─ Storage
                                  ├─ Edge Functions (Deno)
                                  └─ Realtime
```

### Target (self-hosted, Hong Kong CN2 GIA)

```
[China users] ──(CN2 GIA, fast)──▶ [HK VPS / Coolify]
                                          │
                       ┌──────────────────┼──────────────────┐
                       ▼                  ▼                  ▼
            compshop-web container   compshop-supabase stack
            (nginx + Vite build)     (docker-compose:
                                      kong, auth, rest, realtime,
                                      storage, db, functions, studio,
                                      meta, imgproxy, vector)
```

You asked whether this should be **1 frontend container + 1 self-hosted Supabase container**. Almost — Supabase is **not a single container**, it's a docker-compose stack of ~10 containers. In Coolify you deploy it as **one "Docker Compose" application**, which Coolify treats as a single logical service. So from your point of view, yes: two apps in Coolify.

---

## 2. What we are NOT migrating (and why)

| Thing | Decision | Why |
|---|---|---|
| Lovable AI Gateway (`LOVABLE_API_KEY`) | **Replace with direct Google Gemini API key** | The Lovable gateway only works for projects on Lovable Cloud. You'll need a Google AI Studio key for `analyze-photo` and `parse-teams-conversation`. |
| `@lovable.dev/cloud-auth-js` (frontend OAuth wrapper) | **Replace with direct `supabase.auth.signInWithOAuth`** | `src/integrations/lovable/index.ts` wraps Google sign-in through Lovable's OAuth gateway, then installs the resulting session into Supabase. On self-hosted Supabase, Lovable's gateway has no knowledge of your GoTrue instance — tokens it issues will fail signature verification. Must be replaced in frontend code. See §7.4. |
| Lovable's managed migrations UI | **Replaced by `supabase/migrations/` + `supabase db push`** | Coolify doesn't know about Lovable. You'll run migrations from your laptop with the Supabase CLI. |
| Lovable's "Connectors" (Google Maps, Brevo) | **Re-add as plain env vars on the edge functions container** | Same keys, just configured manually in Coolify instead of Lovable's Secrets UI. |
| Capacitor mobile build pointing at `lovableproject.com` | **Update `capacitor.config.ts` + rebuild & resubmit the iOS/Android binaries** | See Phase 8. A config change alone does nothing for users who already installed the app — they need an app-store update. |
| Lovable's automatic GitHub sync | **Stays the same** for the codebase, but you stop using Lovable's "Publish" button — Coolify auto-deploys from GitHub instead. |
| `.env` committed to git (current Lovable Cloud anon key) | **Rotate + remove from tracked files** | The current anon key is in git history. Before cutover, `git rm --cached .env`, add to `.gitignore`, generate a new key Lovable-side, and commit the change. On the self-hosted side the anon key is generated fresh from your new `JWT_SECRET`, so that one is never exposed. |

---

## 3. Prerequisites & cost estimate

### Accounts you need

- **VPS provider with CN2 GIA routing to Hong Kong.** Recommended:
  - **BandwagonHost "HK CN2 GIA"** plan (~$90/yr for 1 GB RAM is too small — get the **4 GB / 80 GB SSD** plan, ~$25/mo).
  - **RackNerd HK** or **Aoyou Host (遨游主机)** as alternatives.
  - **Avoid:** AWS Lightsail HK, Vultr HK, DigitalOcean SGP — these route through congested public peering and are nearly as slow as US for China users.
- **A domain you control** (e.g. `compshop.designflow.app`). Cloudflare DNS is fine; Cloudflare proxy (orange cloud) is fine for the frontend but **must be off for the Supabase API hostname** (it breaks websockets and large uploads). See Phase 5.
- **GitHub account** with the CompShop repo (already connected via Lovable's GitHub integration).
- **Google Cloud project** with OAuth 2.0 credentials (you already have one for the current Google SSO — you'll add a new redirect URI).
- **Brevo account** (already have it — same API key).
- **Google AI Studio** account for a Gemini API key (replaces Lovable AI Gateway).
- **Google Cloud Console** project with **Places API** enabled (already have — same `GOOGLE_MAPS_API_KEY`).

### Server sizing

| Component | Min RAM | Min disk | Notes |
|---|---|---|---|
| Coolify itself | 1 GB | 5 GB | |
| Postgres + Supabase services | 2 GB | depends on data | Storage bucket data lives on disk |
| Frontend (nginx + static files) | 100 MB | 200 MB | |
| OS + headroom | 1 GB | 10 GB | |
| **Recommended VPS** | **4 GB RAM, 4 vCPU, 80 GB SSD** | | ~$20–30/month |

### Tools on your laptop

```bash
# macOS (Homebrew)
brew install supabase/tap/supabase   # Supabase CLI
brew install postgresql@16            # for psql + pg_dump
brew install node                     # for build verification
```

### Cost summary

| Item | Monthly |
|---|---|
| HK CN2 GIA VPS (4 GB) | $20–30 |
| Domain | $1 (~$12/yr) |
| Backups (e.g. Backblaze B2) | $1–5 |
| Brevo (existing) | $0 (free tier) |
| Google AI / Maps (existing) | usage-based |
| **Total** | **~$25–40/month** |

---

## 3.5 Preparation you can do before provisioning the VPS

Everything in this section is **safe to do on your laptop against a local staging environment**. The running Lovable Cloud app is completely untouched. You can knock out most of the hard work here before spending a dollar on infrastructure.

### 3.5.1 Run a local Supabase staging environment

The Supabase CLI can spin up a full local stack (Postgres, GoTrue, PostgREST, Realtime, Storage, Edge Functions, Studio) on your laptop. This is your staging environment.

```bash
# Install CLI if you haven't already
brew install supabase/tap/supabase

# In the repo root
supabase start
# First run pulls ~2 GB of images — takes 5–10 min
```

It prints something like:
```
API URL:      http://127.0.0.1:54321
anon key:     eyJhbGc...
service_role: eyJhbGc...
Studio:       http://127.0.0.1:54323
DB:           postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Create a `.env.local` file (never committed — already in `.gitignore`) and point the app at local:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<local anon key from above>
VITE_SUPABASE_PROJECT_ID=local
```

Run `npm run dev` — the app now talks to your local Supabase. `.env` (pointing at Lovable Cloud) is untouched and still works when you `npm run dev` without the `.env.local` override.

### 3.5.2 Apply the schema to local staging

```bash
supabase db reset   # applies all 29 migrations in supabase/migrations/ to local DB
```

This is a complete dry run of Phase 4. If it fails, you find out now.

### 3.5.3 Replace the Lovable OAuth wrapper (safe code change)

This is the most important frontend code change (see §7.4 for full details). You can write and test it locally now:

1. In `src/pages/Auth.tsx`, the Google sign-in button calls `lovable.auth.signInWithOAuth("google", ...)`. Replace that with `supabase.auth.signInWithOAuth(...)` directly.
2. Test sign-in against your local Supabase (you'll need to configure Google OAuth locally or use email OTP for the test).
3. Once satisfied, keep the change on a feature branch — it merges into `main` at cutover time.

### 3.5.4 Rewrite the two AI edge functions

See §11.1 for full details. Do the Gemini rewrite locally and test against `supabase functions serve`:

```bash
supabase functions serve analyze-photo --env-file .env.local
```

Verify the function returns a valid response before cutover.

### 3.5.5 Rotate keys and remove `.env` from git tracking

The current `.env` file is committed to the repo, meaning the Lovable Cloud anon key is in git history.

```bash
# 1. Remove from git tracking (the file stays on disk)
git rm --cached .env
echo ".env" >> .gitignore
git commit -m "stop tracking .env"

# 2. Create .env.example so future devs know what's needed
cp .env .env.example
# Edit .env.example — replace actual values with placeholder strings
git add .env.example && git commit -m "add .env.example"

# 3. Rotate the Lovable Cloud anon key
# In Lovable → Cloud → Database → API → Rotate anon key
# This invalidates the key that's now in git history.
# Update your local .env with the new key.
```

> The self-hosted anon key is generated fresh from your new `JWT_SECRET` in §6.1, so it's never in git.

### 3.5.6 Add Dockerfile + nginx.conf (inert until deployed)

Create these files now (Phase 8 details) — they are just static files in the repo, they don't affect Lovable's build or the running app.

### 3.5.7 Test a schema + data dump (read-only, safe to run any time)

```bash
export OLD_DB_URL="postgresql://postgres.xxxxx:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
pg_dump "$OLD_DB_URL" --schema=public --schema=storage --no-owner --no-privileges --schema-only > /tmp/test-schema.sql
```

Just dumps and throws away. Lets you confirm the connection string works and the dump is clean.

### 3.5.8 Pre-register the new Google OAuth redirect URI

You don't need the VPS to do this. In Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client:

Add the redirect URI you'll use:
```
https://api.compshop.example.com/auth/v1/callback
```

Google credentials can have multiple redirect URIs — the old one stays, the new one is just added. Zero impact on the live app.

### 3.5.9 Verify Brevo SMTP sender domain

In Brevo → Senders & IPs → Domains: confirm your sender domain is authenticated with SPF + DKIM. Self-hosted GoTrue will send email from this domain. Any deliverability issues are better found now than at 2 AM during cutover.

### Summary: what you can do before the server arrives

| Task | Safe to do now? |
|---|---|
| Run local Supabase (`supabase start`) | ✅ Yes |
| Test all 29 migrations locally | ✅ Yes |
| Write + test Lovable OAuth replacement | ✅ Yes (feature branch) |
| Rewrite + test Gemini edge functions | ✅ Yes (local) |
| Remove `.env` from git + rotate keys | ✅ Yes (should do immediately) |
| Add Dockerfile + nginx.conf | ✅ Yes (inert files) |
| Test schema dump from Lovable Cloud | ✅ Yes (read-only) |
| Add Google OAuth redirect URI | ✅ Yes (additive) |
| Verify Brevo SMTP domain auth | ✅ Yes |
| Provision VPS + Coolify | ❌ Needs server |
| Deploy self-hosted Supabase | ❌ Needs server |
| Migrate storage files | ❌ Needs server running |
| DNS cutover | ❌ Needs server running |

---

## 4. Phase 0 — VPS & Coolify setup

### 4.1 Provision the VPS

1. Order a **Hong Kong CN2 GIA** VPS with **Ubuntu 24.04 LTS**, 4 GB RAM, 4 vCPU, 80 GB SSD, and IPv4.
2. SSH in as root and update:
   ```bash
   ssh root@YOUR_VPS_IP
   apt update && apt upgrade -y
   apt install -y curl ufw fail2ban
   ```
3. Set hostname and timezone:
   ```bash
   hostnamectl set-hostname compshop
   timedatectl set-timezone Asia/Hong_Kong
   ```
4. Open firewall ports:
   ```bash
   ufw allow 22/tcp
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw allow 8000/tcp   # Coolify dashboard (temporary; you'll put it behind Cloudflare Tunnel later)
   ufw --force enable
   ```
5. **Recommended:** disable root SSH password login; use SSH keys only. (Standard hardening — not Coolify-specific.)

### 4.2 Install Coolify

Run the official installer:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

It will install Docker, pull Coolify, and start it on port 8000. Wait ~3 minutes.

Open `http://YOUR_VPS_IP:8000` in a browser. Create the admin account on first load. **Save the admin password in your password manager immediately.**

### 4.3 Add your server to Coolify

Coolify auto-detects the local machine as the first server. Confirm in **Servers → localhost** that it shows green ("reachable").

### 4.4 Connect Coolify to GitHub

1. **Sources → New Source → GitHub App.**
2. Click "Register new GitHub App" — Coolify will guide you through the GitHub flow.
3. Install the app on your account, granting access to the **CompShop repo** only.
4. Confirm the source shows "Connected" with a green dot.

This lets Coolify auto-deploy on every push to `main`.

---

## 5. Phase 1 — Domains & DNS

You need **two hostnames** pointing at your VPS:

| Hostname | Purpose | Cloudflare proxy? |
|---|---|---|
| `app.compshop.example.com` | Frontend (the React app) | ✅ ON (orange cloud) |
| `api.compshop.example.com` | Supabase Kong gateway | ❌ **OFF (DNS-only / grey cloud)** |

**Why API must be DNS-only:** Cloudflare's free tier limits uploads to 100 MB and breaks Supabase Realtime websockets unreliably. We bypass it for the API and use Coolify's built-in Let's Encrypt instead.

**Cloudflare proxy + Let's Encrypt chicken-and-egg for the frontend hostname:** When the orange cloud is on, Cloudflare terminates TLS before requests reach your VPS — so Coolify's built-in Let's Encrypt HTTP-01 challenge never reaches the origin. You have two options; pick one before deploying the frontend in §12.3:

- **Option A (simpler):** Temporarily turn off the Cloudflare proxy for `app.compshop.example.com`, let Coolify issue the Let's Encrypt cert (takes ~60s), then turn the proxy back on and set SSL/TLS mode to **Full (strict)** in Cloudflare.
- **Option B (preferred long-term):** Skip Coolify's cert issuance for this hostname. In Cloudflare → SSL/TLS → Origin Server, issue a **Cloudflare Origin Certificate** (free, 15-year). Download the cert + key, paste them into Coolify → `compshop-web` → **Custom SSL**. Leave the orange cloud on permanently.

Either way, `api.compshop.example.com` stays DNS-only (grey cloud) and Coolify issues its Let's Encrypt cert normally.

### 5.1 Create A records

In Cloudflare (or your DNS provider):

```
A    app.compshop.example.com   → YOUR_VPS_IP   (proxied)
A    api.compshop.example.com   → YOUR_VPS_IP   (DNS only)
```

Wait 2–5 minutes for propagation. Verify:

```bash
dig +short app.compshop.example.com
dig +short api.compshop.example.com
# Both should return YOUR_VPS_IP
```

---

## 6. Phase 2 — Deploy self-hosted Supabase

### 6.1 Generate secrets

On your **laptop**, generate the four secrets you'll need. Save these in a password manager — you'll paste them into Coolify in step 6.3.

```bash
# 1. Postgres superuser password (any strong random string)
openssl rand -base64 32

# 2. JWT secret (must be at least 32 chars; used to sign auth tokens)
openssl rand -base64 48

# 3. Dashboard (Studio) password
openssl rand -base64 24

# 4. SMTP password — you'll use your existing Brevo SMTP key, no need to generate
```

You'll also need to derive an **anon key** and a **service role key** from the JWT secret. Use Supabase's tool: <https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys> — paste your JWT secret, copy out both JWTs.

> **Critical:** The frontend's `VITE_SUPABASE_PUBLISHABLE_KEY` is the **anon key**. The edge functions use the **service role key**. They are different and not interchangeable. Do not lose either.

### 6.2 Create the Coolify "Docker Compose" application

1. **Projects → New Project → name it `compshop`.**
2. Inside the project: **New Resource → Docker Compose Empty.**
3. Name it `compshop-supabase`.
4. In the "Docker Compose" editor, paste the official Supabase compose file. **Pin to a specific release tag** — pulling `master` gives you whatever is current that day and breaking changes are real.

   ```bash
   # Check https://github.com/supabase/supabase/releases for the latest stable tag, e.g. v1.24.05
   SUPABASE_TAG=v1.24.05
   git clone --depth 1 --branch "$SUPABASE_TAG" https://github.com/supabase/supabase.git /tmp/sb
   cat /tmp/sb/docker/docker-compose.yml
   ```
   Paste the entire file into Coolify's compose editor. Record the tag you used somewhere visible (e.g. a comment at the top of the compose file) so future updates are deliberate.

5. Copy `/tmp/sb/docker/volumes/` to the VPS so init scripts and the Kong config are present:

   ```bash
   # On the VPS
   mkdir -p /data/coolify/supabase
   cd /data/coolify/supabase
   git clone --depth 1 --branch "$SUPABASE_TAG" https://github.com/supabase/supabase.git
   cp -r supabase/docker/volumes ./volumes
   ```

   Then in the Coolify compose file, change every `./volumes/...` path to `/data/coolify/supabase/volumes/...` (find-and-replace).

6. **Update `kong.yml` with your own anon/service-role JWTs.** This is the most commonly missed step — Kong validates incoming request keys against its own consumer list, which is hardcoded in `volumes/api/kong.yml`. The file you cloned contains Supabase's example placeholder JWTs; Kong will reject every request until you replace them with yours.

   Open `/data/coolify/supabase/volumes/api/kong.yml` on the VPS and find the two consumer blocks (they look like `keyauth_credentials` entries). Replace the `key:` values:

   ```yaml
   # In kong.yml — find both of these blocks and update their key values:
   keyauth_credentials:
     - consumer: anon
       key: <paste your ANON_KEY from step 6.1>
   keyauth_credentials:
     - consumer: service_role
       key: <paste your SERVICE_ROLE_KEY from step 6.1>
   ```

   Do this **after** generating your JWT secret in 6.1 and **before** clicking Deploy.

### 6.3 Configure environment variables in Coolify

In the same `compshop-supabase` resource, open **Environment Variables** and add **all** of these (replace placeholders with the values you generated in 6.1):

```env
############
# Secrets
############
POSTGRES_PASSWORD=<paste from step 6.1 #1>
JWT_SECRET=<paste from step 6.1 #2>
ANON_KEY=<paste from JWT generator>
SERVICE_ROLE_KEY=<paste from JWT generator>
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<paste from step 6.1 #3>
SECRET_KEY_BASE=<openssl rand -base64 64>
VAULT_ENC_KEY=<openssl rand -base64 32>

############
# Database
############
POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432

############
# API Proxy (Kong)
############
KONG_HTTP_PORT=8000
KONG_HTTPS_PORT=8443

############
# API URL (CRITICAL — must be the public hostname)
############
API_EXTERNAL_URL=https://api.compshop.example.com
SUPABASE_PUBLIC_URL=https://api.compshop.example.com
SITE_URL=https://app.compshop.example.com
ADDITIONAL_REDIRECT_URLS=https://app.compshop.example.com/auth/callback,https://app.compshop.example.com/reset-password

############
# Auth
############
DISABLE_SIGNUP=false                 # invite-only is enforced by your is_email_invited() function, not GoTrue
JWT_EXPIRY=3600
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false       # users must verify email
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=false
ENABLE_ANONYMOUS_USERS=false         # ⚠️ never enable; see memory rules

############
# Email (Brevo SMTP)
############
SMTP_ADMIN_EMAIL=admin@compshop.example.com
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<your Brevo SMTP login>
SMTP_PASS=<your Brevo SMTP key>
SMTP_SENDER_NAME=CompShop
MAILER_URLPATHS_CONFIRMATION=/auth/callback
MAILER_URLPATHS_INVITE=/auth/callback
MAILER_URLPATHS_RECOVERY=/reset-password
MAILER_URLPATHS_EMAIL_CHANGE=/auth/callback

############
# Studio
############
STUDIO_DEFAULT_ORGANIZATION=CompShop
STUDIO_DEFAULT_PROJECT=Production
STUDIO_PORT=3000

############
# Functions (we'll deploy our 5 functions here)
############
# Do NOT set FUNCTIONS_VERIFY_JWT=false globally — only 3 of 5 functions have
# verify_jwt = false in supabase/config.toml. The other two (send-invite-email,
# nearby-stores) rely on gateway-level JWT enforcement. Per-function overrides
# are applied at deploy time via supabase/config.toml, not via a global env var.

############
# Edge function secrets (custom — used by our code)
############
BREVO_API_KEY=<your existing Brevo API key>
GOOGLE_MAPS_API_KEY=<your existing Google Maps key>
LOVABLE_API_KEY=<see Phase 7 — replace with GEMINI_API_KEY>
GEMINI_API_KEY=<get from https://aistudio.google.com/app/apikey>
```

### 6.4 Configure Coolify domains for the Supabase app

In Coolify, on the `compshop-supabase` resource:

1. **Domains:** map `https://api.compshop.example.com` → service `kong` → port `8000`.
2. Coolify will auto-issue a Let's Encrypt cert (give it 60s).
3. Make sure no other service is exposed publicly. Studio is exposed only over the Coolify internal network — you'll access it through Coolify's "Open" button, which tunnels through your authenticated dashboard session.

### 6.5 Deploy

Click **Deploy** in Coolify. Watch the logs. First deploy takes 5–10 minutes (image pulls).

When it's done, verify:

```bash
curl https://api.compshop.example.com/auth/v1/health
# Expected: {"version":"v...","name":"GoTrue","description":"GoTrue is a user registration and authentication API"}

curl https://api.compshop.example.com/rest/v1/ -H "apikey: <ANON_KEY>"
# Expected: OpenAPI JSON
```

---

## 7. Phase 3 — Configure auth (Google SSO, email, invite-only)

### 7.1 Add Google OAuth

1. **Google Cloud Console → APIs & Services → Credentials.** Find your existing OAuth 2.0 Client ID for CompShop.
2. Add a new **Authorized redirect URI**:
   ```
   https://api.compshop.example.com/auth/v1/callback
   ```
3. **Save.**
4. In Supabase Studio (open via Coolify): **Authentication → Providers → Google → Enable.** Paste the existing **Client ID** and **Client Secret**. Save.

### 7.2 Email templates

Studio → Authentication → Email Templates. Adjust the "Invite user", "Confirm signup", "Reset password" templates so links point to `https://app.compshop.example.com/...`. The default templates use `{{ .SiteURL }}` which resolves to your `SITE_URL` env var, so usually no edits needed.

### 7.3 Invite-only enforcement

The `public.is_email_invited(_email text)` SQL function (already in your codebase) gates new signups. After Phase 4, this comes over for free. No GoTrue change needed.

### 7.4 Replace the Lovable OAuth wrapper in the frontend

> **This is a required code change.** The app currently calls `lovable.auth.signInWithOAuth("google", ...)` in `src/pages/Auth.tsx:32`, which routes through `@lovable.dev/cloud-auth-js` and Lovable's OAuth gateway. On self-hosted Supabase, Lovable's gateway has no knowledge of your GoTrue instance and the token exchange will fail silently. Replace it before cutover.

**Step 1 — Update `src/pages/Auth.tsx`**

Find the Google sign-in call (around line 32) and replace:

```ts
// Old — goes through Lovable's gateway
const { error } = await lovable.auth.signInWithOAuth("google", {
  redirect_uri: `${window.location.origin}/auth/callback`,
});
```

With direct Supabase OAuth:

```ts
// New — goes directly to your GoTrue instance
const { error } = await supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: `${window.location.origin}/auth/callback`,
  },
});
```

Import `supabase` from `@/integrations/supabase/client` if it isn't already imported.

**Step 2 — Remove the Lovable wrapper files**

```bash
# Remove the integration file (it called createLovableAuth)
rm src/integrations/lovable/index.ts

# Remove the npm package
npm uninstall @lovable.dev/cloud-auth-js
```

**Step 3 — Remove the `lovable-tagger` dev dependency**

This Vite plugin is harmless but is only useful when working inside the Lovable IDE:

```bash
npm uninstall --save-dev lovable-tagger
```

In `vite.config.ts`, remove the `componentTagger()` plugin import and call.

**Step 4 — Verify locally**

With `supabase start` running and `.env.local` pointing at `http://127.0.0.1:54321`:

```bash
npm run dev
```

Google sign-in will redirect through `http://127.0.0.1:54321/auth/v1/authorize?provider=google`. Confirm the redirect happens and the callback URL lands back in the app.

> You can do all of this on a feature branch (`git checkout -b replace-lovable-auth`) before the server exists. Merge into `main` at the same time as the DNS cutover.

---

## 8. Phase 4 — Migrate the database schema

### 8.1 Capture the current schema from Lovable Cloud

Get a connection string for your **current** Supabase (Lovable Cloud) database:
- In Lovable: **Cloud → Database → Connection string → URI** (use the **session pooler / direct connection**, not the transaction pooler, because we need `pg_dump` over a real TCP connection).

Then on your laptop:

```bash
export OLD_DB_URL="postgresql://postgres.xxxxx:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres"

pg_dump "$OLD_DB_URL" \
  --schema=public \
  --schema=storage \
  --no-owner \
  --no-privileges \
  --schema-only \
  > /tmp/compshop-schema.sql
```

> ⚠️ **Do not** dump the `auth`, `realtime`, `supabase_functions`, `vault`, or `extensions` schemas. They are managed by Supabase itself and dumping them will break the new instance.

**Before applying the schema, ensure required extensions exist on the new DB.** The `public` schema references extensions like `uuid-ossp`, `pgcrypto`, `pg_graphql`, `pgjwt`, and `pg_net`. Self-hosted Supabase pre-installs most of these, but verify:

```bash
psql "$NEW_DB_URL" -c "\dx"
# Confirm uuid-ossp, pgcrypto, pg_graphql, pgjwt, pg_net are listed
# If any are missing:
psql "$NEW_DB_URL" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
psql "$NEW_DB_URL" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

### 8.2 Apply schema to the new self-hosted DB

Get the new connection string (from Coolify → `compshop-supabase` → **Connect → Postgres**):

```bash
export NEW_DB_URL="postgresql://postgres:<POSTGRES_PASSWORD>@YOUR_VPS_IP:5432/postgres"
```

> If port 5432 isn't exposed publicly (recommended), open it temporarily in Coolify's compose file (`ports: ["5432:5432"]` on the `db` service), redeploy, do the import, then close it again.

Apply:

```bash
psql "$NEW_DB_URL" < /tmp/compshop-schema.sql
```

Expect a few "already exists" warnings for `storage` schema objects — those are safe to ignore.

### 8.3 Verify

```bash
psql "$NEW_DB_URL" -c "\dt public.*"
# Should list: categories, china_photos, china_trip_members, china_trips,
# comments, countries, factories, image_types, invitations, photo_annotations,
# photos, profiles, retailers, shopping_trips, trip_members, user_roles
```

Verify all RLS policies, helper functions (`is_admin`, `is_china_readonly`, `is_store_readonly`, `is_trip_member`, `is_china_trip_member`, `is_email_invited`, `has_role`, `handle_new_user`, `mark_invitation_accepted`, `update_updated_at`) and the `app_role` enum all came across:

```bash
psql "$NEW_DB_URL" -c "\df public.*"
psql "$NEW_DB_URL" -c "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='app_role';"
# Expect: admin, user, store_readonly, china_readonly
```

---

## 9. Phase 5 — Migrate the data

> **Maintenance window required.** Between the schema dump (Phase 4) and this data dump, users can still write to the old Lovable Cloud DB. Any rows written in that window will be missing from the new instance. Either: (a) schedule this phase immediately after Phase 4 during a low-traffic window (e.g. 02:00 HKT on a weekday), or (b) temporarily put the old app in maintenance mode by setting `DISABLE_SIGNUP=true` and removing the app URL from your DNS (or pointing it at a static "maintenance" page) for the duration of the dump + restore. A few minutes of planned downtime is far better than silent data loss.

### 9.1 Dump data from old DB

```bash
pg_dump "$OLD_DB_URL" \
  --schema=public \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  > /tmp/compshop-data.sql
```

### 9.2 Dump auth users

Auth users live in the `auth` schema and need special handling because GoTrue manages this schema. **Include `--disable-triggers`** — without it, the `handle_new_user` trigger fires on each imported user row and tries to insert into `public.profiles`, causing primary-key conflicts when the profiles data is loaded in 9.3.

```bash
pg_dump "$OLD_DB_URL" \
  --table=auth.users \
  --table=auth.identities \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  --column-inserts \
  > /tmp/compshop-auth.sql
```

### 9.3 Restore

Load in the correct order with trigger suppression:

```bash
# Disable triggers session-wide to prevent FK and trigger conflicts during load
psql "$NEW_DB_URL" -c "SET session_replication_role = replica;"

# Auth first (users must exist before profiles FK is satisfied)
psql "$NEW_DB_URL" < /tmp/compshop-auth.sql

# Then app data
psql "$NEW_DB_URL" < /tmp/compshop-data.sql

# Re-enable triggers
psql "$NEW_DB_URL" -c "SET session_replication_role = DEFAULT;"
```

### 9.4 Verify counts match

Run on **both** old and new DBs and compare:

```sql
SELECT 'shopping_trips' AS t, count(*) FROM shopping_trips
UNION ALL SELECT 'china_trips', count(*) FROM china_trips
UNION ALL SELECT 'photos', count(*) FROM photos
UNION ALL SELECT 'china_photos', count(*) FROM china_photos
UNION ALL SELECT 'comments', count(*) FROM comments
UNION ALL SELECT 'profiles', count(*) FROM profiles
UNION ALL SELECT 'user_roles', count(*) FROM user_roles
UNION ALL SELECT 'factories', count(*) FROM factories
UNION ALL SELECT 'auth.users', count(*) FROM auth.users;
```

Numbers must match exactly. If they don't — stop, investigate, do not proceed.

### 9.5 Reset sequences

`pg_dump --data-only` with `--disable-triggers` can leave sequences out of sync, causing `nextval` to return IDs that already exist. Run this on the new DB after the load:

```bash
psql "$NEW_DB_URL" << 'SQL'
SELECT setval(
  pg_get_serial_sequence(quote_ident(table_name), column_name),
  COALESCE((SELECT MAX(id) FROM photos), 1)  -- repeat for each table
) FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_default LIKE 'nextval%';
SQL
```

Or more precisely, run the following for each table that has an `id` serial/bigserial column:

```sql
SELECT setval(pg_get_serial_sequence('public.photos', 'id'),          COALESCE(MAX(id), 1)) FROM public.photos;
SELECT setval(pg_get_serial_sequence('public.comments', 'id'),        COALESCE(MAX(id), 1)) FROM public.comments;
SELECT setval(pg_get_serial_sequence('public.shopping_trips', 'id'),  COALESCE(MAX(id), 1)) FROM public.shopping_trips;
SELECT setval(pg_get_serial_sequence('public.china_trips', 'id'),     COALESCE(MAX(id), 1)) FROM public.china_trips;
-- add any other tables with integer primary keys
```

### 9.6 Restore the Realtime publication

Self-hosted Supabase creates an empty `supabase_realtime` publication at init. The schema dump does not include publication membership. Without this step, realtime channels will subscribe successfully but receive no events.

```sql
-- Run on new DB
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.photos,
  public.comments,
  public.shopping_trips,
  public.china_trips,
  public.china_trip_members,
  public.trip_members,
  public.photo_comments;
```

Verify:

```bash
psql "$NEW_DB_URL" -c "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';"
```

---

## 10. Phase 6 — Migrate Storage buckets & files

You have two buckets (from `<storage-buckets>` in the project context):

| Bucket | Public? | Notes |
|---|---|---|
| `photos` | No (signed URLs) | Holds all trip photos & videos |
| `retailer-logos` | Yes | Holds retailer logos |

### 10.1 Create the buckets in the new instance

Using Studio (Storage → New bucket), create both with **identical names and public/private flags**.

### 10.2 Copy files

Use **rclone** against the S3-compatible endpoint that both Supabase Cloud and self-hosted Supabase expose. The Supabase CLI's `storage download/upload` subcommands are not available in stable CLI releases — rclone is the reliable path.

**Install rclone:**

```bash
brew install rclone    # macOS
# or: curl https://rclone.org/install.sh | sudo bash
```

**Configure two rclone remotes** (run `rclone config` and follow the prompts for each, using the S3 provider):

| Remote name | Endpoint | Access key | Secret key |
|---|---|---|---|
| `sb-old` | `https://aqbyrzknbhyshjzlfsyv.supabase.co/storage/v1/s3` | `<project anon key>` | `<service role key>` (from Lovable Cloud dashboard) |
| `sb-new` | `https://api.compshop.example.com/storage/v1/s3` | `<new anon key>` | `<new service role key>` |

Or configure via flags directly (no interactive prompt):

```bash
# Download from old
rclone copy "sb-old:photos"         ./photos-backup   --progress
rclone copy "sb-old:retailer-logos" ./logos-backup    --progress

# Upload to new
rclone copy ./photos-backup   "sb-new:photos"         --progress
rclone copy ./logos-backup    "sb-new:retailer-logos" --progress
```

**Verify file counts match:**

```bash
rclone size "sb-old:photos"
rclone size "sb-new:photos"
# Object count and total size should match exactly
```

### 10.3 Verify

In Studio → Storage → photos, spot-check 5 random files: open them, confirm they render. Do the same for `retailer-logos`.

> **File path consistency is critical.** The `file_path` and `thumbnail_path` columns in `photos` / `china_photos` store relative paths like `<user_id>/<filename>.jpg`. Because we preserved these in the DB migration **and** uploaded files to the same paths in the same bucket, no app-code changes are needed.

---

## 11. Phase 7 — Deploy edge functions

You have 5 edge functions (from `supabase/functions/`):

1. `analyze-photo` — uses Lovable AI Gateway → **rewrite to use Gemini direct**
2. `parse-teams-conversation` — uses Lovable AI Gateway → **rewrite to use Gemini direct**
3. `nearby-stores` — uses Google Maps API → no changes needed
4. `reverse-geocode` — uses Google Maps API → no changes needed
5. `send-invite-email` — uses Brevo → no changes needed

### 11.1 Replace Lovable AI calls with Gemini direct

In `supabase/functions/analyze-photo/index.ts` and `supabase/functions/parse-teams-conversation/index.ts`, find the calls that look like:

```ts
const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
  headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}` },
  // ...
});
```

Replace with the Google Generative Language REST endpoint:

```ts
const apiKey = Deno.env.get("GEMINI_API_KEY")!;
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: base64Image } }] }],
    }),
  },
);
```

Adjust JSON parsing accordingly (`data.candidates[0].content.parts[0].text`).

### 11.2 Deploy the functions

`supabase functions deploy --project-ref local` targets Supabase Cloud, not a self-hosted instance. For self-hosted, the `functions` container loads from a mounted volume on the host. Deploy by copying the function files directly into that volume and restarting the container.

```bash
# On the VPS — copy all five functions into the mounted volume
FUNCTIONS_DIR=/data/coolify/supabase/volumes/functions

for fn in analyze-photo parse-teams-conversation nearby-stores reverse-geocode send-invite-email; do
  mkdir -p "$FUNCTIONS_DIR/$fn"
  # Copy from wherever you've placed the repo on the VPS, or rsync from laptop:
done
```

From your **laptop**, rsync the functions directory to the VPS:

```bash
rsync -avz --delete supabase/functions/ root@YOUR_VPS_IP:/data/coolify/supabase/volumes/functions/
```

Then restart the `functions` container to pick up the changes:

```bash
# On the VPS
cd /data/coolify/supabase
docker compose restart functions
```

Verify the container came back up cleanly:

```bash
docker compose logs functions --tail=20
```

For subsequent function updates, re-run the `rsync` + `docker compose restart functions`. Consider adding this as a Coolify post-deploy hook so it runs automatically on every `main` push.

### 11.3 Set per-function secrets

The functions read env vars from the `functions` container, which inherits from the `compshop-supabase` Coolify env. Already set in 6.3. Verify by triggering a test:

```bash
curl -i https://api.compshop.example.com/functions/v1/reverse-geocode \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"lat":22.3,"lng":114.17}'
```

---

## 12. Phase 8 — Build & deploy the frontend container

### 12.1 Add a Dockerfile to the repo

Create `Dockerfile` at repo root:

```dockerfile
# Build stage
FROM node:20-alpine AS build
WORKDIR /app
# Repo uses bun.lock (new text format), not the legacy binary bun.lockb
COPY package.json bun.lock ./
RUN npm install -g bun && bun install --frozen-lockfile
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID
RUN bun run build

# Serve stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

Create `nginx.conf` at repo root (SPA fallback for React Router):

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  gzip on;
  gzip_types text/plain text/css application/javascript application/json image/svg+xml;
  location / {
    try_files $uri $uri/ /index.html;
  }
  # Long cache for hashed assets
  location ~* \.(js|css|png|jpg|jpeg|svg|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

### 12.2 Update `capacitor.config.ts`

Currently points at `lovableproject.com`. Change:

```ts
server: {
  url: 'https://app.compshop.example.com',
  cleartext: false,
},
```

> **Changing `capacitor.config.ts` alone does nothing for users who already have the app installed.** The URL is baked into the native binary at build time. After this change you must:
> 1. Bump the version in `package.json` and `capacitor.config.ts` (or iOS `Info.plist` / Android `build.gradle`).
> 2. Rebuild the iOS and Android binaries (`npx cap build ios`, `npx cap build android`).
> 3. Submit to App Store Connect and Google Play for review.
>
> Plan for **1–3 days** for App Store review. Until users update the app, their installed version will still point at the old Lovable Cloud URL — so keep the Lovable Cloud subscription active until you're confident the user base has updated. The web app (`app.compshop.example.com`) is unaffected by this.

### 12.3 Create the frontend app in Coolify

1. **Projects → compshop → New Resource → Application → Public Repository** (or **GitHub App** if you connected it in 4.4).
2. Repo: your CompShop repo. Branch: `main`. Build pack: **Dockerfile**.
3. **Domains:** `https://app.compshop.example.com`. Coolify issues the cert. ⚠️ **See §5 for the Cloudflare proxy + Let's Encrypt issue before clicking Deploy** — if the orange cloud is on, cert issuance will fail silently.
4. **Build-time environment variables** — in Coolify, set these as **Build Variables** (not Runtime Variables). Vite reads them at compile time; they must be baked into the static bundle:
   ```
   VITE_SUPABASE_URL=https://api.compshop.example.com
   VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY from 6.1>
   VITE_SUPABASE_PROJECT_ID=local
   ```
5. **Deploy.** First build takes ~3 min.

### 12.4 Enable auto-deploy

In Coolify → frontend app → **Configuration → Git**: toggle "Auto-deploy on push to `main`". Now every commit to GitHub redeploys the frontend automatically.

---

## 13. Phase 9 — Cutover & smoke test

### 13.1 Cutover plan

You have two options:

- **Hard cutover:** point `app.compshop.example.com` at the new VPS, update DNS, done. ~5 min downtime while DNS propagates.
- **Soft cutover:** keep both stacks running for a week. New users hit `app-new.compshop.example.com`. Validate, then swap.

Recommend **soft cutover** for a week.

**Before cutting over, communicate to users:** The app uses IndexedDB for offline sync. Any user with unsynced offline changes at the moment of cutover will have data pointing at the old backend. In the week before cutover, consider showing a short banner: *"We're moving servers soon — please make sure you're online and synced."*

**Stale `localStorage` sessions:** Supabase stores auth tokens in `localStorage` keyed by the old project URL. When users first hit the new app URL, their stored session won't validate against the new JWT secret and they'll be bounced to `/auth`. This is expected and harmless. Add it to your user communication: *"You'll need to sign in once after the move."* Verify this behavior is graceful in the smoke test (§13.2 — the "no cookies" item covers it for fresh browsers; also test with an existing logged-in session).

### 13.2 Smoke test checklist

Run through this in order. **Do not skip any.** Mark each as ✅ or ❌.

- [ ] Open `https://app.compshop.example.com` from a fresh browser (no cookies).
- [ ] Sign in with Google SSO.
- [ ] Sign in with email/password.
- [ ] **Store Shopping mode:** create a new trip → upload 3 photos → verify thumbnails render.
- [ ] Edit a photo's metadata (price, brand) → reload → confirms it persisted.
- [ ] Add a comment to a photo.
- [ ] Switch to **Asia Trips mode** → create a Factory Visit → upload a photo and a video < 30 MB.
- [ ] Open the video in the detail dialog → confirm it plays.
- [ ] Use the AI extract on a photo (analyze-photo function) → confirms metadata appears.
- [ ] Use **Search** in the header → confirms results load.
- [ ] Open **Profile → Admin → User Permissions** as admin → toggle a read-only role → confirm it saves.
- [ ] Sign out → sign in as a `china_readonly` user → confirm Asia Trips shows "Read-only" badge and write actions are hidden.
- [ ] Trigger **Send Invite** to a brand-new email → confirms email arrives via Brevo.
- [ ] Soft-delete a trip → confirm it appears in Recycle Bin → restore → confirm it's back.
- [ ] Open browser DevTools → Network tab → reload → confirm all calls go to `api.compshop.example.com` (no requests to `*.supabase.co` or `lovable.dev`).
- [ ] Test from a Chinese network (VPN-from-China, or ask a teammate in Shenzhen): page should load in **<3s** vs current ~15s.

If everything passes, you're done. If not, see Troubleshooting (§15).

### 13.3 Update Lovable

Once cutover is complete and stable for a week:

- In Lovable: **Connectors → Lovable Cloud → Disable Cloud** (this only affects future projects; doesn't touch your self-hosted data).
- Lovable still works for **frontend code edits** (it edits `src/`, commits to GitHub, Coolify auto-deploys). Lovable can no longer manage your DB/migrations/secrets — you do that via the Supabase CLI and Coolify.
- Add a note to your README so future-you remembers: see Appendix A.

---

## 14. Phase 10 — Backups, monitoring, and ongoing ops

### 14.1 Database backups

Add a **daily** Postgres backup via Coolify's built-in backup feature:

1. Coolify → `compshop-supabase` → Database (`db` service) → **Backups → Schedule.**
2. Set: daily at 02:00 HKT, retention 7 days local + push to **Backblaze B2** (S3-compatible, cheap).
3. Backblaze B2 setup: create a bucket `compshop-backups`, generate App Key, paste S3 credentials into Coolify's backup target.

**Test the restore.** Once a month, spin up a throwaway Postgres container and restore the latest backup into it. If you've never tested a restore, you don't have backups.

### 14.2 Storage backups

```bash
# On the VPS, daily cron
0 3 * * * tar czf /backups/storage-$(date +\%F).tar.gz /data/coolify/supabase/volumes/storage \
  && rclone copy /backups/storage-$(date +\%F).tar.gz b2:compshop-backups/storage/
```

### 14.3 Monitoring

- **Uptime:** UptimeRobot or BetterUptime, free tier — ping `https://app.compshop.example.com` and `https://api.compshop.example.com/auth/v1/health` every 5 min.
- **Errors:** Sentry free tier — add `@sentry/react` to the frontend if you want runtime error tracking.
- **Server:** Coolify dashboard shows CPU/RAM/disk. Set an alert in Coolify → Notifications → Telegram/Email when disk > 80%.

### 14.4 Updates

- **Supabase:** every 2–3 months, in Coolify, pull new image tags in the compose file and redeploy. Read the Supabase changelog first.
- **Postgres major version upgrades:** plan carefully. Take a backup. Test on a staging clone.
- **Coolify:** auto-updates by default; you can disable in settings.
- **Frontend:** auto-deploys on every push.

### 14.5 Service role key scope

`SERVICE_ROLE_KEY` is currently set as a stack-wide env var on `compshop-supabase`, which means every edge function container can read it and bypass RLS entirely. Audit which functions actually need it:

- `send-invite-email` — needs it (inserts into `invitations` table on behalf of admin)
- `analyze-photo` — only calls Gemini; **does not need it**
- `parse-teams-conversation` — only calls Gemini; **does not need it**
- `nearby-stores` — only calls Google Maps; **does not need it**
- `reverse-geocode` — only calls Google Maps; **does not need it**

For the three that don't need it, refactor them to use the `SUPABASE_ANON_KEY` (or no Supabase calls at all). This limits blast radius if a function is ever exploited. After refactoring, leave `SERVICE_ROLE_KEY` in the env for the `send-invite-email` function only — which still works because it's a container-wide env — but at least document clearly which functions use it.

### 14.6 Migration workflow going forward

To add a new DB migration:

```bash
# On your laptop, in the repo
supabase migration new my_change
# Edit the generated SQL
supabase db push --db-url "$NEW_DB_URL"
```

Lovable can still help you write the SQL — just paste the file into Lovable's chat and ask it to draft the migration. Then you run `db push` manually.

---

## 15. Troubleshooting

### "Invalid JWT" on every API call
Two possible causes — check both:
1. Your frontend's `VITE_SUPABASE_PUBLISHABLE_KEY` doesn't match the `ANON_KEY` env var on the Supabase stack. They must be derived from the **same** `JWT_SECRET`. Regenerate both.
2. You forgot to update `kong.yml` with your new anon/service-role JWTs (§6.2 step 6). Kong is still validating against the Supabase example placeholder keys. Edit the file and `docker compose restart kong`.

### Email signup works but no email arrives
Check Brevo → Transactional → Logs. If Brevo never received the request, your SMTP env vars in 6.3 are wrong. If Brevo received it but rejected: check sender domain authentication (SPF/DKIM).

### Storage uploads work but photos don't display
The `photos` bucket is private. The frontend uses `createSignedUrl()`. Verify the bucket's `Owner` is `service_role` and that RLS on `storage.objects` was migrated (it should have been via the schema dump).

### Realtime not working
Cloudflare proxy is on for `api.compshop.example.com`. Turn it off (DNS-only / grey cloud).

### `analyze-photo` function returns 500
Either `GEMINI_API_KEY` is missing or you didn't update the function code from Phase 7.1. Check `supabase functions logs analyze-photo` (or Coolify logs for the `functions` container).

### China users still slow
- Confirm your VPS is **actually CN2 GIA**, not "CN2 GT" (a different, slower route). Run `mtr` from a China IP to your VPS — you should see <80ms latency from Shanghai.
- Cloudflare proxy on the frontend may be routing through their non-China-optimized edge. Try **disabling** the orange cloud and serving directly from the VPS.

### I broke something, how do I roll back?
See §16.

---

## 16. Rollback plan

You haven't touched the Lovable Cloud backend during this migration — it's still there, untouched. To roll back:

1. **Frontend:** in Lovable, click Publish — this republishes the frontend pointing back at Lovable Cloud (because `.env` still has the original Lovable Cloud URLs).
2. **Update DNS:** point `app.compshop.example.com` back at Lovable's published URL (or just send users back to `compshop.lovable.app`).
3. **Data written during the self-hosted period** stays on the VPS — you'd need to manually export and re-import into Lovable Cloud (reverse of Phase 5). This is why the soft-cutover (§13.1) matters: if you decide to roll back within the first week, very little new data has been written.

Keep the Lovable Cloud subscription active for at least 30 days after cutover as insurance.

---

## 17. Appendix A — Full file references

Files added/modified by this migration:

- `Dockerfile` — new (§12.1)
- `nginx.conf` — new (§12.1)
- `selfhost.md` — this file
- `CLAUDE.md` — new (pointer to this runbook for AI sessions)
- `.env.example` — new (§3.5.5)
- `.gitignore` — modified (add `.env` entry, §3.5.5)
- `capacitor.config.ts` — modified (§12.2); requires native rebuild + app store resubmission
- `vite.config.ts` — modified (remove `componentTagger()` plugin, §7.4)
- `src/pages/Auth.tsx` — modified (replace Lovable OAuth with direct Supabase OAuth, §7.4)
- `src/integrations/lovable/index.ts` — **deleted** (§7.4)
- `package.json` — modified (remove `@lovable.dev/cloud-auth-js` + `lovable-tagger`, §7.4)
- `supabase/functions/analyze-photo/index.ts` — modified (Gemini direct, §11.1)
- `supabase/functions/parse-teams-conversation/index.ts` — modified (Gemini direct, §11.1)
- `README.md` — recommend adding a "Self-hosted deployment" section linking here

Files NOT touched:
- `src/integrations/supabase/client.ts` — reads from `import.meta.env`, no code change needed
- `src/integrations/supabase/types.ts` — schema didn't change, types still valid
- All RLS policies, helper functions, enums — migrated as-is
- All other React components — agnostic to where Supabase lives

---

## End

If you (or an AI assistant) follow this document linearly, the migration will work. The most common failure mode is **skipping the verification steps** (§8.3, §9.4, §10.3, §13.2). Do not skip them. They're cheap; debugging without them is expensive.

For questions or revisions, open an issue in the GitHub repo.
