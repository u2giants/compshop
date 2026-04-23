# AI Session Prompt: CompShop Server Migration

## What you are doing

You are completing the migration of **CompShop** from Lovable Cloud hosting to a
self-hosted Coolify VPS in Hong Kong. This session covers two phases:

1. **Server setup** — stand up the new infrastructure and validate it without
   touching the live running application at all.
2. **Cutover** — migrate the latest production data and flip traffic to the new
   server in a single coordinated window.

---

## Current state of the codebase

**Repo:** `u2giants/compshop` on GitHub  
**Live branch:** `main` — deployed by Lovable Cloud, pointing at Supabase Cloud.
**DO NOT touch `main` until the cutover step.**

**Staging branch:** `claude/migrate-coolify-deployment-389gW`  
All code changes needed for self-hosting are already committed here and verified
to build cleanly. Compared to `main`, this branch has:

| File | Change |
|---|---|
| `src/pages/Auth.tsx` | Lovable OAuth gateway replaced with direct `supabase.auth.signInWithOAuth` |
| `src/integrations/lovable/index.ts` | Deleted |
| `supabase/functions/analyze-photo/index.ts` | Lovable AI gateway replaced with Gemini REST API direct |
| `supabase/functions/parse-teams-conversation/index.ts` | Same as above |
| `supabase/functions/send-invite-email/index.ts` | Hardcoded `compshop.lovable.app` fallback replaced with `SITE_URL` env var |
| `vite.config.ts` | `lovable-tagger` plugin removed |
| `package.json` | `@lovable.dev/cloud-auth-js` and `lovable-tagger` removed |
| `Dockerfile` | Multi-stage build: node:20-alpine + nginx:alpine |
| `nginx.conf` | SPA fallback, gzip, long-cache for hashed assets, no-cache for sw.js |
| `.env` | Deleted from git tracking |
| `.env.example` | Added with placeholder values |
| `selfhost.md` | Complete runbook with all known gotchas documented |
| `CLAUDE.md` | AI session context file |

**The live app has no idea any of this exists.** Lovable deploys from `main`. The
staging branch only becomes live when you merge it at cutover time.

---

## Authoritative runbook

`selfhost.md` in the repo root is the detailed step-by-step for this entire
migration. Read it before starting. This prompt is a higher-level guide; selfhost.md
has the exact commands, env var lists, verification queries, and troubleshooting.

---

## What you have when you start this session

- A fresh VPS (recommended: Hong Kong CN2 GIA, 4 GB RAM, 80 GB SSD, Ubuntu 24.04)
  with root SSH access and a public IPv4 address.
- A domain you control with DNS managed in Cloudflare (or similar).
- A Google AI Studio account — you need a `GEMINI_API_KEY` for the two AI edge
  functions. Get one at https://aistudio.google.com/app/apikey if you don't have it.
- Your existing keys: `BREVO_API_KEY`, `GOOGLE_MAPS_API_KEY`, Brevo SMTP credentials,
  Google OAuth client ID and secret (from the existing Lovable Cloud app).
- SSH access to the old Lovable Cloud Supabase DB for the data dump (connection
  string from Lovable → Cloud → Database → Connection string → URI).

---

## Phase 1: Server setup (zero impact on live app)

### Step 1 — Provision the VPS and install Coolify

SSH in as root, then:

```bash
apt update && apt upgrade -y
apt install -y curl ufw fail2ban
hostnamectl set-hostname compshop
timedatectl set-timezone Asia/Hong_Kong
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Open `http://YOUR_VPS_IP:8000`, create the admin account, save the password
in your password manager.

In Coolify → **Sources → New Source → GitHub App**: connect your GitHub account
and grant access to the `u2giants/compshop` repo.

### Step 2 — DNS

In Cloudflare, create two A records pointing at `YOUR_VPS_IP`:

```
A  app.compshop.example.com  →  YOUR_VPS_IP   (Cloudflare proxy ON / orange cloud)
A  api.compshop.example.com  →  YOUR_VPS_IP   (Cloudflare proxy OFF / grey cloud)
```

The API hostname MUST be grey cloud — Cloudflare breaks Supabase Realtime
websockets and large file uploads.

