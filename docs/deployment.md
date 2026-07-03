# Deployment

## Normal deploy flow

Deployment is triggered by GitHub Actions, which calls the Coolify API.

```
git push origin main
        │
        ▼
  GitHub Actions: "Deploy to Coolify"
        │
        ▼
  Workflow queries Coolify resources and calls /api/v1/deploy
        │
        ├── Supabase service (supabase-compshop)
        │     Coolify deploys service UUID lc7f483hklyq89eej67idpbx
        │     Only deployed when compose/functions paths changed
        │
        └── Frontend (compshop-frontend:main)
              Coolify clones the repo → builds Dockerfile.frontend
              Replaces the running container
```

The workflow is `.github/workflows/deploy.yml`. It runs on `workflow_dispatch` and on
pushes to `main` that touch deployment-relevant paths (`src/**`, `supabase/functions/**`,
`selfhost/compose.supabase.yml`, `selfhost/Dockerfile.frontend`, `selfhost/nginx.conf`,
package files, or the workflow itself). It uses GitHub Secrets `COOLIFY_BASE_URL` and
`COOLIFY_TOKEN`.

The workflow discovers resources through the Coolify API, pins the frontend app to the
current `GITHUB_SHA`, updates `VITE_COMMIT_HASH` and `VITE_COMMIT_DATE`, deploys the
frontend with `force=true`, and stops stale historical frontend apps named
`compshop:main` if they reappear.

## What each deploy updates

**Supabase service** (`supabase-compshop`, UUID `lc7f483hklyq89eej67idpbx`)

Production currently runs from the Coolify service `supabase-compshop`. The repo still
keeps `selfhost/compose.supabase.yml` as the self-hosting/deploy reference, but the live
service includes Coolify-template containers such as MinIO, Supavisor, analytics, and
vector. The workflow deploys this service only when `selfhost/compose.supabase.yml` or
`supabase/functions/**` changes.

If you change an env var in Coolify (not in the compose file), trigger a manual
redeploy from the Coolify UI or via:

```bash
curl -X GET "https://coolify.comp.designflow.app/api/v1/deploy?uuid=lc7f483hklyq89eej67idpbx" \
  -H "Authorization: Bearer $COOLIFY_TOKEN"
```

You can also run the `Deploy to Coolify` workflow manually from GitHub Actions.

**Frontend** (`selfhost/Dockerfile.frontend`)

A new Docker image is built from the Dockerfile on every frontend deploy. Build-time
VITE_* vars are read from the environment variables set in Coolify. The built image
replaces the running `frontend-uuid-comp-shop-prod-2026` container. The frontend app is
served at both `https://comp.designflow.app` and `https://compshop.designflow.app`.

## Database migrations

Migrations in `supabase/migrations/` are **not** applied automatically on deploy. Apply
them manually to the current production DB container:

```bash
docker exec -it supabase-db-lc7f483hklyq89eej67idpbx \
  psql -U postgres -d postgres -f /path/to/migration.sql
```

Or via Supabase Studio (`https://db.comp.designflow.app`) → SQL Editor.

After a migration, verify expected row counts and RLS behavior from the app or SQL before
calling the deploy complete.

## Adding a new environment variable

1. Go to Coolify → compshop project → the relevant application → Environment Variables
2. Add the variable and save
3. Trigger a redeploy (Coolify does not auto-deploy on env var changes)
4. Update `selfhost/.env.example` in the repo with the new variable and its explanation

## API routing and Traefik labels

The current migrated production API route is:

`api.comp.designflow.app` → Traefik → `compshop-api-proxy` → `supabase-kong-lc7f483hklyq89eej67idpbx`.

The repo compose reference still documents the older Coolify-injected Kong label pattern.
If `api.comp.designflow.app` returns 502/503, check the proxy and live Kong container
before changing frontend auth code.

**If Kong is ever restarted outside of a Coolify deploy** (e.g. manual `docker compose up`),
verify that `compshop-api-proxy` still points to the current Kong container.

## Frontend Coolify deployment settings

Two settings in the Coolify database control how frontend container replacements work.
Both are already set correctly for this app — this section documents them so the
behaviour is not mistaken for a bug.

| Setting | Value | Effect |
|---------|-------|--------|
| `is_consistent_container_name_enabled` | `true` | Every deploy uses the same container name. Docker stops the old container before starting the new one. |
| `docker_images_to_keep` | `1` | Coolify removes prior build images after a successful deploy. |

