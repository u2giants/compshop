# Development

## Prerequisites

- Node.js 20+ (the Docker build uses `node:20-alpine`)
- npm (or bun — the Dockerfile uses bun if `bun.lockb` is present)

## Local setup

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
```

The root `.env` points to the Lovable Cloud Supabase project and works out of the box for
local development. Auth, database, storage, and edge functions are all live on that project.

To develop against the self-hosted backend instead:

```bash
# .env.local (not committed)
VITE_SUPABASE_URL=https://api.comp.designflow.app
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key from Coolify>
VITE_SUPABASE_PROJECT_ID=selfhosted
```

`ADDITIONAL_REDIRECT_URLS` in the Supabase auth settings includes `http://localhost:5173`
so OAuth callbacks work locally against both backends.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build → `dist/` |
| `npm run build:dev` | Dev-mode build (source maps, no minification) |
| `npm run preview` | Serve the last `dist/` locally |
| `npm run lint` | ESLint |
| `npm run test` | Vitest (run once) |
| `npm run test:watch` | Vitest watch mode |

## Project structure

```
src/
├── components/
│   ├── admin/          # Admin panel managers (categories, users, invites, etc.)
│   ├── layout/         # AppShell, SearchOverlay
│   ├── settings/       # BulkCacheManager, StorageQuotaManager
│   ├── trip/           # Trip/photo UI (cards, dialogs, bulk edit, recycle bin)
│   └── ui/             # 84 shadcn/ui primitives — do not edit directly
├── contexts/           # AppModeContext (china/domestic mode), AuthContext
├── hooks/              # Custom hooks (categories, countries, retailers, online status, etc.)
├── integrations/
│   └── supabase/       # client.ts (Supabase JS client), types.ts (generated DB types)
├── lib/                # Utilities: offline-db, sync-service, photo-utils, canton-fair-utils, etc.
├── pages/              # 16 route-level page components
└── types/              # Shared TypeScript types
```

## Supabase client

`src/integrations/supabase/client.ts` initialises the Supabase JS client from
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The key is the anon (public)
key — it is intentionally visible in the browser bundle. Row-Level Security on the
database enforces actual access control.

`VITE_SUPABASE_PROJECT_ID` is used only for constructing storage URLs. Set it to
`selfhosted` when using the self-hosted backend (the value is not validated).

## Offline / IndexedDB

`src/lib/offline-db.ts` manages a versioned IndexedDB schema (v2). Stores:
`trips`, `photos`, `china_trips`, `china_photos`, `signed_urls`, `sync_meta`,
`image_blobs`, `pending_uploads`.

The stale-while-revalidate pattern: pages read from IndexedDB first (zero latency), then
fetch from Supabase and update the store. A `sync_meta` entry per resource prevents
redundant refreshes within 5 minutes.

Signed URLs are cached per photo ID with a 24-hour TTL. The `CachedImage` component reads
from this cache before calling the Storage API.

## Edge functions

Functions live in `supabase/functions/` and run on the Deno edge runtime. They are
deployed to the self-hosted Supabase via Coolify's functions deploy mechanism (not via
`supabase deploy`). The `supabase/config.toml` still references the Lovable Cloud
`project_id` — this file is used by the Supabase CLI for local development only and does
not affect the self-hosted deployment.

To test a function locally:
```bash
supabase functions serve <function-name>
```
This requires the Supabase CLI and uses the Lovable Cloud project for auth context.

## Mobile (Capacitor)

`capacitor.config.ts` wraps the Vite app for iOS/Android. Run `npm run build` first, then
use the Capacitor CLI to sync and run on a device. The server URL in the Capacitor config
should point to the production frontend for release builds.

## Debugging

**Blank screen after login** — check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
are set and correct. The app fails silently if the Supabase client cannot initialise.

**OAuth redirect errors** — the redirect URI must exactly match one of:
- `https://comp.designflow.app` (production)
- `https://comp-staging.designflow.app` (staging)
- `http://localhost:5173` (local dev)

All three are listed in `ADDITIONAL_REDIRECT_URLS` in Coolify.

**Kong "name resolution failed"** — means `KONG_DNS_RESOLVER` is missing or
`KONG_DNS_ORDER` is wrong in the Supabase Coolify deployment. See
[docs/architecture.md](architecture.md#kong-intentional-configuration-quirks).

**Signed URL 403s** — Storage bucket RLS or the CORS policy on the storage service is
blocking. Check that the Supabase anon key is the one matching the self-hosted JWT secret,
not the old Lovable Cloud key.
