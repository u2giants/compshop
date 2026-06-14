# Architecture

## Overview

CompShop is a React SPA backed by a self-hosted Supabase stack, both running on a single
Hong Kong VPS (CN2 GIA, 185.194.148.230) managed by Coolify.

```
Browser / Capacitor app
        │
        ▼
  Traefik (ports 80/443)          ← coolify-proxy container
   ├── comp.designflow.app         → frontend-uuid-comp-shop-prod-2026 (Nginx, port 80)
   ├── compshop.designflow.app     → frontend-uuid-comp-shop-prod-2026 (Nginx, port 80)
   ├── api.comp.designflow.app     → compshop-api-proxy → Kong
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

Production Supabase currently runs as Coolify service `supabase-compshop` (UUID
`lc7f483hklyq89eej67idpbx`). The repo still contains `selfhost/compose.supabase.yml` as
the project-owned self-hosting/deploy reference, but the live migrated Coolify service
uses Coolify-template containers including MinIO, Supavisor, analytics, and vector.

### Services

| Service/container | Image | Role |
|---------|-------|------|
| `supabase-db-lc7f483hklyq89eej67idpbx` | `supabase/postgres:15.8.1.085` | Primary database |
| `supabase-auth-lc7f483hklyq89eej67idpbx` | `supabase/gotrue:v2.186.0` | Authentication + OAuth |
| `supabase-rest-lc7f483hklyq89eej67idpbx` | `postgrest/postgrest:v14.6` | REST API |
| `realtime-dev-lc7f483hklyq89eej67idpbx` | `supabase/realtime:v2.76.5` | WebSocket subscriptions |
| `supabase-storage-lc7f483hklyq89eej67idpbx` | `supabase/storage-api:v1.44.2` | File storage API |
| `supabase-minio-lc7f483hklyq89eej67idpbx` | `ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z` | Object storage backend |
| `imgproxy-lc7f483hklyq89eej67idpbx` | `darthsim/imgproxy:v3.30.1` | On-the-fly image resizing |
| `supabase-edge-functions-lc7f483hklyq89eej67idpbx` | `supabase/edge-runtime:v1.71.2` | Deno edge functions |
| `supabase-kong-lc7f483hklyq89eej67idpbx` | `kong/kong:3.9.1` | Internal API gateway |
| `compshop-api-proxy` | `nginx` | Public proxy from `api.comp.designflow.app` to Kong |
| `supabase-studio-lc7f483hklyq89eej67idpbx` | `supabase/studio:2026.03.16-sha-5528817` | Admin UI |
| `supabase-meta-lc7f483hklyq89eej67idpbx` | `supabase/postgres-meta:v0.95.2` | Postgres metadata API |
| `supabase-supavisor-lc7f483hklyq89eej67idpbx` | `supabase/supavisor:2.7.4` | Postgres pooler |
| `supabase-analytics-lc7f483hklyq89eej67idpbx` | `supabase/logflare:1.31.2` | Analytics/logging |
| `supabase-vector-lc7f483hklyq89eej67idpbx` | `timberio/vector:0.53.0-alpine` | Log shipping |

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
On the current migrated stack, `api.comp.designflow.app` reaches Kong through the
`compshop-api-proxy` nginx container. If the proxy or Kong is recreated outside the
documented deployment flow, verify public API routing before debugging app code.

## Frontend

The frontend is deployed as a separate Coolify "dockerfile" application built from
`selfhost/Dockerfile.frontend`. The frontend Coolify UUID is
`frontend-uuid-comp-shop-prod-2026`, resource name `compshop-frontend:main`, with domains
`https://comp.designflow.app` and `https://compshop.designflow.app`.

The build is two-stage:
1. `node:20-alpine` — installs dependencies and runs `vite build` with build-time VITE_* args
2. `nginx:1.27-alpine` — serves the static dist/ with SPA routing and long-lived cache headers

Build-time env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`VITE_SUPABASE_PROJECT_ID`, `VITE_COMMIT_HASH`, `VITE_COMMIT_DATE`) are injected by
Coolify as Docker build args/env, so they are baked into the JS bundle. Changing them
requires a new build + deploy.

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

Postgres 15 with 32 migrations (2026-02-12 to 2026-06-13, counted from
`supabase/migrations/` during the documentation audit). Key tables: `shopping_trips`,
`photos`, `china_trips`, `china_photos`, `factories`, `comments`, `profiles`,
`user_roles`, `invitations`, `auth_access_rules`.

The trip list pages read `shopping_trips_with_stats` and `china_trips_with_stats`
security-invoker views from `20260612000000_trip_list_stats_views.sql`. These views
precompute photo counts, member counts, and cover file paths so list pages do not issue
per-trip count/cover queries.

RLS is enforced on all user-facing tables. The `profiles` table drives user identity;
`user_roles` gates admin features.

Backup retention depends on the current Coolify service configuration. The old repo
compose file includes a `db-backups` volume and backup service, but the migrated
production service should be verified in Coolify before promising a specific retention
window.

## Storage layout

The live Storage API uses private buckets and signed URLs. After the 2026-06-14
migration, production MinIO contains a mixed historical layout: some objects are stored as
raw `bucket/name` keys and others as `bucket/name/version` keys. This is expected for the
current data set. Storage audits must check both possible keys and compare object sizes
against `storage.objects`; a versioned-key-only audit produces false missing-file
reports.

## Offline upload queue

New photo/video captures are saved into IndexedDB before network upload. The queue lives
in `pending_uploads` (`src/lib/offline-db.ts`) and is processed sequentially by
`src/lib/sync-service.ts`. Pending uploads keep the original `Blob`, metadata, stable
Storage path, optional thumbnail path, file hash, upload stage, retry count, last error,
and `next_retry_at`.

The sync loop uploads to private Supabase Storage first, then inserts the database row
with the pending upload id. Repeated transient failures move the item to
`failed_needs_attention`; the app must not delete pending uploads merely because retry
count is high.

## Coolify

Coolify itself runs as a Docker Compose stack (`coolify`, `coolify-db`, `coolify-redis`,
`coolify-proxy`, `coolify-sentinel`, `coolify-realtime`). Its routing config lives in
`/data/coolify/proxy/dynamic/` on the host — changes there take effect immediately via
Traefik's file-watch provider.

The Coolify API is available at `https://coolify.comp.designflow.app`. API tokens are
scoped to the `claude-code` team (see Coolify Settings → API → Tokens).
