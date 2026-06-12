# CompShop

Trade show buying trip photo management for POP Creations product sourcing trips. The team
photographs products at shows like Canton Fair and other China buying trips, and this app
organizes those photos into trips, supports bulk tagging, and is built offline-first to
work reliably in China where network conditions are poor.

## Tech stack

| Layer | Technology |
|-------|-----------|
| App | React + TypeScript + Vite |
| UI | shadcn/ui + Tailwind CSS |
| Backend | Self-hosted Supabase (Auth + Postgres + Storage + Edge Functions) |
| Gateway | Kong API gateway |
| Mobile | Capacitor (iOS/Android wrapper) |
| Offline | IndexedDB (stale-while-revalidate + signed URL caching) |

## Live deployment

| URL | Purpose |
|-----|---------|
| `https://comp.designflow.app` | Production frontend |
| `https://api.comp.designflow.app` | Kong API gateway (Supabase) |
| `https://db.comp.designflow.app` | Supabase Studio |
| `https://coolify.comp.designflow.app` | Coolify dashboard |

## Quick start

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill in the browser-safe Supabase values. To
develop against the self-hosted backend, set `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_PROJECT_ID` from
`selfhost/.env.frontend.example`.

## Key features

- **Trip management** — organize photos by buying trip (domestic and China trips tracked separately)
- **Canton Fair support** — `CantonFairGroupCard` groups products by exhibition booth/group
- **Bulk edit** — select and edit multiple photo records at once
- **Offline-first** — IndexedDB caching with stale-while-revalidate; signed URLs cached 24h
- **Durable upload queue** — photos/videos are saved to IndexedDB first, then synced with retry/backoff
- **Recycle bin** — soft-delete with recovery
- **Admin panel** — manage categories, countries, image types, retailers, invites

## Offline strategy

Critical for use in China where latency is 200–500ms per round-trip. The app:
- shows cached data instantly (IndexedDB) then rehydrates from Supabase in the background
- caches Supabase signed URLs for 24 hours to skip repeated signing calls
- skips background refresh if data was synced within the last 5 minutes
- pre-caches cover images when trip lists load

## Documentation

| Doc | Contents |
|-----|---------|
| [AGENTS.md](AGENTS.md) | Canonical AI/developer operating guide and documentation router |
| [docs/architecture.md](docs/architecture.md) | System design, components, data flow |
| [docs/development.md](docs/development.md) | Local setup, build, test, debug |
| [docs/configuration.md](docs/configuration.md) | Environment variables, config reference |
| [docs/deployment.md](docs/deployment.md) | Deploy workflow, Coolify, releases |
| [selfhost/](selfhost/) | Docker Compose stack, Dockerfiles, migration scripts |

Start with `AGENTS.md` for task-based guidance on which docs to load. Most tasks do not
require reading every Markdown file in the repository.
