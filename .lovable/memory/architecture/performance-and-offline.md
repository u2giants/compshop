---
name: Performance and offline
description: The application is optimized for high-performance data loading and offline resilience with aggressive SWR caching
type: feature
---
## Signed URL Caching
- All signed URLs use 24-hour TTL (86400s) instead of 1 hour
- Signed URLs are cached in IndexedDB `signed_urls` store with expiry timestamps
- `batchSignedUrls()` checks cache first, only requests uncached/expired paths from Supabase
- `CachedImage` component checks signed URL cache as fallback when no prop URL provided

## Stale-While-Revalidate (SWR)
- Trip list pages (Trips.tsx, ChinaTrips.tsx) show cached data instantly, then refresh in background
- `sync_meta` store tracks last sync timestamp per data type
- If synced <5 minutes ago AND cache exists, background refresh is skipped entirely
- Cover image blobs are pre-cached during list loads for instant display on next visit

## IndexedDB Schema (v2)
- `trips` — shopping trip metadata
- `photos` — shopping trip photos (indexed by trip_id)
- `china_trips` — Asia trip metadata (added in v2)
- `china_photos` — Asia trip photos with by-trip index (added in v2)
- `signed_urls` — cached signed URLs with expiry (added in v2)
- `sync_meta` — last sync timestamps per store (added in v2)
- `image_blobs` — cached image blobs with quota enforcement
- `pending_uploads` — offline upload queue

## Detail Pages
- TripDetail and ChinaTripDetail use proper type-specific cache stores
- ChinaTripDetail uses `getCachedChinaTrip`, `getCachedChinaPhotos`, `cacheChinaPhotos`
- Photos cached without signed_url (they expire); blob cache used for offline display

## Photo Loading
- `batchSignedUrls` generates URLs in a single batch API call with signed URL cache layer
- WebP thumbnails generated on upload for faster list rendering
- Background blob caching on every photo load for offline resilience
