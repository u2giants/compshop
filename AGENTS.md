# CompShop Agent Guide

## Project summary

CompShop is a React + TypeScript PWA for POP Creations sourcing teams to capture, organize, annotate, and bulk-edit trade-show and buying-trip photos. The app runs against a self-hosted Supabase stack, uses private Storage signed URLs and IndexedDB for weak-network/offline workflows, and the outcome that matters is reliable photo capture and retrieval during China/Hong Kong sourcing trips.

## Multi-model AI note

There is no universal ignore-file standard across AI coding tools.

`.claudeignore` works for Claude Code.

When using any other AI tool, paste this file as your first message and follow the instructions in the "What to ignore" section.

## Documentation map: what to read for each task

Always start with:

- `AGENTS.md`

Then load additional docs only when relevant:

| Task / question | Read these docs | Usually do not need |
|---|---|---|
| Quick repo orientation | `README.md`, `AGENTS.md` | Deep docs under `docs/` unless task requires them |
| Modify app behavior or project-owned code | `AGENTS.md`, relevant folder-level `README.md`, `docs/architecture.md` if system design is affected | `docs/deployment.md` unless deploy behavior changes |
| Add or change configuration, env vars, feature flags, secrets, or runtime settings | `AGENTS.md`, `docs/configuration.md`, `docs/deployment.md` if prod/runtime env is affected | Unrelated architecture docs |
| Change local setup, dev scripts, test/lint/debug workflow, package scripts, or tooling | `AGENTS.md`, `docs/development.md`, relevant package/config files | `docs/deployment.md` unless CI/CD changes |
| Change deployment, Docker, CI/CD, hosting, release flow, rollback, or runtime environment | `AGENTS.md`, `docs/deployment.md`, `docs/configuration.md`, relevant workflow/deployment files | Local-only development docs unless needed |
| Change database schema, migrations, models, external IDs, or data flow | `AGENTS.md`, `docs/architecture.md`, `docs/configuration.md` if env/config is affected, relevant migration/model docs | Deployment docs unless rollout/deploy behavior changes |
| Investigate bugs or incidents | `AGENTS.md`, relevant docs based on affected area, `HANDOFF.md` if present, Critical incidents section in `AGENTS.md` | Unrelated folder-level READMEs |
| Continue unfinished work | `AGENTS.md`, `HANDOFF.md`, relevant docs named inside `HANDOFF.md` | Docs unrelated to the handoff scope |
| Work in a subfolder with its own README | `AGENTS.md`, that folder-level `README.md`, and only broader docs referenced there | Other folder-level READMEs |
| Claude Code session | `CLAUDE.md`, then `AGENTS.md` | Other docs unless task requires them |
| Documentation-only cleanup | `AGENTS.md`, `README.md`, affected docs under `docs/`, folder-level READMEs only where relevant | Source files except as needed to verify accuracy |

Historical or narrow docs:

- `selfhost.md` and `selfhost/runbook.md` are migration history and operational reference. Do not load them for routine app work.
- `docs/offline-pwa-plan.md` is a planning/audit document for offline improvements. Load only for offline/PWA roadmap work or upload-durability follow-up.
- `docs/authentik.md` is for Authentik identity-provider administration, not ordinary app auth UI work.

## Repository structure

Project-owned code:

- `src/pages/` - route-level React pages.
- `src/components/` - app components; `src/components/ui/` is shadcn/ui-derived and should be treated as framework scaffolding.
- `src/contexts/`, `src/hooks/`, `src/lib/`, `src/types/` - app state, hooks, utilities, local types.
- `supabase/functions/` - Deno edge functions.
- `supabase/migrations/` - database migrations.
- `selfhost/` - production Docker Compose, frontend Dockerfile, nginx config, env examples, migration scripts.
- `.github/workflows/` - Coolify deploy/audit workflows.
- `docs/`, `README.md`, `AGENTS.md`, `CLAUDE.md` - documentation.

Generated code:

- `src/integrations/supabase/types.ts` - generated Supabase database types.
- `src/integrations/supabase/client.ts` has a generated-file header but is the checked-in Supabase client wrapper.

Third-party/vendor/framework code:

- `src/components/ui/` - shadcn/ui primitives; edit only when intentionally changing the design-system primitive.
- `node_modules/` - dependencies, not committed.
- Package manager lockfiles if present are dependency metadata, not app logic.

Build artifacts:

- `dist/`, `dist-ssr/`, `coverage/`, `.cache/`, `supabase/.temp/`.

Docs:

- `README.md` - quick entry point and orientation.
- `AGENTS.md` - canonical AI/developer operating guide.
- `CLAUDE.md` - Claude Code-specific notes only.
- `docs/architecture.md`, `docs/development.md`, `docs/configuration.md`, `docs/deployment.md` - topic-specific detail.
- `selfhost/README.md` - local context for the self-hosting folder.

Scripts:

- `selfhost/scripts/01-export-schema.sh` through `06-incremental-sync.sh` - completed Lovable Cloud migration helpers, kept for re-run/reference.
- `package.json` scripts - local build/test/lint/dev commands.