For the frontend (`app.`) with the orange cloud on, Coolify's Let's Encrypt
HTTP-01 challenge can't reach your origin. Choose one option before deploying:

- **Option A:** temporarily turn off the orange cloud, let Coolify issue the cert,
  turn it back on, set Cloudflare SSL/TLS mode to Full (strict).
- **Option B:** In Cloudflare → SSL/TLS → Origin Server, issue a free 15-year
  Cloudflare Origin Certificate, paste the cert+key into Coolify → frontend app
  → Custom SSL.

### Step 3 — Generate secrets

On your laptop (not on the VPS):

```bash
# 1. Postgres password
openssl rand -base64 32

# 2. JWT secret (min 32 chars — used to sign ALL auth tokens)
openssl rand -base64 48

# 3. Studio dashboard password
openssl rand -base64 24

# 4. Derive anon key + service role key from the JWT secret
# Use: https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys
# Paste your JWT secret, copy both output JWTs.
```

Save all five values in your password manager before continuing. You cannot
recover them if lost.

### Step 4 — Deploy self-hosted Supabase on Coolify

**4a. Clone the Supabase docker-compose at a pinned version:**

```bash
# Check https://github.com/supabase/supabase/releases for latest stable tag
SUPABASE_TAG=v1.24.05   # update to current stable
mkdir -p /data/coolify/supabase
cd /data/coolify/supabase
git clone --depth 1 --branch "$SUPABASE_TAG" https://github.com/supabase/supabase.git
cp -r supabase/docker/volumes ./volumes
```

**4b. Update kong.yml with YOUR keys — this is the most commonly missed step:**

```bash
nano /data/coolify/supabase/volumes/api/kong.yml
```

Find the two `keyauth_credentials` consumer blocks (for `anon` and `service_role`)
and replace their `key:` values with your generated ANON_KEY and SERVICE_ROLE_KEY.
If you skip this, Kong will reject 100% of API requests with 401.

**4c. In Coolify: Projects → New Project → compshop → New Resource →
Docker Compose Empty → name it `compshop-supabase`.**

Paste the contents of `/data/coolify/supabase/supabase/docker/docker-compose.yml`
into the compose editor. Find-and-replace every `./volumes/` with
`/data/coolify/supabase/volumes/`.

**4d. In Coolify, set these environment variables on `compshop-supabase`:**

```env
POSTGRES_PASSWORD=<from step 3 #1>
JWT_SECRET=<from step 3 #2>
ANON_KEY=<derived JWT>
SERVICE_ROLE_KEY=<derived JWT>
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<from step 3 #3>
SECRET_KEY_BASE=<openssl rand -base64 64>
VAULT_ENC_KEY=<openssl rand -base64 32>

POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432

KONG_HTTP_PORT=8000
KONG_HTTPS_PORT=8443

API_EXTERNAL_URL=https://api.compshop.example.com
SUPABASE_PUBLIC_URL=https://api.compshop.example.com
SITE_URL=https://app.compshop.example.com
ADDITIONAL_REDIRECT_URLS=https://app.compshop.example.com/auth/callback,https://app.compshop.example.com/reset-password

DISABLE_SIGNUP=false
JWT_EXPIRY=3600
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=false
ENABLE_ANONYMOUS_USERS=false

SMTP_ADMIN_EMAIL=admin@compshop.example.com
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<Brevo SMTP login — the numeric login, not your account email>
SMTP_PASS=<Brevo SMTP key>
SMTP_SENDER_NAME=CompShop
MAILER_URLPATHS_CONFIRMATION=/auth/callback
MAILER_URLPATHS_INVITE=/auth/callback
MAILER_URLPATHS_RECOVERY=/reset-password
MAILER_URLPATHS_EMAIL_CHANGE=/auth/callback

STUDIO_DEFAULT_ORGANIZATION=CompShop
STUDIO_DEFAULT_PROJECT=Production
STUDIO_PORT=3000

BREVO_API_KEY=<your Brevo API key>
GOOGLE_MAPS_API_KEY=<your Google Maps key>
GEMINI_API_KEY=<from Google AI Studio>
```

Map `https://api.compshop.example.com` → service `kong` → port `8000` in Coolify
domains for this resource. Deploy. First deploy takes 5–10 minutes (image pulls).

**4e. Verify Supabase is healthy:**

