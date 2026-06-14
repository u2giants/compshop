# Development

## Prerequisites

- Node.js 20+ (the Docker build uses `node:20-alpine`; `npm ci` on Node 18 currently emits engine warnings for Supabase/Capacitor-related packages)
- npm (or bun — the Dockerfile uses bun if `bun.lockb` is present)

## Local setup

```bash
npm install
npm run dev        # Vite dev server at http://localhost:8080
```

Copy `.env.example` to `.env.local` and fill in browser-safe Supabase values. The repo
does not commit a root `.env`.

To develop against the self-hosted backend instead:

```bash
# .env.local (not committed)
VITE_SUPABASE_URL=https://api.comp.designflow.app
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key from Coolify>
VITE_SUPABASE_PROJECT_ID=selfhosted
```

`ADDITIONAL_REDIRECT_URLS` in the Supabase auth settings must include
`http://localhost:8080` so OAuth callbacks work locally against the self-hosted backend.

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

`src/lib/offline-db.ts` manages a versioned IndexedDB schema (v3). Stores:
`trips`, `photos`, `china_trips`, `china_photos`, `signed_urls`, `sync_meta`,
`image_blobs`, `pending_uploads`, `pending_trips`, `pending_china_trips`.

`startSyncService()` from `src/lib/sync-service.ts` is called unconditionally at app startup (`src/main.tsx`) — it sets up queued upload retries before the React tree mounts.

Photo/video capture paths should enqueue files with `src/lib/pending-upload-utils.ts`
instead of uploading directly from page components. Pending upload records store the
original Blob, stable Storage path, file hash, upload stage, retry count, last error, and
`next_retry_at`. `failed_needs_attention` means the local file is preserved and needs user
or operator action; do not auto-delete it as retry cleanup.

The stale-while-revalidate pattern: pages read from IndexedDB first (zero latency), then
fetch from Supabase and update the store. A `sync_meta` entry per resource prevents
redundant refreshes. The current trip-list pages use a short refresh window for near
real-time collaboration; verify the exact interval in the affected page before changing
cache behavior.

Signed URLs are cached per file path with a 24-hour TTL. The `CachedImage` component reads
from this cache before calling the Storage API. `StorageQuotaManager` clears only cached
image blobs and can request persistent browser storage; it must not clear pending uploads.

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
use the Capacitor CLI to sync and run on a device.

**Known state:** `capacitor.config.ts` currently points `server.url` to the Lovable Cloud project URL (`6054c773-88f0-46d6-aed8-439b0531b157.lovableproject.com`). This was left from the Lovable Cloud era and has not been updated to `https://comp.designflow.app`. Mobile builds using the current config will connect to Lovable Cloud, not the self-hosted backend.

## Debugging

**Blank screen after login** — check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
are set and correct. The app fails silently if the Supabase client cannot initialise.

**OAuth redirect errors** — the redirect URI must exactly match one of:
- `https://comp.designflow.app` (production)
- `https://compshop.designflow.app` (alternate production domain)
- `https://comp-staging.designflow.app` (staging)
- `http://localhost:8080` (local dev)

All three are listed in `ADDITIONAL_REDIRECT_URLS` in Coolify.

**Kong "name resolution failed"** — means `KONG_DNS_RESOLVER` is missing or
`KONG_DNS_ORDER` is wrong in the Supabase Coolify deployment. See
[docs/architecture.md](architecture.md#kong-intentional-configuration-quirks).

**Signed URL 403s** — Storage bucket RLS or the CORS policy on the storage service is
blocking. Check that the Supabase anon key is the one matching the self-hosted JWT secret,
not the old Lovable Cloud key.
