# Configuration

## Where configuration lives

| Config | Location | Who sets it |
|--------|----------|-------------|
| Supabase runtime env vars | Coolify → Application → Environment Variables | Human / AI via Coolify API |
| Frontend build-time env vars | Coolify → Application → Environment Variables (build args) | Human / AI via Coolify API |
| Local development env vars | `.env` (root, committed) or `.env.local` (not committed) | Developer |
| Supabase stack compose defaults | `selfhost/.env.example` | Reference only |

**Runtime env vars are not stored in this repo.** They live in Coolify and are injected at
deploy time. `selfhost/.env.example` documents every var with explanations and is the
authoritative reference for what Coolify must have configured.

## Frontend build-time variables (VITE_*)

These are baked into the JS bundle at build time. Changing them requires a new deploy.

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Full URL to the Kong gateway, e.g. `https://api.comp.designflow.app` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon (public) JWT — safe to expose in the bundle |
| `VITE_SUPABASE_PROJECT_ID` | Used to construct storage URLs; set to `selfhosted` for the self-hosted backend |

See `selfhost/.env.frontend.example` for the self-hosted values.

## Supabase stack runtime variables

All of these are set in Coolify under the "compshop:main" application. The full list with
explanations is in `selfhost/.env.example`. Key groups:

### Domains

| Variable | Example |
|----------|---------|
| `API_EXTERNAL_URL` | `https://api.comp.designflow.app` |
| `SUPABASE_PUBLIC_URL` | `https://api.comp.designflow.app` |
| `SITE_URL` | `https://comp.designflow.app` |
| `ADDITIONAL_REDIRECT_URLS` | `https://comp-staging.designflow.app,http://localhost:5173` |

`SITE_URL` is GoTRUE's primary allowed redirect after auth. `ADDITIONAL_REDIRECT_URLS` is
a comma-separated list of additional allowed origins — **must include** localhost for local
dev OAuth to work.

### Database

| Variable | Notes |
|----------|-------|
| `POSTGRES_PASSWORD` | Postgres superuser password |
| `POSTGRES_DB` | Database name (default: `postgres`) |
| `POSTGRES_HOST` | Service name within the compose network (default: `db`) |
| `POSTGRES_PORT` | Default: `5432` |

### JWT

| Variable | Notes |
|----------|-------|
| `JWT_SECRET` | Signs all Supabase JWTs — must match the secret used to generate `ANON_KEY` and `SERVICE_ROLE_KEY` |
| `JWT_EXPIRY` | Token TTL in seconds (default: `3600`) |
| `ANON_KEY` | Long-lived anonymous JWT — used as `VITE_SUPABASE_PUBLISHABLE_KEY` in the frontend |
| `SERVICE_ROLE_KEY` | Full-access JWT — never exposed to browsers; used only in edge functions and server-side scripts |

**All three of `JWT_SECRET`, `ANON_KEY`, and `SERVICE_ROLE_KEY` must be generated together.**
Use `selfhost/runbook.md § Phase 2` for the generation command. If the secret and the
keys do not match, all authenticated requests will return 401.

### Google OAuth

| Variable | Notes |
|----------|-------|
| `GOTRUE_EXTERNAL_GOOGLE_ENABLED` | `true` to enable Google sign-in |
| `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID` | GCP OAuth client ID |
| `GOTRUE_EXTERNAL_GOOGLE_SECRET` | GCP OAuth client secret |
| `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI` | Must be `https://api.comp.designflow.app/auth/v1/callback` |

The redirect URI must match exactly what is registered in the Google Cloud Console.

### SMTP (Brevo)

| Variable | Notes |
|----------|-------|
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Brevo account email |
| `SMTP_PASS` | Brevo SMTP key (not the account password) |
| `SMTP_SENDER_NAME` | From name shown in emails |
| `SMTP_ADMIN_EMAIL` | Reply-to / admin email |

Used for password reset, magic link, and invite emails.

### Storage

| Variable | Default | Notes |
|----------|---------|-------|
| `STORAGE_BACKEND` | `file` | Stores files on the Docker volume `storage-data` |
| `FILE_SIZE_LIMIT` | `52428800` | 50 MB per upload |

### AI / edge functions

| Variable | Notes |
|----------|-------|
| `AI_PROVIDER` | `openrouter` |
| `AI_MODEL` | Default model, e.g. `google/gemini-2.5-flash` |
| `OPENROUTER_API_KEY` | OpenRouter API key (sk-or-v1-…) |
| `OPENROUTER_HTTP_REFERER` | Should match `SITE_URL` |
| `OPENROUTER_APP_TITLE` | Shown in OpenRouter dashboard |
| `GOOGLE_MAPS_API_KEY` | Used by `nearby-stores` and `reverse-geocode` functions |
| `BREVO_API_KEY` | Used by `send-invite-email` function (separate from SMTP key) |

### Studio

| Variable | Notes |
|----------|-------|
| `DASHBOARD_USERNAME` | Basic-auth username for Supabase Studio |
| `DASHBOARD_PASSWORD` | Basic-auth password for Supabase Studio |

### Coolify service URLs (auto-injected)

Coolify injects these at deploy time — do not set them manually:

| Variable | Value |
|----------|-------|
| `SERVICE_FQDN_KONG` | `api.comp.designflow.app` |
| `SERVICE_URL_KONG` | `https://api.comp.designflow.app` |
| `SERVICE_FQDN_STUDIO` | `db.comp.designflow.app` |
| `SERVICE_URL_STUDIO` | `https://db.comp.designflow.app` |

## Coolify instance settings

Coolify's own domain (`coolify.comp.designflow.app`) is set in Coolify → Settings → General
→ Instance URL and stored in the `instance_settings.fqdn` column in the Coolify database.
The Traefik routing rule for this domain is a static file at
`/data/coolify/proxy/dynamic/coolify-domain.yaml` on the host (written once, not managed
by the repo).

## Local development .env

The committed root `.env` contains Lovable Cloud credentials (non-sensitive public anon
key + project URL). It is safe to commit and usable for local dev. Do not put self-hosted
credentials or service-role keys in the root `.env`.