```bash
curl https://api.compshop.example.com/auth/v1/health
# Expect: {"version":"v...","name":"GoTrue",...}

curl https://api.compshop.example.com/rest/v1/ -H "apikey: YOUR_ANON_KEY"
# Expect: OpenAPI JSON
```

### Step 5 — Configure Google OAuth

1. Google Cloud Console → APIs & Services → Credentials → your existing OAuth 2.0
   Client ID → add Authorized redirect URI:
   `https://api.compshop.example.com/auth/v1/callback`
2. Supabase Studio (open via Coolify) → Authentication → Providers → Google →
   Enable → paste existing Client ID and Client Secret → Save.

### Step 6 — Migrate the database schema

Get the Lovable Cloud direct connection string (not the pooler):
`postgresql://postgres.aqbyrzknbhyshjzlfsyv:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres`

Get the new DB connection string from Coolify → compshop-supabase → Connect → Postgres.
You may need to temporarily expose port 5432 in the compose file to reach it from
your laptop.

```bash
export OLD_DB_URL="postgresql://postgres.aqbyrzknbhyshjzlfsyv:PASSWORD@..."
export NEW_DB_URL="postgresql://postgres:POSTGRES_PASSWORD@YOUR_VPS_IP:5432/postgres"

# Ensure extensions exist on the new DB first
psql "$NEW_DB_URL" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
psql "$NEW_DB_URL" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# Dump schema only (NOT auth/realtime/supabase_functions/vault/extensions schemas)
pg_dump "$OLD_DB_URL" \
  --schema=public --schema=storage \
  --no-owner --no-privileges --schema-only \
  > /tmp/compshop-schema.sql

psql "$NEW_DB_URL" < /tmp/compshop-schema.sql
```

Verify:
```bash
psql "$NEW_DB_URL" -c "\dt public.*"
# Must list: categories, china_photos, china_trip_members, china_trips, comments,
# countries, factories, image_types, invitations, photo_annotations, photos,
# profiles, retailers, shopping_trips, trip_members, user_roles

psql "$NEW_DB_URL" -c "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='app_role';"
# Must return: admin, user, store_readonly, china_readonly
```

### Step 7 — Migrate storage buckets

Install rclone:
```bash
brew install rclone   # macOS
```

Configure two rclone S3 remotes (`rclone config`):
- `sb-old`: endpoint `https://aqbyrzknbhyshjzlfsyv.supabase.co/storage/v1/s3`,
  access key = Lovable anon key, secret = Lovable service role key
- `sb-new`: endpoint `https://api.compshop.example.com/storage/v1/s3`,
  access key = new ANON_KEY, secret = new SERVICE_ROLE_KEY

Create the two buckets in Studio (Storage → New bucket):
- `photos` — private (not public)
- `retailer-logos` — public

Then copy:
```bash
rclone copy "sb-old:photos"         ./photos-backup   --progress
rclone copy "sb-old:retailer-logos" ./logos-backup    --progress
rclone copy ./photos-backup   "sb-new:photos"         --progress
rclone copy ./logos-backup    "sb-new:retailer-logos" --progress

# Verify counts match
rclone size "sb-old:photos" && rclone size "sb-new:photos"
```

### Step 8 — Deploy edge functions

From your laptop, rsync the functions into the mounted volume on the VPS, then
restart the container:

```bash
rsync -avz --delete supabase/functions/ root@YOUR_VPS_IP:/data/coolify/supabase/volumes/functions/
ssh root@YOUR_VPS_IP "cd /data/coolify/supabase && docker compose restart functions"
ssh root@YOUR_VPS_IP "cd /data/coolify/supabase && docker compose logs functions --tail=20"
```

### Step 9 — Deploy the frontend (from the STAGING BRANCH, not main)

In Coolify → Projects → compshop → New Resource → Application → GitHub App:
- Repo: `u2giants/compshop`
- **Branch: `claude/migrate-coolify-deployment-389gW`** ← critical, not main
- Build pack: Dockerfile
- Domain: `https://app.compshop.example.com`
- **Build Variables** (not runtime — Vite bakes these in at compile time):
  ```
  VITE_SUPABASE_URL=https://api.compshop.example.com
  VITE_SUPABASE_PUBLISHABLE_KEY=<your new ANON_KEY>
  VITE_SUPABASE_PROJECT_ID=local
  ```