Migrations:

- `supabase/migrations/` has 32 SQL migrations as of this audit, through `20260613000000_auth_access_approval.sql`.

Deployment files:

- `.github/workflows/deploy.yml` - GitHub Actions deploy trigger to Coolify.
- `.github/workflows/coolify-audit.yml` - manual Coolify inspection workflow.
- `selfhost/compose.supabase.yml` - self-hosted Supabase stack.
- `selfhost/Dockerfile.frontend` - frontend image build.
- `selfhost/nginx.conf` - frontend Nginx runtime config.
- `supabase/config.toml` - Supabase CLI/function config; project ID still points at the old Lovable Cloud project for local CLI context.

## Prime Directive: custom-code boundary

Our custom code lives here:

- `src/pages/`
- `src/components/` except avoid casual edits to `src/components/ui/`
- `src/contexts/`
- `src/hooks/`
- `src/lib/`
- `src/types/`
- `supabase/functions/`
- `supabase/migrations/`
- `selfhost/`
- `.github/workflows/`
- `docs/`
- `README.md`
- `AGENTS.md`
- `CLAUDE.md`

Everything else requires justification before touching.
Purpose: prevent AI agents from scattering project logic into unrelated framework, vendor, generated, or third-party files.

## Core modification inventory

| File | Change made | Why it was necessary | Risk during upgrades |
|---|---|---|---|
| `src/integrations/supabase/client.ts` | Checked-in Supabase client wrapper reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. | Required app integration point for Supabase JS client. | Supabase type regeneration or template tooling may overwrite comments/options; verify auth persistence settings. |
| `src/components/ui/*` | shadcn/ui primitives are present in source control. | App UI uses local shadcn components instead of importing a binary vendor package. | Updating shadcn components can overwrite local class changes; compare generated diffs carefully. |

## Task-to-file navigation: what to edit for common changes

| Task | Files to touch | Files not to touch |
|---|---|---|
| Change login screen or OAuth button behavior | `src/pages/Auth.tsx`, `src/contexts/AuthContext.tsx`, `docs/configuration.md` if providers/env change | `selfhost/compose.supabase.yml` unless GoTrue provider config changes |
| Change app routing or shell navigation | `src/App.tsx`, `src/components/layout/AppShell.tsx`, `src/components/ModeRedirect.tsx` | `supabase/migrations/` |
| Change domestic trip list/detail behavior | `src/pages/Trips.tsx`, `src/pages/TripDetail.tsx`, `src/components/trip/*`, `src/lib/photo-utils.ts` | `selfhost/` unless runtime/deploy changes |
| Change China/Asia trip behavior | `src/pages/ChinaTrips.tsx`, `src/pages/ChinaTripDetail.tsx`, `src/pages/FairTripStream.tsx`, `src/components/trip/ChinaTripCard.tsx`, `src/components/trip/CantonFairGroupCard.tsx` | Old Lovable migration docs |
| Change factory views | `src/pages/Factories.tsx`, `src/pages/FactoryDetail.tsx`, `src/pages/FactoryWeekStream.tsx` | `src/pages/Trips.tsx` unless shared behavior changes |
| Change offline caching/sync | `src/lib/offline-db.ts`, `src/lib/sync-service.ts`, `src/lib/pending-upload-utils.ts`, `src/lib/bulk-cache.ts`, `src/components/CachedImage.tsx`, `src/components/SyncStatusIndicator.tsx`, `src/components/trip/PendingUploadCard.tsx`, `src/components/settings/StorageQuotaManager.tsx`, `docs/architecture.md` if behavior changes | Browser/vendor cache folders |
| Add database field/table/policy | New file in `supabase/migrations/`, then regenerate/check `src/integrations/supabase/types.ts`, update affected pages/components | Existing applied migration files unless explicitly repairing unreleased local work |
| Add edge function behavior | Relevant `supabase/functions/<name>/index.ts`, `supabase/config.toml` if JWT setting changes, `docs/configuration.md` if env changes | Frontend pages unless UI calls change |
| Add or change env var | `.env.example`, `selfhost/.env.example`, `selfhost/.env.frontend.example`, `docs/configuration.md`, `docs/deployment.md` if deploy steps change | Production `.env` values in git |
| Change deployment pipeline | `.github/workflows/deploy.yml`, `.github/workflows/coolify-audit.yml`, `selfhost/compose.supabase.yml`, `selfhost/Dockerfile.frontend`, `docs/deployment.md` | App source unless deploy behavior requires it |
| Change PWA/Capacitor behavior | `vite.config.ts`, `capacitor.config.ts`, `public/`, `docs/development.md` or `docs/deployment.md` as appropriate | Supabase migrations |
| Update documentation routing | `AGENTS.md`, `README.md`, affected doc under `docs/`, folder README if relevant | Source files except to verify facts |

## Data model and external identifiers

