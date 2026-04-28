# Architecture

## Overview

CompShop is a React SPA backed by a self-hosted Supabase stack, both running on a single
Hong Kong VPS (CN2 GIA, 185.194.148.230) managed by Coolify.

```
Browser / Capacitor app
        │
        ▼
  Traefik (ports 80/443)          ← coolify-proxy container
   ├── comp.designflow.app         → compshop-frontend (Nginx, port 80)
   ├── api.comp.designflow.app     → Kong (port 8000)
   ├── db.comp.designflow.app      → Studio (port 3000)
   └── coolify.comp.designflow.app → Coolify (port 8080)
        │
        ▼ (all Supabase API traffic)
      Kong (API gateway)
   ├── /auth/v1/*    → GoTRUE auth (port 9999)
   ├── /rest/v1/*    → PostgREST (port 3000)
   ├── /realtime/v1/* → Realtime (port 4000)
   ├── /storage/v1/* → Storage API (port 5000)
   ├── /functions/v1/* → Edge Functions (port 9000)
   └── /pg/*         → Postgres Meta (port 8080)
```

## Hosting

Coolify runs on the VPS and manages every deployed service. Traefik (`coolify-proxy`) is
Coolify's built-in reverse proxy — it auto-routes traffic based on Docker container labels
that Coolify injects at deploy time. SSL certificates are issued by Let's Encrypt via
HTTP-01 challenge.

## Supabase stack

The Supabase services are defined in `selfhost/compose.supabase.yml` and deployed as a
single Coolify "dockercompose" application (UUID `h8nwhgk682eedokx8nh2eg1q`). Coolify
clones the repo to a temp directory and runs `docker compose up -d` on each deploy.

### Services

| Service | Image | Role |
|---------|-------|------|
| db | postgres:15.8.1.085 | Primary database |
| auth | supabase/gotrue:v2.186.0 | Authentication + OAuth |
| rest | postgrest/postgrest:v14.8 | REST API |
| realtime | supabase/realtime:v2.76.5 | WebSocket subscriptions |
| storage | supabase/storage-api:v1.48.26 | File storage |
| imgproxy | darthsim/imgproxy:v3.30.1 | On-the-fly image resizing |
| functions | supabase/edge-runtime:v1.71.2 | Deno edge functions |
| kong | kong/kong:3.9.1 | API gateway (public entry point) |
| studio | supabase/studio:2026.04.08-... | Admin UI |
| meta | supabase/postgres-meta:v0.96.3 | Postgres metadata API |
| backup | postgres:15-alpine | Daily `pg_dump`, 14-day retention |

### Kong: intentional configuration quirks

**DNS resolver**

Kong must resolve container hostnames (e.g. `auth`, `rest`) to route requests. In Docker,
the embedded DNS resolver is at `127.0.0.11`. Without explicit configuration, Kong uses
its own resolver order and fails to find containers, which produces the "name resolution
failed" error on every API call.

The fix, in `selfhost/compose.supabase.yml`:
```yaml
KONG_DNS_RESOLVER: "127.0.0.11"
KONG_DNS_ORDER: A,CNAME
```

These two vars together tell Kong to use Docker's DNS and prefer A records. Removing
either one breaks Google sign-in and all auth routes.

**Declarative config delivered via entrypoint**

Kong 3.9.1 does not read `KONG_DECLARATIVE_CONFIG_STRING` at startup (it reads only
file-based `KONG_DECLARATIVE_CONFIG`). The Kong service uses a custom entrypoint that
writes the string env var to `/tmp/kong.yml` before starting Kong:

```sh
printf '%s\n' "$KONG_DECLARATIVE_CONFIG_STRING" > /tmp/kong.yml
unset KONG_DECLARATIVE_CONFIG_STRING
export KONG_DECLARATIVE_CONFIG=/tmp/kong.yml
exec /entrypoint.sh kong docker-start
```

This looks redundant but is required. The env var approach survives Coolify redeployments
without needing a mounted config file.

**Traefik labels**

Kong's Traefik routing labels (`traefik.http.routers.*`) are injected by Coolify at deploy
time using the `docker_compose_domains` setting — they are not in the compose file itself.
Coolify reads `SERVICE_FQDN_KONG=api.comp.designflow.app` and generates the labels. If
Kong is ever recreated outside of a Coolify deploy (e.g. manual `docker compose up`), the
Traefik labels will be absent and `api.comp.designflow.app` will return 503.

## Frontend

The frontend is deployed as a separate Coolify "dockerfile" application
(`frontend-uuid-comp-shop-prod-2026`) built from `selfhost/Dockerfile.frontend`.

The build is two-stage:
1. `node:20-alpine` — installs dependencies and runs `vite build` with build-time VITE_* args
2. `nginx:1.27-alpine` — serves the static dist/ with SPA routing and long-lived cache headers

Build-time env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`VITE_SUPABASE_PROJECT_ID`) are injected by Coolify as Docker build args, so they are
baked into the JS bundle. Changing them requires a new build + deploy.

## Edge functions

Seven Deno functions in `supabase/functions/`:

| Function | Description |
|----------|-------------|
| analyze-photo | AI image analysis via OpenRouter |
| list-openrouter-models | Lists available OpenRouter models |
| nearby-stores | Google Maps Places API |
| parse-teams-conversation | AI parsing of Teams export |
| reverse-geocode | Google Maps reverse geocoding |
| send-invite-email | Email invites via Brevo SMTP |
| main | General handler |

`send-invite-email`, `nearby-stores`, and `reverse-geocode` have `verify_jwt = false` in
`supabase/config.toml` — they handle auth themselves or are public-safe.

## Database

Postgres 15 with 35 migrations (2026-02-12 to 2026-04-23). Key tables: `shopping_trips`,
`photos`, `china_trips`, `china_photos`, `factories`, `comments`, `profiles`, `user_roles`,
`invitations`.

RLS is enforced on all user-facing tables. The `profiles` table drives user identity;
`user_roles` gates admin features.

Daily backups are written to the `db-backups` Docker volume by the `backup` service
(`pg_dump -Fc`). The last 14 dumps are kept.

## Coolify

Coolify itself runs as a Docker Compose stack (`coolify`, `coolify-db`, `coolify-redis`,
`coolify-proxy`, `coolify-sentinel`, `coolify-realtime`). Its routing config lives in
`/data/coolify/proxy/dynamic/` on the host — changes there take effect immediately via
Traefik's file-watch provider.

The Coolify API is available at `https://coolify.comp.designflow.app`. API tokens are
scoped to the `claude-code` team (see Coolify Settings → API → Tokens).