Deploy. Access `https://app.compshop.example.com` — it should load the app
talking to your self-hosted Supabase. Run the full smoke test from selfhost.md §13.2.

At this point the live app at `compshop.lovable.app` is completely unaffected.
Users keep using it. You are validating the new stack privately.

---

## Phase 2: Cutover with latest data

> Do this during a low-traffic window. The entire cutover takes ~15 minutes.
> The live app will be read-only/down for the duration of the data migration
> (~5 minutes), then fully live on the new server.

### Step 1 — Final data snapshot

Do this immediately before flipping DNS, with as little time as possible between
the dump and the DNS change to minimize data gap.

**Put the old app into maintenance mode first** (prevents writes during the dump):
- Temporarily set `DISABLE_SIGNUP=true` on Lovable Cloud (buys you nothing
  functionally, but is a signal)
- Better: in Cloudflare, point `compshop.lovable.app` at a maintenance page,
  OR temporarily change the ANON_KEY in Lovable Cloud settings to an invalid value
  so API calls fail gracefully. This ensures no new rows are written during the dump.

Then dump auth users and app data:

```bash
export OLD_DB_URL="postgresql://postgres.aqbyrzknbhyshjzlfsyv:PASSWORD@..."
export NEW_DB_URL="postgresql://postgres:POSTGRES_PASSWORD@YOUR_VPS_IP:5432/postgres"

# Auth users (--disable-triggers prevents handle_new_user firing on import)
pg_dump "$OLD_DB_URL" \
  --table=auth.users --table=auth.identities \
  --data-only --disable-triggers \
  --no-owner --no-privileges --column-inserts \
  > /tmp/compshop-auth.sql

# App data
pg_dump "$OLD_DB_URL" \
  --schema=public --data-only \
  --disable-triggers \
  --no-owner --no-privileges \
  > /tmp/compshop-data.sql
```

### Step 2 — Load data into new DB

```bash
# Disable triggers to prevent FK conflicts during load
psql "$NEW_DB_URL" -c "SET session_replication_role = replica;"
psql "$NEW_DB_URL" < /tmp/compshop-auth.sql
psql "$NEW_DB_URL" < /tmp/compshop-data.sql
psql "$NEW_DB_URL" -c "SET session_replication_role = DEFAULT;"
```

### Step 3 — Reset sequences

```bash
psql "$NEW_DB_URL" << 'SQL'
SELECT setval(pg_get_serial_sequence('public.photos', 'id'),          COALESCE(MAX(id), 1)) FROM public.photos;
SELECT setval(pg_get_serial_sequence('public.comments', 'id'),        COALESCE(MAX(id), 1)) FROM public.comments;
SELECT setval(pg_get_serial_sequence('public.shopping_trips', 'id'),  COALESCE(MAX(id), 1)) FROM public.shopping_trips;
SELECT setval(pg_get_serial_sequence('public.china_trips', 'id'),     COALESCE(MAX(id), 1)) FROM public.china_trips;
SQL
```

### Step 4 — Restore the Realtime publication

```bash
psql "$NEW_DB_URL" << 'SQL'
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.photos, public.comments, public.shopping_trips,
  public.china_trips, public.china_trip_members, public.trip_members,
  public.photo_annotations;
SQL
```

### Step 5 — Verify row counts match old DB

```sql
-- Run on BOTH old and new DBs and compare every number:
SELECT 'shopping_trips' AS t, count(*) FROM shopping_trips
UNION ALL SELECT 'china_trips',    count(*) FROM china_trips
UNION ALL SELECT 'photos',         count(*) FROM photos
UNION ALL SELECT 'china_photos',   count(*) FROM china_photos
UNION ALL SELECT 'comments',       count(*) FROM comments
UNION ALL SELECT 'profiles',       count(*) FROM profiles
UNION ALL SELECT 'user_roles',     count(*) FROM user_roles
UNION ALL SELECT 'factories',      count(*) FROM factories
UNION ALL SELECT 'auth.users',     count(*) FROM auth.users;
```

**Do not proceed if any number differs.**

### Step 6 — Final storage sync

Any photos uploaded during the test period need to be synced:

