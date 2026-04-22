# CompShop — Self-Hosting Runbook (Lovable Cloud → Coolify VPS)

**Audience:** A developer (or AI agent) executing the migration end-to-end.
**Goal:** Move CompShop off Lovable Cloud and onto a self-hosted stack on a single Hong Kong VPS running [Coolify](https://coolify.io), so users in mainland China get a CN2 GIA route to both the frontend and the backend.
**Outcome:** Two Coolify "applications" running on one server:
1. **`compshop-web`** — the Vite/React frontend, served by nginx.
2. **`compshop-supabase`** — self-hosted Supabase (Postgres, GoTrue auth, PostgREST, Realtime, Storage, Edge Functions, Studio, Kong gateway), deployed from Supabase's official `docker-compose.yml`.

> **Read this whole document once before touching anything.** The order matters. Several steps depend on values generated in earlier steps (JWT secret, anon key, service role key, project URL).

---

## Table of Contents

1. [Architecture overview](#1-architecture-overview)
2. [What we are NOT migrating (and why)](#2-what-we-are-not-migrating-and-why)
3. [Prerequisites & cost estimate](#3-prerequisites--cost-estimate)
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
| Lovable's managed migrations UI | **Replaced by `supabase/migrations/` + `supabase db push`** | Coolify doesn't know about Lovable. You'll run migrations from your laptop with the Supabase CLI. |
| Lovable's "Connectors" (Google Maps, Brevo) | **Re-add as plain env vars on the edge functions container** | Same keys, just configured manually in Coolify instead of Lovable's Secrets UI. |
| Capacitor mobile build pointing at `lovableproject.com` | **Update `capacitor.config.ts` to point at your new domain** | See Phase 8. |
| Lovable's automatic GitHub sync | **Stays the same** for the codebase, but you stop using Lovable's "Publish" button — Coolify auto-deploys from GitHub instead. |

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
4. In the "Docker Compose" editor, paste the official Supabase compose file from <https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml>.

   The fastest way: clone it locally, copy the contents:
   ```bash
   git clone --depth 1 https://github.com/supabase/supabase.git /tmp/sb
   cat /tmp/sb/docker/docker-compose.yml
   ```
   Paste the entire file into Coolify's compose editor.

5. Also copy `/tmp/sb/docker/volumes/` to the VPS so the init scripts and Kong config are available. The simplest method:

   ```bash
   # On the VPS
   mkdir -p /data/coolify/supabase
   cd /data/coolify/supabase
   git clone --depth 1 https://github.com/supabase/supabase.git
   cp -r supabase/docker/volumes ./volumes
   ```

   Then in the Coolify compose file, change every `./volumes/...` path to `/data/coolify/supabase/volumes/...` (find-and-replace).

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
FUNCTIONS_VERIFY_JWT=false           # we verify JWT manually inside each function

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

Auth users live in the `auth` schema and need special handling because GoTrue manages this schema. Use Supabase's documented approach:

```bash
pg_dump "$OLD_DB_URL" \
  --table=auth.users \
  --table=auth.identities \
  --data-only \
  --no-owner \
  --no-privileges \
  --column-inserts \
  > /tmp/compshop-auth.sql
```

### 9.3 Restore

```bash
# Auth first
psql "$NEW_DB_URL" < /tmp/compshop-auth.sql

# Then app data
psql "$NEW_DB_URL" < /tmp/compshop-data.sql
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

The cleanest approach is the **Supabase CLI's storage commands** (added in CLI v1.150+):

```bash
# Auth against OLD project
supabase login
supabase link --project-ref <OLD_PROJECT_REF>

# Pull all files locally
supabase storage download "ss:///photos/" --recursive ./photos-backup
supabase storage download "ss:///retailer-logos/" --recursive ./logos-backup
```

Then point the CLI at your new instance and upload:

```bash
# Use the new instance's URL + service role key
export SUPABASE_URL=https://api.compshop.example.com
export SUPABASE_SERVICE_ROLE_KEY=<your service role key>

# Upload
supabase storage upload "ss:///photos/" ./photos-backup --recursive
supabase storage upload "ss:///retailer-logos/" ./logos-backup --recursive
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

From your laptop, with the Supabase CLI pointed at the **new** instance:

```bash
# Set CLI to talk to your self-hosted instance
export SUPABASE_URL=https://api.compshop.example.com
export SUPABASE_SERVICE_ROLE_KEY=<service role key>

# Deploy each function
supabase functions deploy analyze-photo --project-ref local
supabase functions deploy parse-teams-conversation --project-ref local
supabase functions deploy nearby-stores --project-ref local
supabase functions deploy reverse-geocode --project-ref local
supabase functions deploy send-invite-email --project-ref local
```

> Self-hosted Supabase's `functions` service auto-loads functions from `/home/deno/functions/<name>/index.ts` inside the container. The CLI handles the upload over the management API.

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
COPY package.json bun.lockb ./
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

(Only matters if you're shipping the iOS/Android app build. The web app ignores this.)

### 12.3 Create the frontend app in Coolify

1. **Projects → compshop → New Resource → Application → Public Repository** (or **GitHub App** if you connected it in 4.4).
2. Repo: your CompShop repo. Branch: `main`. Build pack: **Dockerfile**.
3. **Domains:** `https://app.compshop.example.com`. Coolify issues the cert.
4. **Build-time environment variables** (these get baked into the static bundle by Vite):
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

### 14.5 Migration workflow going forward

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
Your frontend's `VITE_SUPABASE_PUBLISHABLE_KEY` doesn't match the `ANON_KEY` env var on the Supabase stack. They must be derived from the **same** `JWT_SECRET`. Regenerate both.

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

- `Dockerfile` — new (Phase 8.1)
- `nginx.conf` — new (Phase 8.1)
- `selfhost.md` — this file
- `capacitor.config.ts` — modified (Phase 8.2)
- `supabase/functions/analyze-photo/index.ts` — modified (Phase 7.1)
- `supabase/functions/parse-teams-conversation/index.ts` — modified (Phase 7.1)
- `README.md` — recommend adding a "Self-hosted deployment" section linking here

Files NOT touched:
- `src/integrations/supabase/client.ts` — reads from `import.meta.env`, no code change needed
- `src/integrations/supabase/types.ts` — schema didn't change, types still valid
- All RLS policies, helper functions, enums — migrated as-is
- All React components — agnostic to where Supabase lives

---

## End

If you (or an AI assistant) follow this document linearly, the migration will work. The most common failure mode is **skipping the verification steps** (§8.3, §9.4, §10.3, §13.2). Do not skip them. They're cheap; debugging without them is expensive.

For questions or revisions, open an issue in the GitHub repo.
