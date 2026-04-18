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
| Backend | Supabase (Auth + Postgres + Storage) |
| Mobile | Capacitor (iOS/Android wrapper) |
| Offline | IndexedDB (stale-while-revalidate + signed URL caching) |

## Quick start

```bash
npm install
npm run dev
```

Requires Supabase environment variables. Copy `.env.example` to `.env.local` and fill in
the Supabase URL and anon key.

## Key features

- **Trip management** — organize photos by buying trip (domestic and China trips tracked separately)
- **Canton Fair support** — `CantonFairGroupCard` groups products by exhibition booth/group
- **Bulk edit** — select and edit multiple photo records at once
- **Offline-first** — IndexedDB caching with stale-while-revalidate; signed URLs cached for 24h
- **Recycle bin** — soft-delete with recovery
- **Admin panel** — manage categories, countries, image types, retailers, invites

## Offline strategy

Critical for use in China where latency is 200–500ms per round-trip. The app:
- shows cached data instantly (IndexedDB) then rehydrates from Supabase in the background
- caches Supabase signed URLs for 24 hours to skip repeated signing calls
- skips background refresh if data was synced within the last 5 minutes
- pre-caches cover images when trip lists load

See `.lovable/memory/architecture/performance-and-offline.md` for technical details.

## Deployment

Single-branch workflow. Push to `main` → GitHub Actions builds and triggers Coolify deployment.

AI operating rules (branch policy, secrets, deployment path): [docs/ai-operating-rules.md](docs/ai-operating-rules.md)