```bash
rclone sync "sb-old:photos"         "sb-new:photos"         --progress
rclone sync "sb-old:retailer-logos" "sb-new:retailer-logos" --progress
```

### Step 7 — Switch Coolify frontend to main branch

In Coolify → frontend app → Configuration → Git → Branch:
change from `claude/migrate-coolify-deployment-389gW` to `main`.

But before saving, **merge the staging branch into main on GitHub**:

```bash
git checkout main
git merge claude/migrate-coolify-deployment-389gW
git push origin main
```

Coolify will auto-redeploy from main with the new Dockerfile and code.
Wait for the build to complete before flipping DNS.

### Step 8 — Flip DNS

In Cloudflare: the A records for `app.compshop.example.com` and
`api.compshop.example.com` already point at your VPS from the setup phase.
This step is just un-doing any maintenance page you set, and making sure
`compshop.lovable.app` users are directed to the new domain (update links,
notify users).

If you were using `compshop.lovable.app` as the primary URL, update DNS/redirects
so it points to `app.compshop.example.com`.

### Step 9 — Smoke test on production data

Go through selfhost.md §13.2 smoke test checklist on the live domain.
Key items:
- Sign in with Google SSO (tests GoTrue + OAuth config)
- Upload a photo (tests Storage + signed URLs)
- Open an existing trip and verify all historic photos render
- Add a comment (tests Realtime)
- Use AI extract on a photo (tests Gemini edge function + GEMINI_API_KEY)
- Send a test invite email (tests Brevo SMTP)
- Open DevTools → Network → confirm zero requests to `*.supabase.co` or `lovable.dev`
- Test from a China network if possible — latency should be <3s

### Step 10 — Keep Lovable Cloud alive for 30 days

Do not cancel the Lovable subscription immediately. Keep it active as a rollback
option. If anything critical breaks, you can revert DNS to `compshop.lovable.app`
in under 5 minutes — the old backend is still running and untouched.

---

## Critical gotchas to not forget

1. **kong.yml must have your actual JWTs before first deploy** (Step 4b above).
   The file ships with placeholder keys. All API requests return 401 until fixed.

2. **`ENABLE_ANONYMOUS_USERS=false` always.** This app is invite-only. Never
   enable anonymous users in any Supabase config.

3. **SMTP_USER for Brevo is the numeric SMTP login** (looks like `1234ab@smtp-brevo.com`),
   not your Brevo account email.

4. **Cloudflare orange cloud must be OFF for `api.compshop.example.com`.**
   Realtime will silently not work if proxied.

5. **Build Variables vs Runtime Variables in Coolify.** The three `VITE_*` env vars
   must be set as Build Variables — Vite bakes them into the static bundle at
   compile time. Setting them as runtime vars does nothing.

6. **After the data load, test that an existing user can sign in.** Auth tokens
   from the old instance use a different JWT secret — users will be bounced to
   the sign-in page, which is expected and correct. They sign in once and get a
   new session issued by the new GoTrue.

7. **The staging branch Dockerfile uses `bun.lock`** (new text format), not
   `bun.lockb`. This is already correct in the committed Dockerfile.

8. **Edge functions are deployed via rsync + docker compose restart**, not via
   `supabase functions deploy` (that CLI command only targets Supabase Cloud).

---

## Reference: current Lovable Cloud project

- Supabase project ref: `aqbyrzknbhyshjzlfsyv`
- Supabase URL: `https://aqbyrzknbhyshjzlfsyv.supabase.co`
- Region: us-east-1 (AWS)
- All migrations are in `supabase/migrations/` (29 files, latest: 20260423)
- Storage buckets: `photos` (private), `retailer-logos` (public)
- Edge functions: `analyze-photo`, `parse-teams-conversation`, `nearby-stores`,
  `reverse-geocode`, `send-invite-email`

## Reference: staging branch

- Branch name: `claude/migrate-coolify-deployment-389gW`
- All Lovable dependencies removed, Dockerfile present, Gemini functions written
- `npm run build` verified clean on this branch

## Reference: the full runbook

`selfhost.md` in the repo root has exhaustive detail on every phase, all env vars,
all verification queries, troubleshooting, and rollback procedures. When in doubt,
read that file. This prompt is a map; selfhost.md is the territory.