| Entity/System | Identifier | Where defined | Notes |
|---|---|---|---|
| Supabase CLI project | `aqbyrzknbhyshjzlfsyv` | `supabase/config.toml` | Old Lovable Cloud project ID for CLI/local context; self-hosted prod uses Coolify stack. Do not treat as production backend ID. |
| Production frontend | `https://comp.designflow.app`, `https://compshop.designflow.app` | `README.md`, `docs/architecture.md`, Coolify | Public app URLs served by the frontend app. `comp.designflow.app` is the primary URL. |
| Production API/Kong | `https://api.comp.designflow.app` | `selfhost/.env.example`, `selfhost/compose.supabase.yml` | Public Supabase API gateway URL. |
| Supabase Studio | `https://db.comp.designflow.app` | `selfhost/.env.example`, `docs/architecture.md` | Admin UI; credentials live in Coolify env/basic auth. |
| Coolify dashboard | `https://coolify.comp.designflow.app` | Docs | Deployment platform UI. |
| Production Supabase service | `lc7f483hklyq89eej67idpbx` | Coolify, `docs/architecture.md`, deploy docs | Current production self-hosted Supabase stack. Coolify resource name: `supabase-compshop`. |
| Historical Supabase app | `h8nwhgk682eedokx8nh2eg1q` | Old Coolify resource, migration notes | Former Supabase stack. Do not treat as production unless deliberately inspecting old rescue data. |
| Frontend Coolify app | `frontend-uuid-comp-shop-prod-2026` | Coolify, `.github/workflows/deploy.yml` discovery output | Resource name: `compshop-frontend:main`; domains are `comp.designflow.app` and `compshop.designflow.app`. |
| Capacitor app ID | `app.lovable.compshop` | `capacitor.config.ts` | Mobile wrapper identifier. |
| App roles | `admin`, `user`, `store_readonly`, `china_readonly` | `supabase/migrations/20260420075829_*.sql`, `src/integrations/supabase/types.ts` | Do not rename casually; used by RLS/auth UI. |
| Storage bucket | `photos` | `supabase/migrations/20260212171102_*.sql` | Private bucket; use signed URLs. |
| Storage bucket | `retailer-logos` | `supabase/migrations/20260213005958_*.sql` | Public bucket. |
| Storage object layout | Raw `bucket/name` and versioned `bucket/name/version` keys | Production MinIO/storage volume | 2026-06-14 audit found all 2,006 DB storage rows backed by a raw or versioned object; do not require only versioned keys. |
| Domestic trips | `shopping_trips` | `supabase/migrations/`, `src/integrations/supabase/types.ts` | Main domestic/store shopping trip table. |
| Asia trips | `china_trips` | `supabase/migrations/`, `src/integrations/supabase/types.ts` | China/Hong Kong trip table; `venue_type` includes `canton_fair`, `factory_visit`, `booth_visit`. |
| Photos | `photos`, `china_photos` | `supabase/migrations/`, `src/integrations/supabase/types.ts` | Domestic and Asia photo records. |
| Trip list stats views | `shopping_trips_with_stats`, `china_trips_with_stats` | `supabase/migrations/20260612000000_trip_list_stats_views.sql` | Security-invoker views used by trip list pages to avoid per-trip count/cover queries. |
| Offline pending upload statuses | `pending`, `uploading`, `failed`, `failed_needs_attention` | `src/lib/offline-db.ts`, `src/lib/sync-service.ts` | `failed_needs_attention` preserves local blobs after repeated failures instead of deleting them. |
| Direct Microsoft OAuth | GoTrue `azure` provider | `src/pages/Auth.tsx`, `selfhost/compose.supabase.yml` | Microsoft sign-in no longer routes through Authentik. CompShop approval rules decide app access after authentication. |

## Container and service inventory

