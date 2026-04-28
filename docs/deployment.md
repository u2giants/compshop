# Deployment

## Normal deploy flow

Every push to `main` triggers an automatic Coolify deployment via webhook.

```
git push origin main
        │
        ▼
  Coolify detects push (GitHub webhook)
        │
        ├── Supabase stack (compshop:main)
        │     Coolify clones the repo → runs docker compose up -d
        │     Only changed containers are recreated
        │
        └── Frontend (compshop-frontend:main)
              Coolify clones the repo → builds Dockerfile.frontend
              Replaces the running container
```

There are no GitHub Actions involved in deployment. Coolify connects directly to GitHub.

## What each deploy updates

**Supabase stack** (`selfhost/compose.supabase.yml`)

Coolify tracks the compose file in the repo. When it changes, Coolify reruns
`docker compose up -d` using the new file plus the env vars stored in Coolify.
Only containers whose config hash changed are recreated.

If you change an env var in Coolify (not in the compose file), trigger a manual
redeploy from the Coolify UI or via:

```bash
curl -X GET "https://coolify.comp.designflow.app/api/v1/deploy?uuid=h8nwhgk682eedokx8nh2eg1q" \
  -H "Authorization: Bearer $COOLIFY_TOKEN"
```

**Frontend** (`selfhost/Dockerfile.frontend`)

A new Docker image is built from the Dockerfile on every deploy. Build-time VITE_* vars
are read from the environment variables set in Coolify. The built image replaces the
running `compshop-frontend` container.

## Database migrations

Migrations in `supabase/migrations/` are **not** applied automatically on deploy. Apply
them manually:

```bash
docker exec -it db-h8nwhgk682eedokx8nh2eg1q-<suffix> \
  psql -U postgres -d postgres -f /path/to/migration.sql
```

Or via Supabase Studio (`https://db.comp.designflow.app`) → SQL Editor.

## Adding a new environment variable

1. Go to Coolify → compshop project → the relevant application → Environment Variables
2. Add the variable and save
3. Trigger a redeploy (Coolify does not auto-deploy on env var changes)
4. Update `selfhost/.env.example` in the repo with the new variable and its explanation

## Kong routing and Traefik labels

Kong's Traefik labels (which tell Traefik to route `api.comp.designflow.app` to Kong)
are injected by Coolify at deploy time. They are derived from the
`docker_compose_domains` config in Coolify's database, not from the compose file.

**If Kong is ever restarted outside of a Coolify deploy** (e.g. manual `docker compose up`),
the resulting container will not have the Traefik labels and `api.comp.designflow.app`
will return 503. Fix by triggering a full Coolify redeploy.

## Supabase Studio "unhealthy" status

Studio (db.comp.designflow.app) consistently shows `unhealthy` in `docker ps` due to
a health-check configuration issue in the Studio image version pinned in the compose file.
The Studio UI works despite this status — it is a false negative from the health check,
not a real failure.

## Releasing a Capacitor mobile build

1. `npm run build` to produce `dist/`
2. `npx cap sync` to copy dist/ into the iOS/Android projects
3. Build and submit via Xcode / Android Studio

The Capacitor build points to the production `https://api.comp.designflow.app` backend.

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
