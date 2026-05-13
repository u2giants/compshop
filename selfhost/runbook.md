# CompShop migration runbook

Step-by-step instructions for migrating CompShop from Lovable Cloud to your
self-hosted Coolify VPS. Written for someone who is comfortable using web UIs
but has not used a terminal before. Where a terminal is needed, every command
is shown verbatim — copy and paste it.

> **Total time: ~3 hours of active work spread over 2-3 days** (most of the
> time is waiting for DNS propagation, Docker image pulls, and team testing).

---

## Phase 0 — Get the values you'll need (15 min)

Open a notes app and collect these in one place. You'll paste them into Coolify later.

| Item | Where to get it |
|---|---|
| **Your VPS public IP** | Coolify → Servers → your server, top of page |
| **Lovable Cloud DB password** | Lovable → project → Cloud → Database → "Connection string" |
| **Lovable Cloud service role key** | Lovable → project → Cloud → Settings → API → `service_role` (long secret string) |
| **Google OAuth Client ID + Secret** | Google Cloud Console → APIs & Services → Credentials |
| **Brevo SMTP credentials** | Brevo dashboard → SMTP & API → SMTP tab |
| **Google Maps API key** | Already in your Lovable secrets |
| **OpenRouter API key** | https://openrouter.ai/keys (rotate the one in chat history!) |

---

## Phase 1 — DNS (5 min, then wait 5-30 min for propagation)

In your DNS provider (where `designflow.app` is managed) add **four A records**, all pointing to your VPS IP:

| Host | Type | Value |
|---|---|---|
| `comp` | A | your VPS IP |
| `api.comp` | A | your VPS IP |
| `db.comp` | A | your VPS IP |
| `comp-staging` | A | your VPS IP |

Verify propagation with https://dnschecker.org/ before continuing.

---

## Phase 2 — Generate JWT keys (5 min)

Self-hosted Supabase needs a JWT secret + matching anon/service-role keys.

1. Open https://supabase.com/docs/guides/self-hosting#api-keys in a browser
2. Scroll to "Generate API Keys"
3. Click **Generate** under "JWT Secret" → copy the result. This is your `JWT_SECRET`.
4. Paste that secret into both fields ("anon" and "service_role"), click each "Generate JWT" button
5. Save the three values: `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`

---

## Phase 3 — Deploy Supabase on Coolify (30 min)

### 3a. Create the project
1. Coolify → **+ New** → **Project**, name it `compshop`
2. Inside the project: **+ New** → **Resource** → **Docker Compose**

### 3b. Paste the compose file
1. Source: **Public Git** → URL = your GitHub repo for this Lovable project
2. Build pack: **Docker Compose**
3. Compose file path: `selfhost/compose.supabase.yml`
4. Click **Save**

### 3c. Configure environment variables
1. Click the resource → **Environment Variables** tab
2. Click **Developer view** → paste the entire contents of `selfhost/.env.example`
3. Replace every `CHANGE-ME` with the real value from your notes
4. Click **Save**

### 3d. Set domains
1. Click the resource → **Configuration** → find the `kong` service
2. Domain → `https://api.comp.designflow.app`
3. Find `studio` service → Domain → `https://db.comp.designflow.app`
4. (Recommended) On `studio`, enable **Basic Auth** so only you can reach the admin UI

### 3e. Deploy
1. Click **Deploy** (top right). First deploy takes ~5-10 min while images download.
2. Watch logs. Wait for `db`, `auth`, `rest`, `kong`, `studio` to all show healthy/running.
3. Visit `https://api.comp.designflow.app/rest/v1/` — should return JSON (not an error).
4. Visit `https://db.comp.designflow.app` — should show the Supabase Studio login.

---

## Phase 4 — Migrate the data (1-2 hours)

You'll run the export scripts from your **laptop** (or any computer with `psql`,
`curl`, `jq` installed). Then upload the resulting files to the VPS.