| Container/service | Purpose | Managed by | App/project ID | Image/source |
|---|---|---|---|---|
| `frontend-uuid-comp-shop-prod-2026` | Serves Vite build with Nginx | Coolify dockerfile app | `frontend-uuid-comp-shop-prod-2026` | `selfhost/Dockerfile.frontend` (`node:20-alpine` build, `nginx:1.27-alpine` runtime) |
| `supabase-db-lc7f483hklyq89eej67idpbx` | Postgres database | Coolify service | `lc7f483hklyq89eej67idpbx` | `supabase/postgres:15.8.1.085` |
| `supabase-auth-lc7f483hklyq89eej67idpbx` | GoTrue auth/OAuth/email auth | Coolify service | `lc7f483hklyq89eej67idpbx` | `supabase/gotrue:v2.186.0` |
| `supabase-rest-lc7f483hklyq89eej67idpbx` | PostgREST API | Coolify service | `lc7f483hklyq89eej67idpbx` | `postgrest/postgrest:v14.6` |
| `realtime-dev-lc7f483hklyq89eej67idpbx` | WebSocket subscriptions | Coolify service | `lc7f483hklyq89eej67idpbx` | `supabase/realtime:v2.76.5` |
| `supabase-storage-lc7f483hklyq89eej67idpbx` | Supabase Storage API | Coolify service | `lc7f483hklyq89eej67idpbx` | `supabase/storage-api:v1.44.2` |
| `supabase-kong-lc7f483hklyq89eej67idpbx` | Internal Supabase API gateway | Coolify service | `lc7f483hklyq89eej67idpbx` | `kong/kong:3.9.1` |
| `compshop-api-proxy` | Public proxy from `api.comp.designflow.app` to the current Kong container | Docker/nginx on host | Outside Coolify app UUID | `nginx` |
| `supabase-minio-lc7f483hklyq89eej67idpbx` | Object storage backend for Supabase Storage | Coolify service | `lc7f483hklyq89eej67idpbx` | `ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z` |
| `imgproxy-lc7f483hklyq89eej67idpbx` | Image transforms/thumbnails | Coolify service | `lc7f483hklyq89eej67idpbx` | `darthsim/imgproxy:v3.30.1` |
| `supabase-edge-functions-lc7f483hklyq89eej67idpbx` | Deno edge functions | Coolify service | `lc7f483hklyq89eej67idpbx` | `supabase/edge-runtime:v1.71.2` |
| `supabase-studio-lc7f483hklyq89eej67idpbx` | Supabase Studio | Coolify service | `lc7f483hklyq89eej67idpbx` | `supabase/studio:2026.03.16-sha-5528817` |
| `supabase-meta-lc7f483hklyq89eej67idpbx` | Postgres metadata API | Coolify service | `lc7f483hklyq89eej67idpbx` | `supabase/postgres-meta:v0.95.2` |
| `supabase-supavisor-lc7f483hklyq89eej67idpbx` | Postgres connection pooler | Coolify service | `lc7f483hklyq89eej67idpbx` | `supabase/supavisor:2.7.4` |
| `supabase-analytics-lc7f483hklyq89eej67idpbx` | Supabase analytics/logging | Coolify service | `lc7f483hklyq89eej67idpbx` | `supabase/logflare:1.31.2` |
| `supabase-vector-lc7f483hklyq89eej67idpbx` | Log shipping/observability pipeline | Coolify service | `lc7f483hklyq89eej67idpbx` | `timberio/vector:0.53.0-alpine` |
| `compshop-old-db-rescue` and related `compshop-old-*-rescue` containers | Old-stack rescue/reference after migration | Host Docker | Historical `h8nwhgk682eedokx8nh2eg1q` data | Old stack images; not production traffic |
| `coolify-proxy` | Traefik reverse proxy | Coolify platform | Outside this repo | Coolify-managed Traefik |
| Coolify core services | Deployment platform, DB, Redis, realtime/sentinel | Coolify platform | Outside this repo | Managed by Coolify install |

## What to ignore

These paths exist or may be generated, but should not consume AI context unless the task explicitly requires them:

- `node_modules/`
- `dist/`
- `dist-ssr/`
- `.cache/`
- `coverage/`
- `supabase/.temp/`
- `logs/`
- `*.log`
- `.DS_Store`
- `.idea/`
- `.vscode/` except `.vscode/extensions.json`
- `.lovable/`
- `public/*.png` and `public/*.ico` unless changing app icons/PWA assets
- `selfhost/runbook.md` and `selfhost.md` unless working on historical migration or recovery procedures
- `docs/offline-pwa-plan.md` unless working on offline/PWA roadmap or upload-durability follow-up
- Generated `src/integrations/supabase/types.ts` unless DB types/schema are relevant

These entries must stay aligned with `.claudeignore` and `.cursorignore`.

## Intentional quirks and non-obvious decisions

### CompShop uses direct Microsoft OAuth

Looks like:
The Microsoft login should route through the Authentik `keycloak` compatibility bridge.

Actually:
`src/pages/Auth.tsx` calls `supabase.auth.signInWithOAuth({ provider: "azure" })`. `selfhost/compose.supabase.yml` enables `GOTRUE_EXTERNAL_AZURE_*`. The app does not restrict Microsoft authentication to one Azure tenant; it restricts automatic app provisioning through `auth_access_rules`.

Why:
POP Creations tenant users should be auto-approved, but invited or manually approved external Microsoft accounts can also use CompShop. Google and email/password users use the same approval gate.

Do not change because:
Routing CompShop SSO back through Authentik reintroduces the broker dependency and bypasses the intended direct-provider approval model. The legacy `oidc-compat` service can remain disabled for rollback/reference.

### Kong declarative config is written by entrypoint

Looks like:
The compose file uses an overcomplicated `KONG_DECLARATIVE_CONFIG_STRING` plus shell entrypoint instead of mounting `kong.yml`.

Actually:
The Kong service writes the env string to `/tmp/kong.yml`, unsets the string, exports `KONG_DECLARATIVE_CONFIG`, and starts Kong.

Why:
Kong 3.9.1 reliably reads file-based declarative config, and the env-string approach survives Coolify redeploys without a mounted config file.

Do not change because:
Removing the entrypoint can leave Kong without routes for auth/rest/storage/functions.

### Kong DNS resolver is explicit

Looks like:
`KONG_DNS_RESOLVER=127.0.0.11` and `KONG_DNS_ORDER=A,CNAME` are unnecessary Docker trivia.