**Why this matters.** When consistent naming is disabled (the Coolify default), each
deploy gets a unique container name. If two containers from different builds end up
running simultaneously, Traefik rejects both because they register the same router name
with different configs — producing a "no available server" error for all requests.
Enabling consistent naming eliminates that failure mode entirely.

These settings are in the Coolify UI under the `compshop-frontend:main` application →
General → "Consistent Container Name" and "Number of Docker images to keep". They can
also be read/written directly:

```bash
# Verify
docker exec coolify-db psql -U coolify -d coolify \
  -c "SELECT is_consistent_container_name_enabled, docker_images_to_keep \
      FROM application_settings;"
```

## Supabase Studio "unhealthy" status

Studio (db.comp.designflow.app) consistently shows `unhealthy` in `docker ps` due to
a health-check configuration issue in the Studio image version pinned in the compose file.
The Studio UI works despite this status — it is a false negative from the health check,
not a real failure.

## Backrest local dump hook

The production host runs Backrest as an operational backup service. Backrest is outside
the normal frontend/Supabase deploy path, but its hook script is repo-owned so production
does not depend on undocumented host-only behavior.

Authoritative hook source:

```text
selfhost/backrest/pre-backup.sh
```

Current production mount:

```text
/opt/backrest/scripts/pre-backup.sh -> /scripts/pre-backup.sh in the backrest container
/opt/backrest/db-dumps -> /db-dumps in the backrest container
```

The hook writes short-lived local `*-latest.*` files plus timestamped SQL/RDB dumps for
Backrest to snapshot. It prunes timestamped local dumps before and after each run, keeps
24 hours by default (`DUMP_RETENTION_MINUTES=1440`), and exits before dumping if less
than 5 GB is free in the dump directory (`DUMP_MIN_FREE_MB=5120`).

If an emergency host-side edit is made to `/opt/backrest/scripts/pre-backup.sh`, copy the
fix back into `selfhost/backrest/pre-backup.sh` in the same incident follow-up. The server
copy must not become the long-term source of truth.

## Releasing a Capacitor mobile build

1. `npm run build` to produce `dist/`
2. `npx cap sync` to copy dist/ into the iOS/Android projects
3. Build and submit via Xcode / Android Studio

Known current state: `capacitor.config.ts` still sets `server.url` to a Lovable
`lovableproject.com` URL. Update that deliberately as part of a mobile release plan before
building/submitting mobile apps, and verify whether the app should load the production
frontend or a bundled `dist/`.

## Rollback

Rollback is primarily a code revert/fix-forward:

1. Revert or fix the bad commit on `main`.
2. Push to `origin/main`.
3. Let `.github/workflows/deploy.yml` trigger Coolify, or run it manually.

Database migrations are not applied automatically and do not have automatic rollbacks.
For schema changes, write explicit repair/down SQL or a forward migration.

Frontend image rollback depends on Coolify image-retention settings. This repo documents
`docker_images_to_keep=1`, so do not promise previous-image rollback without verifying
the current Coolify app settings first.

## Coolify API token

API tokens are managed in Coolify → Settings → API → Tokens. The `claude-code` token is
used by AI tools for automated deploys and inspection. Store it as a secret; do not
commit it.

The token created during initial setup is stored only in the Coolify database. To rotate:
delete the old token in the Coolify UI and create a new one.

## Traefik configuration for Coolify itself

The routing rule for `coolify.comp.designflow.app` is a static Traefik dynamic config
at `/data/coolify/proxy/dynamic/coolify-domain.yaml` on the VPS. This file is not managed
by the repo. If it is ever lost (e.g. server rebuild), recreate it with:

```yaml
http:
  routers:
    coolify-http:
      entryPoints: [http]
      rule: "Host(`coolify.comp.designflow.app`)"
      middlewares: [redirect-to-https]
      service: coolify-svc
    coolify-https:
      entryPoints: [https]
      rule: "Host(`coolify.comp.designflow.app`)"
      service: coolify-svc
      tls:
        certResolver: letsencrypt
  middlewares:
    redirect-to-https:
      redirectScheme:
        scheme: https
  services:
    coolify-svc:
      loadBalancer:
        servers:
          - url: "http://coolify:8080"
```

Write this file to the Traefik dynamic config directory:
```bash
docker exec coolify-proxy sh -c 'cat > /traefik/dynamic/coolify-domain.yaml << ...'
```
