# Configuration

## Where configuration lives

| Config | Location | Who sets it |
|--------|----------|-------------|
| Supabase runtime env vars | Coolify → `supabase-compshop` → Environment Variables | Human / AI via Coolify API |
| Frontend build-time env vars | Coolify → `compshop-frontend:main` → Environment Variables/build args | Human / AI via Coolify API |
| Local development env vars | `.env.local` (not committed) or copied from `.env.example` | Developer |
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
| `VITE_COMMIT_HASH` | Short commit hash shown in the app top bar; set by the deploy workflow |
| `VITE_COMMIT_DATE` | Commit timestamp shown in the app top bar in New York time; set by the deploy workflow |

See `selfhost/.env.frontend.example` for the self-hosted values.

## Supabase stack runtime variables

All of these are set in Coolify under the `supabase-compshop` service
(`lc7f483hklyq89eej67idpbx`). The full list with explanations is in
`selfhost/.env.example`. Key groups:

### Domains

| Variable | Example |
|----------|---------|
| `API_EXTERNAL_URL` | `https://api.comp.designflow.app` |
| `SUPABASE_PUBLIC_URL` | `https://api.comp.designflow.app` |
| `SITE_URL` | `https://comp.designflow.app` |
| `ADDITIONAL_REDIRECT_URLS` | `https://compshop.designflow.app,https://comp-staging.designflow.app,http://localhost:8080` |

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

### Microsoft OAuth

The "Continue with Microsoft" button uses Supabase GoTrue's direct Azure provider. It does not route through Authentik.

| Variable | Notes |
|----------|-------|
| `GOTRUE_EXTERNAL_AZURE_ENABLED` | `true` to enable Microsoft sign-in |
| `GOTRUE_EXTERNAL_AZURE_CLIENT_ID` | Azure app registration client ID |
| `GOTRUE_EXTERNAL_AZURE_SECRET` | Azure app registration client secret |
| `GOTRUE_EXTERNAL_AZURE_REDIRECT_URI` | Must be `https://api.comp.designflow.app/auth/v1/callback` |

Configure the Azure app registration account type for the desired sign-in surface. For CompShop's current model, use a registration that permits the POP Creations tenant and invited external Microsoft personal/work accounts. Do not rely on Azure tenant restriction for app authorization; CompShop enforces access with database approval rules:

- Company Microsoft users can be auto-approved by adding an `auth_access_rules` row with `rule_type = 'microsoft_tenant'`, `provider = 'azure'`, and `status = 'approved'`.
- External Microsoft, Google, or email/password users can be invited by email or approved by an admin after first sign-in.
- Unknown OAuth users remain pending and receive no app role until approved.

The old Authentik/Keycloak bridge variables should remain disabled for CompShop direct SSO:

| Variable | Notes |
|----------|-------|
| `GOTRUE_EXTERNAL_KEYCLOAK_ENABLED` | `false` for CompShop direct SSO |
| `GOTRUE_EXTERNAL_KEYCLOAK_*` | Legacy Authentik bridge settings kept only for rollback/reference |

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
| `S3_PROTOCOL_ACCESS_KEY_ID` | placeholder | Required by the pinned Storage API config if S3 protocol support is enabled |
| `S3_PROTOCOL_ACCESS_KEY_SECRET` | placeholder | Required by the pinned Storage API config if S3 protocol support is enabled |

### AI / edge functions

| Variable | Notes |
|----------|-------|
| `SUPABASE_URL` | Supabase API URL available to edge functions |
| `SUPABASE_ANON_KEY` | Anon key used by edge functions when they create a Supabase client |
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

### Coolify service URLs (auto-injected or proxy-backed)

Coolify injects these at deploy time — do not set them manually:

| Variable | Value |
|----------|-------|
| `SERVICE_FQDN_KONG` | `api.comp.designflow.app` |
| `SERVICE_URL_KONG` | `https://api.comp.designflow.app` |
| `SERVICE_FQDN_STUDIO` | `db.comp.designflow.app` |
| `SERVICE_URL_STUDIO` | `https://db.comp.designflow.app` |

The current production API is also fronted by the `compshop-api-proxy` nginx container,
which routes `https://api.comp.designflow.app` to the live Kong container for
`lc7f483hklyq89eej67idpbx`.

## Coolify instance settings

Coolify's own domain (`coolify.comp.designflow.app`) is set in Coolify → Settings → General
→ Instance URL and stored in the `instance_settings.fqdn` column in the Coolify database.
The Traefik routing rule for this domain is a static file at
`/data/coolify/proxy/dynamic/coolify-domain.yaml` on the host (written once, not managed
by the repo).

## Local development .env

The repo does not commit a root `.env`. Copy `.env.example` to `.env.local` for local
browser development and use only browser-safe values there. Do not commit self-hosted
anon keys, service-role keys, SMTP keys, OAuth secrets, or other production credentials.