Actually:
They force Kong to use Docker's embedded DNS and prefer container A records.

Why:
Without them, Kong can fail to resolve services like `auth` and `rest`, causing API-wide "name resolution failed" errors.

Do not change because:
Auth, REST, storage, realtime, and function routes can all fail.

### Traefik labels are not in compose

Looks like:
`selfhost/compose.supabase.yml` is missing public Traefik router labels for Kong and Studio.

Actually:
Coolify injects labels from its domain settings (`SERVICE_FQDN_KONG`, `SERVICE_FQDN_STUDIO`) during deploy.

Why:
This is how Coolify manages domains/SSL for Docker Compose resources.

Do not change because:
Manual labels can conflict with Coolify. If containers are recreated outside Coolify, trigger a proper Coolify redeploy to restore labels.

### Live Supabase stack is not only the repo compose file

Looks like:
`selfhost/compose.supabase.yml` is the complete source of truth for every production Supabase container.

Actually:
Production is currently the Coolify service `supabase-compshop` (`lc7f483hklyq89eej67idpbx`) with Coolify-template containers including MinIO, Supavisor, analytics, and vector. The repo compose file remains the project-owned reference for self-hosting and deploy-related changes.

Why:
The 2026-06-14 migration moved production to the new Coolify-managed Supabase service while preserving the repo's self-hosting kit and scripts.

Do not change because:
Assuming production only has the repo-compose service names can make DB, storage, or auth repairs target the old or wrong containers.

### Storage objects can be raw or versioned keys

Looks like:
Every Supabase Storage object should exist only at `bucket/name/version` in MinIO.

Actually:
The 2026-06-14 migration audit found 2,006 `storage.objects` rows backed by files: 1,416 as raw `bucket/name` objects and 590 as versioned `bucket/name/version` objects. Public signed fetches work through the Storage API for both layouts, and the exact old physical storage tree is also preserved in the new MinIO data.

Why:
The migration preserved mixed historical Storage layouts from the old stack. A strict versioned-key-only audit reports false missing files.

Do not change because:
Deleting or rewriting the raw objects can break access to older uploads and removes a recovery path. Audit storage by checking raw or versioned key presence and size.

### Capacitor still points at Lovable URL

Looks like:
`capacitor.config.ts` should point at `https://comp.designflow.app`.

Actually:
It currently has `server.url` set to `https://6054c773-88f0-46d6-aed8-439b0531b157.lovableproject.com?forceHideBadge=true`.

Why:
This was left from the Lovable Cloud era and has not been updated in the repo.

Do not change because:
This is not known to be intentional long-term. Change it only as part of a deliberate mobile release plan, then update docs and rebuild/resubmit mobile apps.

### Supabase CLI project ID is Lovable Cloud

Looks like:
`supabase/config.toml` points at the wrong backend.

Actually:
`project_id = "aqbyrzknbhyshjzlfsyv"` remains for Supabase CLI/local context; production uses the self-hosted Coolify stack.

Why:
The self-hosted deployment does not use Supabase Cloud project IDs.

Do not change because:
Changing it without a CLI migration plan can break local function/migration workflows.

## Credentials and environment

Do not commit real secret values. Runtime values live in Coolify. GitHub Actions secrets live in GitHub. Example files must use placeholders for secrets.