### 4a. Install prerequisites on your laptop
- **macOS**: `brew install postgresql jq`
- **Windows**: install [WSL](https://learn.microsoft.com/en-us/windows/wsl/install), then in WSL: `sudo apt install postgresql-client jq`

### 4b. Clone the repo + create env file
```bash
git clone <your-repo-url> compshop
cd compshop/selfhost
cp .env.example .env
```
Open `.env` in a text editor and fill in only the `LOVABLE_PG_*` and `LOVABLE_SUPABASE_URL` / `LOVABLE_SERVICE_ROLE_KEY` values.

### 4c. Run the four export scripts
```bash
cd selfhost
./scripts/01-export-schema.sh
./scripts/02-export-data.sh
./scripts/04-export-auth-users.sh
./scripts/03-export-storage.sh   # this one takes longest — downloads all photos
```

When done you'll have a `migration-export/` folder with:
- `00_schema_bootstrap.sql`
- `01_data.sql`
- `02_auth.sql`
- `storage/photos/…` and `storage/retailer-logos/…`

**Write down the timestamp now** — you'll need it for the incremental sync. Example: `2026-04-25T14:00:00Z`.

### 4d. Upload to the VPS

> **Note:** Steps 4d–4e are a one-time data migration only. SSH access is not part of the normal deployment path (which is push to `main` → GitHub Actions → Coolify). Do not use SSH for routine changes.

```bash
# Replace VPS_USER@VPS_IP with your actual SSH user + IP
scp -r migration-export VPS_USER@VPS_IP:/tmp/
```

(If you've never SSH'd in, Coolify shows the SSH command on Servers → your server.)

### 4e. Run the import on the VPS
SSH into the VPS:
```bash
ssh VPS_USER@VPS_IP
cd /tmp/migration-export
```
Get the Postgres container name:
```bash
docker ps | grep supabase | grep db
```
Then run psql inside it:
```bash
docker exec -i $(docker ps -qf name=supabase.*db) psql -U postgres -d postgres < 00_schema_bootstrap.sql
docker exec -i $(docker ps -qf name=supabase.*db) psql -U postgres -d postgres -c "TRUNCATE auth.identities, auth.users CASCADE;"
docker exec -i $(docker ps -qf name=supabase.*db) psql -U postgres -d postgres < 02_auth.sql
docker exec -i $(docker ps -qf name=supabase.*db) psql -U postgres -d postgres < 01_data.sql
```

Copy the storage files into the storage container:
```bash
docker cp storage/. $(docker ps -qf name=supabase.*storage):/var/lib/storage/
```

### 4f. Verify counts
In Supabase Studio (`https://db.comp.designflow.app`) → SQL Editor:
```sql
SELECT 'shopping_trips' AS t, count(*) FROM shopping_trips
UNION ALL SELECT 'photos', count(*) FROM photos
UNION ALL SELECT 'china_trips', count(*) FROM china_trips
UNION ALL SELECT 'china_photos', count(*) FROM china_photos
UNION ALL SELECT 'factories', count(*) FROM factories
UNION ALL SELECT 'auth users', count(*) FROM auth.users;
```
Numbers should match the source counts that script `02-export-data.sh` printed.

---

## Phase 5 — Configure Google OAuth (10 min)

1. https://console.cloud.google.com/apis/credentials → click your OAuth 2.0 Client ID
2. **Authorized JavaScript origins** — ADD (don't remove existing ones):
   - `https://comp.designflow.app`
   - `https://api.comp.designflow.app`
3. **Authorized redirect URIs** — ADD:
   - `https://api.comp.designflow.app/auth/v1/callback`
4. Save
5. Verify in Supabase Studio → Authentication → Providers → Google is enabled

---

## Phase 6 — Deploy the staging frontend (15 min)

1. Coolify project `compshop` → **+ New** → **Resource** → **Application**
2. Source = same Git repo, branch = main
3. Build pack = **Dockerfile**, path = `selfhost/Dockerfile.frontend`
4. **Build Variables** (NOT runtime env — these get baked in at build):
   - `VITE_SUPABASE_URL` = `https://api.comp.designflow.app`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = your `ANON_KEY` from Phase 2
   - `VITE_SUPABASE_PROJECT_ID` = `selfhosted`
5. Domain = `https://comp-staging.designflow.app`
6. Deploy

### Test with your team (1-2 days)
Have everyone log in at `https://comp-staging.designflow.app` and exercise:
- Login with Google ✓
- View existing trips, photos, factories ✓
- Upload a new photo (verify it lands in storage) ✓
- AI photo analysis (verify OpenRouter is being hit) ✓
- Send an invite email (verify Brevo SMTP works) ✓

Fix anything broken. Lovable Cloud is still serving production traffic this entire time — no risk.

---

## Phase 7 — Production cutover (30 min)

### 7a. Incremental sync
Pick a quiet moment. On your laptop:
```bash
cd selfhost
SINCE=2026-04-25T14:00:00Z ./scripts/06-incremental-sync.sh   # use YOUR timestamp from Phase 4c
scp migration-export/delta_*.csv VPS_USER@VPS_IP:/tmp/
```
On the VPS, for each delta file:
```bash
docker exec -i $(docker ps -qf name=supabase.*db) psql -U postgres -d postgres -c \
  "\\copy public.photos FROM '/tmp/delta_photos.csv' WITH CSV HEADER"
# repeat for each table
```

### 7b. Add the production frontend
1. Coolify → `compshop` → **+ New** → **Application** (same setup as staging)
2. Domain = `https://comp.designflow.app`
3. Same build vars as staging
4. Deploy

### 7c. Update mobile app (if applicable)
If you build the Capacitor app: edit `capacitor.config.ts` so the API URL points
at `https://api.comp.designflow.app`, rebuild, distribute.

### 7d. Done!
Lovable Cloud stays as a hot read-only backup. After 2 weeks of stable
self-hosting, you can disable Lovable Cloud writes (set tables read-only via
the Lovable migration tool) and eventually disconnect.

---

## Troubleshooting

**"SSL handshake failed" on api.comp.designflow.app**  
Coolify's Let's Encrypt issuance can take 1-2 min after first deploy. Wait, then refresh.

**Google login redirects to a "redirect_uri_mismatch" error**  
The redirect URI in Google Cloud Console must EXACTLY match `https://api.comp.designflow.app/auth/v1/callback` (no trailing slash, https not http).

**Photos load but new uploads fail with 403**  
Storage policies didn't migrate. In Studio → SQL Editor, run the storage policy section from `00_schema_bootstrap.sql` again.

**AI analysis returns "OPENROUTER_API_KEY is not configured"**  
The env var didn't make it into the `functions` container. In Coolify → resource → Environment Variables, confirm it's set, then click **Restart** on the `functions` service.

**Daily backups not appearing in `/backups`**  
The `backup` service runs `pg_dump` daily. Check `docker logs $(docker ps -qf name=backup)`. For offsite backups, mount a remote storage volume (Backblaze B2 / S3) onto `/backups` instead of a local Docker volume.

---

## What's NOT covered (and is fine for now)

- **Read replicas / HA Postgres** — single Postgres instance is fine for your team size
- **Automated offsite backups** — daily local backups are running; add Backblaze B2 sync via cron when you have time
- **Edge function deployment to self-hosted** — Coolify will pick up `supabase/functions/*` automatically when you redeploy. Confirm `analyze-photo`, `parse-teams-conversation`, `list-openrouter-models`, `nearby-stores`, `reverse-geocode`, `send-invite-email` all show up under `https://api.comp.designflow.app/functions/v1/<name>`.
