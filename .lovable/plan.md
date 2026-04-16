

# Aggressive Offline-First: Cache Everything, Eliminate Round-Trips

## Problem
The app makes full network round-trips on every page load — trip lists, photo metadata, signed URLs, and cover images all reload from scratch. In China, each round-trip takes 200-500ms, making the app feel sluggish. The ChinaTrips page has zero caching.

## Strategy: Stale-While-Revalidate Everywhere

Show cached data instantly, then update silently in the background. Users see content in <50ms on repeat visits.

## Plan

### 1. Upgrade IndexedDB schema (offline-db.ts)
- Bump DB version to 2
- Add `china_trips` object store (mirrors `trips` store)
- Add `china_photos` object store with `by-trip` index
- Add `signed_urls` object store: `{ file_path, url, expires_at }` — cache signed URLs with their expiry timestamp
- Add helper functions: `cacheChinaTrips`, `getCachedChinaTrips`, `getCachedChinaTrip`, `cacheChinaPhotos`, `getCachedChinaPhotos`, `cacheSignedUrl`, `getCachedSignedUrl`

### 2. Extend signed URL TTL to 24 hours
- Change all `createSignedUrls(paths, 3600)` calls to `createSignedUrls(paths, 86400)` in `batchSignedUrls` (photo-utils.ts)
- Store generated URLs in the new `signed_urls` IndexedDB store with `expires_at = Date.now() + 86400000`
- Before calling Supabase, check if we have unexpired cached URLs — skip the API call entirely if all URLs are still valid

### 3. Add stale-while-revalidate to Trips.tsx
- Current: shows cached trips, then waits for network to replace them
- Change: show cached trips instantly and set `loading=false` immediately. Fire network refresh in background without blocking UI. Only update state if data actually changed.

### 4. Add full offline caching to ChinaTrips.tsx
- Mirror the pattern from Trips.tsx: load from `getCachedChinaTrips()` first, render immediately
- Background-fetch from Supabase, then `cacheChinaTrips()` on success
- When offline, skip network entirely

### 5. Cache signed URLs in ChinaTripDetail.tsx and TripDetail.tsx
- Before calling `batchSignedUrls`, check the `signed_urls` store for unexpired URLs
- Only request URLs for paths not already cached
- This eliminates the biggest per-page-load API call

### 6. Pre-cache cover images on trip list load
- When Trips.tsx or ChinaTrips.tsx fetches cover photos, immediately cache the blob via `cacheImageInBackground` so the `CachedImage` component finds them on next visit

### 7. Add a `lastSyncedAt` timestamp per store
- Store a simple `{ key: 'trips_last_sync', timestamp }` entry
- If last sync was <5 minutes ago AND we have cached data, skip the background refresh entirely (saves bandwidth in China)

## Files Changed
- `src/lib/offline-db.ts` — new stores, version bump, new helpers
- `src/lib/photo-utils.ts` — 24h TTL, signed URL caching layer
- `src/pages/Trips.tsx` — stale-while-revalidate, cover image pre-caching
- `src/pages/ChinaTrips.tsx` — full IndexedDB caching (currently zero)
- `src/pages/TripDetail.tsx` — signed URL cache lookup before API
- `src/pages/ChinaTripDetail.tsx` — signed URL cache lookup before API
- `src/components/CachedImage.tsx` — check signed URL cache as fallback

## Technical Notes
- DB version bump from 1→2 requires an `upgrade` handler that creates the new stores only if they don't exist
- Signed URL cache uses a simple expiry check: `if (entry && entry.expires_at > Date.now()) return entry.url`
- No changes to RLS, edge functions, or database schema