| Variable | Purpose | Stored where | Required in dev | Required in prod |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | Browser Supabase API URL | `.env.local` or Coolify frontend build args | yes | yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser anon/public key | `.env.local` or Coolify frontend build args | yes | yes |
| `VITE_SUPABASE_PROJECT_ID` | Storage URL helper/project marker | `.env.local` or Coolify frontend build args | yes | yes |
| `SUPABASE_URL` | Edge-function Supabase API URL | Supabase/functions runtime env | no | yes for edge functions |
| `SUPABASE_ANON_KEY` | Edge-function anon client key | Supabase/functions runtime env | no | yes for edge functions |
| `API_EXTERNAL_URL` | Public GoTrue/API external URL | Coolify Supabase stack env | no | yes |
| `SUPABASE_PUBLIC_URL` | Public Supabase API URL for services/Studio | Coolify Supabase stack env | no | yes |
| `STUDIO_PUBLIC_URL` | Studio public URL reference | Coolify Supabase stack env | no | yes |
| `SITE_URL` | Primary auth redirect frontend URL | Coolify Supabase stack env | no | yes |
| `ADDITIONAL_REDIRECT_URLS` | Extra allowed auth redirects | Coolify Supabase stack env | yes for OAuth | yes |
| `POSTGRES_PASSWORD` | Postgres/admin service password | Coolify Supabase stack env | local Supabase only if self-hosting locally | yes |
| `POSTGRES_DB` | Database name | Coolify Supabase stack env | no | yes |
| `POSTGRES_PORT` | Database port | Coolify Supabase stack env | no | yes |
| `POSTGRES_HOST` | Database service host | Coolify Supabase stack env/reference | no | yes |
| `JWT_SECRET` | Signs Supabase JWTs | Coolify Supabase stack env | no | yes |
| `JWT_EXPIRY` | Auth token TTL | Coolify Supabase stack env | no | yes |
| `ANON_KEY` | Supabase anon JWT | Coolify Supabase stack env; frontend uses matching publishable key | yes if self-host backend | yes |
| `SERVICE_ROLE_KEY` | Supabase service-role JWT | Coolify Supabase stack env | no | yes |
| `DISABLE_SIGNUP` | GoTrue signup switch | Coolify Supabase stack env | no | yes |
| `ENABLE_EMAIL_SIGNUP` | Email signup switch | Coolify Supabase stack env | no | yes |
| `ENABLE_EMAIL_AUTOCONFIRM` | Email confirmation behavior | Coolify Supabase stack env | no | yes |
| `ENABLE_PHONE_SIGNUP` | Phone signup switch | Coolify Supabase stack env | no | yes |
| `GOTRUE_EXTERNAL_GOOGLE_ENABLED` | Enables Google OAuth | Coolify Supabase stack env | optional | yes if Google login needed |
| `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID` | Google OAuth client ID | Coolify Supabase stack env | optional | yes if Google login needed |
| `GOTRUE_EXTERNAL_GOOGLE_SECRET` | Google OAuth client secret | Coolify Supabase stack env | no | yes if Google login needed |
| `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI` | Google OAuth callback | Coolify Supabase stack env | optional | yes if Google login needed |
| `GOTRUE_EXTERNAL_AZURE_ENABLED` | Enables direct Microsoft OAuth | Coolify Supabase stack env | optional | yes if Microsoft login needed |
| `GOTRUE_EXTERNAL_AZURE_CLIENT_ID` | Azure app registration client ID | Coolify Supabase stack env | optional | yes if Microsoft login needed |
| `GOTRUE_EXTERNAL_AZURE_SECRET` | Azure app registration client secret | Coolify Supabase stack env | no | yes if Microsoft login needed |
| `GOTRUE_EXTERNAL_AZURE_REDIRECT_URI` | Azure OAuth callback | Coolify Supabase stack env | optional | yes if Microsoft login needed |
| `GOTRUE_EXTERNAL_KEYCLOAK_ENABLED` | Legacy Authentik bridge switch; keep `false` for CompShop direct SSO | Coolify Supabase stack env | optional | no |
| `GOTRUE_EXTERNAL_KEYCLOAK_CLIENT_ID` | Legacy Authentik OAuth client ID | Coolify Supabase stack env | optional | no |
| `GOTRUE_EXTERNAL_KEYCLOAK_SECRET` | Legacy Authentik OAuth client secret | Coolify Supabase stack env | no | no |
| `GOTRUE_EXTERNAL_KEYCLOAK_URL` | Legacy OIDC compatibility proxy URL | Coolify Supabase stack env | optional | no |
| `GOTRUE_EXTERNAL_KEYCLOAK_REDIRECT_URI` | Legacy Authentik callback | Coolify Supabase stack env | optional | no |
| `SMTP_HOST` | GoTrue SMTP host | Coolify Supabase stack env | optional | yes for email auth/reset |
| `SMTP_PORT` | GoTrue SMTP port | Coolify Supabase stack env | optional | yes for email auth/reset |
| `SMTP_USER` | SMTP username | Coolify Supabase stack env | no | yes for email auth/reset |
| `SMTP_PASS` | SMTP password/key | Coolify Supabase stack env | no | yes for email auth/reset |
| `SMTP_SENDER_NAME` | Email sender display name | Coolify Supabase stack env | optional | yes for email auth/reset |
| `SMTP_ADMIN_EMAIL` | Sender/reply address | Coolify Supabase stack env | optional | yes for email auth/reset |
| `STORAGE_BACKEND` | Storage backend selector | Coolify Supabase stack env | no | yes |
| `FILE_SIZE_LIMIT` | Upload max size | Coolify Supabase stack env | no | yes |
| `DASHBOARD_USERNAME` | Studio basic-auth/admin username | Coolify Supabase stack env | no | yes |
| `DASHBOARD_PASSWORD` | Studio basic-auth/admin password | Coolify Supabase stack env | no | yes |
| `AI_PROVIDER` | Edge function AI provider switch | Coolify Supabase stack env | optional | yes for AI functions |
| `AI_MODEL` | Default AI model | Coolify Supabase stack env | optional | yes for AI functions |
| `OPENROUTER_API_KEY` | OpenRouter API access | Coolify Supabase stack env | no | yes for AI functions |
| `OPENROUTER_HTTP_REFERER` | OpenRouter referer header | Coolify Supabase stack env | optional | yes for AI functions |
| `OPENROUTER_APP_TITLE` | OpenRouter app title header | Coolify Supabase stack env | optional | yes for AI functions |
| `LOVABLE_API_KEY` | Legacy fallback AI provider key if `AI_PROVIDER=lovable` | Coolify only if intentionally using fallback | no | no unless fallback enabled |
| `GOOGLE_MAPS_API_KEY` | Maps/places/reverse geocode | Coolify Supabase stack env | no | yes for map functions |
| `BREVO_API_KEY` | Invite email edge function | Coolify Supabase stack env | no | yes for invites |
| `S3_PROTOCOL_ACCESS_KEY_ID` | Storage S3 protocol key | Coolify Supabase stack env | no | yes if S3 protocol is enabled by storage service |
| `S3_PROTOCOL_ACCESS_KEY_SECRET` | Storage S3 protocol secret | Coolify Supabase stack env | no | yes if S3 protocol is enabled by storage service |
| `COOLIFY_TOKEN` | GitHub Actions deploy/audit API token | GitHub Actions secrets | no | yes for workflows |
| `COOLIFY_BASE_URL` | Coolify API base URL | GitHub Actions secrets | no | yes for workflows |
| `LOVABLE_PG_HOST`, `LOVABLE_PG_PORT`, `LOVABLE_PG_USER`, `LOVABLE_PG_PASSWORD`, `LOVABLE_PG_DB`, `LOVABLE_SUPABASE_URL`, `LOVABLE_SERVICE_ROLE_KEY` | Historical migration source access | Only local/operator env when re-running migration scripts | no | no for normal production |
| `NEW_PG_HOST`, `NEW_PG_PORT`, `NEW_PG_USER`, `NEW_PG_PASSWORD`, `NEW_PG_DB` | Import script destination DB vars | Local/operator env for `selfhost/scripts/05-import-all.sh` | no | no for normal production |

## Deployment

Real deployment path:

1. Commit to `main`.
2. Push to GitHub.
3. GitHub Actions workflow `Deploy to Coolify` (`.github/workflows/deploy.yml`) runs on `workflow_dispatch` or on pushes to `main` that touch `selfhost/compose.supabase.yml`, `selfhost/Dockerfile.frontend`, `selfhost/nginx.conf`, `supabase/functions/**`, `src/**`, `package.json`, `bun.lockb`, `package-lock.json`, or the workflow itself.
4. The workflow uses GitHub Secrets `COOLIFY_BASE_URL` and `COOLIFY_TOKEN`, queries `/api/v1/resources`, finds the production Supabase service and frontend app by resource name/domain, stops stale historical frontend apps named `compshop:main`, and calls `/api/v1/deploy?uuid=...`.
5. Supabase deploys only when `selfhost/compose.supabase.yml` or `supabase/functions/**` changed. The frontend deploys for app/package/nginx/workflow changes or manual workflow dispatch.
6. Before frontend deploy, the workflow pins the Coolify app to `GITHUB_SHA` and updates `VITE_COMMIT_HASH` and `VITE_COMMIT_DATE` so the top bar shows the live commit stamp.

Image/package names:

- Frontend image is built by Coolify from `selfhost/Dockerfile.frontend`; recent tags use the app UUID plus commit SHA, for example `frontend-uuid-comp-shop-prod-2026:<sha>`.
- The repo self-hosting compose pins its service images. The current live `supabase-compshop` service image set is documented in the container inventory above and should be verified in Coolify before changing production service versions.

Deployment platform/app IDs:

- Coolify at `https://coolify.comp.designflow.app`.
- Supabase production service UUID: `lc7f483hklyq89eej67idpbx`.
- Frontend app UUID: `frontend-uuid-comp-shop-prod-2026`.

Runtime environment variables:

- Supabase stack runtime env lives in Coolify application environment variables.
- Frontend `VITE_*` values are Coolify build args/env and are baked into the JS bundle.
- GitHub Actions deploy secrets are `COOLIFY_TOKEN` and `COOLIFY_BASE_URL`.

Rollback:

- Frontend rollback depends on Coolify image retention. Docs currently state `docker_images_to_keep=1`, so routine previous-image rollback may not be available. Verify in Coolify before promising rollback.
- Code rollback path is a revert commit on `main` followed by the deploy workflow.
- Database migrations are manual and not automatically rolled back. Write explicit down/fix-forward SQL when needed.

SSH:

- SSH is not the normal deployment path.
- SSH is exceptional for host recovery, direct database maintenance, or Coolify/Traefik repair when the UI/API is unavailable.
- Do not hand-edit production files over SSH as a routine deploy.

## Critical incidents

### 2026-06-12 Image flicker on `/china`

What happened:
The `/china` trip list flickered while scrolling; images appeared late or not at all.

Impact:
Trip cover images were unreliable during browsing, especially before cover blobs or signed URLs were cached.

Root cause:
Image components could wait on IndexedDB before painting available signed URLs, and cached trip rows did not always hydrate cover signed URLs before rendering.

Recovery:
Commits `86528b6` and `9a32cb9` improved image cache fallbacks, signed URL reuse, and in-memory blob URL reuse.

Rule added to prevent recurrence:
When changing signed URL/blob caching, verify both first-load online behavior and cached-row render behavior. Documentation changes were not required for the code-only cache fix.

### 2026-06-12 Pending upload auto-delete risk

What happened:
Static review found that `src/lib/sync-service.ts` removed pending uploads after five failed attempts.

Impact:
On weak trade-show networks, transient failures could delete the only local copy of a photo/video before it reached Supabase.

Root cause:
The sync loop treated high retry count as abandoned work instead of a user-visible failure state.

Recovery:
Pending uploads now keep stable storage paths, retry metadata, upload stage, last error, `next_retry_at`, and `failed_needs_attention` status. Sync no longer auto-removes failed local blobs.

Rule added to prevent recurrence:
Never delete `pending_uploads` as retry cleanup. Only remove a pending upload after successful DB persistence, duplicate confirmation, or explicit user action.

### 2026-06-12 Diverged local and remote `main`

What happened:
Local `main` had unpushed commits while remote `main` had newer commits; a push was rejected and a rebase exposed docs conflicts.

Impact:
Risk of pushing unrelated or stale local commits.

Root cause:
Local branch drifted from remote while separate changes landed upstream.

Recovery:
Cherry-picked the targeted flicker fix onto `origin/main`, then rebased and resolved the remaining local docs/auth commits. Local and remote were aligned at `a755fc9`, then later `9a32cb9`.

Rule added to prevent recurrence:
Before pushing, inspect `git status --short --branch` and `git log --left-right --cherry-pick --oneline origin/main...main`. If diverged, replay only the intended commits.

### Unknown date Coolify frontend duplicate-router failure

What happened:
Deployment docs record that when Coolify consistent container naming was disabled, multiple frontend containers could register the same Traefik router name with different configs.

Impact:
Traefik could reject both containers and return "no available server" for frontend requests.

Root cause:
Coolify default generated unique container names while Traefik router names conflicted across old/new containers.

Recovery:
Docs state `is_consistent_container_name_enabled=true` and `docker_images_to_keep=1` for the frontend application.

Rule added to prevent recurrence:
Do not disable consistent container naming for `compshop-frontend:main` without testing the Traefik router behavior.

### 2026-06-14 Production migration to new Coolify Supabase service

What happened:
The active production app was empty after moving domains because the new Supabase service did not yet contain all data and files from the old `compshop.designflow.app` stack.

Impact:
The live `comp.designflow.app` app could authenticate but did not show the expected trips/photos until the old database and storage were migrated.

Root cause:
The frontend/domain move happened before the new self-hosted Supabase service had a complete copy of the old stack's database rows and storage objects.

Recovery:
Migrated old stack data into `lc7f483hklyq89eej67idpbx`, preserved old rescue containers, patched Coolify service env for future redeploys, and audited row counts, primary keys, row checksums, `storage.objects`, physical object paths, object sizes, and signed fetches. Audit result: no missing primary keys, no missing public app data/storage metadata rows, and all 2,006 DB storage rows backed by raw or versioned files.

Rule added to prevent recurrence:
Before switching production domains or declaring a migration done, verify database row counts, primary-key presence, row checksums, storage metadata, physical storage files, and signed URL fetches from the public API.

### 2026-06-14 Fair stream v2 image remount flicker

What happened:
The experimental Fair Trips stream at `/china/:id/stream-v2` still blinked and delayed images during fast scrolling, especially on Windows Chrome.

Impact:
The section most important for Canton Fair browsing remained visually unreliable despite thumbnail caching.

Root cause:
Row/section virtualization kept unmounting and remounting image grids during native scroll, causing image decode/render churn that looked like cache misses.

Recovery:
Commit `4468b2a` removed scroll-driven row virtualization from the v2 page, kept grouped thumbnail grids mounted, and kept image `src` values stable while IndexedDB cache checks run.

Rule added to prevent recurrence:
For photo-heavy offline views, separate cache work from scroll rendering and avoid scroll listeners or virtualization that repeatedly remount loaded thumbnails unless browser performance has been tested on Windows Chrome.

## Pending work

| Status | Item | Owner/next action |
|---|---|---|
| open | Decide whether to update `capacitor.config.ts` away from the Lovable URL | Mobile owner should verify current mobile release behavior, change config only as part of an intentional app-store release, and update docs. |
| open | Verify rollback settings in Coolify after documentation cleanup | Check frontend image retention and Coolify rollback options before documenting a stronger rollback promise. |
| open | Offline/PWA roadmap items | See `docs/offline-pwa-plan.md`; upload auto-delete, upload-stage tracking, retry backoff, direct-upload routing, object URL cleanup, and Storage persistent-state UI are now partly/completely addressed. Remaining items include offline fallback route, camera-roll save/share flow, offline bundle state, offline edits, and field diagnostics. |
| done | Self-hosted migration | Completed before this audit; current deploy runs on Coolify/self-hosted Supabase. |
| done | Confirm frontend Coolify application UUID | Current frontend UUID is `frontend-uuid-comp-shop-prod-2026`. |
| done | `/china` image flicker/cache follow-up | Completed in commits `86528b6` and `9a32cb9`. |
| done | `/china/:id/stream-v2` Fair stream remount flicker follow-up | Completed in commit `4468b2a`. |
