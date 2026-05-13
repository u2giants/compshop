# Offline-First PWA: Current State + Execution Plan

This document is the corrected, file-referenced version of the original 11-phase
offline-PWA plan. It exists because the original plan, while architecturally
sound, was written without inspecting the repo and therefore both **claims to
need work that's already done** and **misses some real production risks**.

Use this doc — not the original 11-phase plan — as the source of truth when
handing work to an AI coding assistant.

## TL;DR

1. The local-first capture and sync architecture **already exists** and is more
   thoughtful than the original plan implies. The biggest single bug is the
   auto-delete of pending uploads after 5 failed retries — fix that first
   (`src/lib/sync-service.ts:122–128`).
2. The genuine gaps are: no `navigator.storage.persist()`, no offline fallback
   route, no Web Share API ("Save to Photos"), no exponential backoff, no
   upload-stage tracking, no first-class "downloaded this trip for offline" state,
   no offline edits to already-synced rows.
3. The original plan misses: HEIC handling on iPhone, Supabase session expiry on
   multi-day offline trips, service-worker update behavior mid-trip, resumable
   uploads on weak networks, IndexedDB eviction risk on iOS Safari, and the
   strategic Camera-Roll-vs-Capacitor fork.
4. Execution should be reordered. Do the small high-stakes fixes first, then the
   PWA shell, then the storage and capture polish. Defer Phases 3/8 of the
   original plan until field data justifies them.

---

## Part 1 — What already exists (do not rewrite)

### PWA scaffolding
- `vite-plugin-pwa@^1.2.0` is configured in `vite.config.ts` with
  `registerType: "autoUpdate"`, manifest, icons, and Workbox `globPatterns:
  ["**/*.{js,css,html,ico,png,svg,woff2}"]`. Lazy route chunks (`src/App.tsx:12–27`)
  are emitted as JS and are therefore included by that glob.
- The manifest is correctly scoped (`scope: "/"`, `start_url: "/"`,
  `display: "standalone"`).

### Offline DB
- `src/lib/offline-db.ts` (420 lines) defines an IndexedDB schema at version 3
  with stores: `trips`, `photos`, `image_blobs`, `pending_uploads`, `china_trips`,
  `china_photos`, `signed_urls`, `sync_meta`, `pending_trips`,
  `pending_china_trips`.
- `pending_uploads` already stores the original `Blob` (`file_blob: Blob`), the
  full metadata object, retry count, and a `status` field
  (`pending | uploading | failed`).
- Quota enforcement (`enforceStorageQuota`, line 344) deletes oldest cached
  image blobs only — it does **not** touch `pending_uploads`. Pending uploads
  are already protected from auto-eviction.

### Camera capture
- Separate `Take Photo` and `Upload/Bulk Upload` buttons already exist in
  `src/pages/TripDetail.tsx:844–862` (with a `cameraInputRef` using
  `capture="environment"` at line 842 and a separate gallery input at line 840).
  Equivalent buttons exist in `ChinaTripDetail.tsx:944–948` and
  `FactoryDetail.tsx:263–267`.
- `PhotoCard.tsx:512–514` also exposes per-card camera capture.

### Local-first capture flow (this is the big one)
- `handleBulkUpload` in `TripDetail.tsx:562–595` **already** does the
  "store-locally-then-sync" pattern:
  1. Hash the file.
  2. Check for a duplicate via `checkDuplicatePhoto(fileHash)`.
  3. Extract EXIF for GPS.
  4. Call `addPendingUpload({...file_blob, status: "pending"})`.
  5. Reload the photo grid and pending grid.
  6. Trigger `runSync()`.
- Photos appear in the UI from the local Blob via `URL.createObjectURL` at line
  1047, so they render instantly even with no network.

### Sync service
- `src/lib/sync-service.ts` (180 lines) is more sophisticated than the original
  plan implies:
  - `runSync` skips concurrent runs via the `syncing` flag.
  - File-hash deduplication runs again at upload time (lines 44–48).
  - Successful syncs remove the pending row.
  - There is iOS-aware re-sync: a `visibilitychange` listener triggers
    `runSync()` when the PWA returns to foreground because
    `navigator.onLine` is unreliable on iOS (line 168). The `online` event is
    also wired but treated as best-effort.
  - A 30-second polling interval runs without consulting `navigator.onLine`,
    again because that flag lies on iOS (line 175).
  - `resetStuckUploads` (line 146) repairs uploads stuck in `uploading` after
    a tab crash or close.
- Upload timeout: `uploadPhoto` in `src/lib/supabase-helpers.ts:58–60` already
  races against a **90-second timeout** so a hung upload doesn't block the queue.

### Status UI
- `src/components/SyncStatusIndicator.tsx` (59 lines) already shows
  `Offline · N pending`, `Syncing...`, and `Sync error · N pending`.
- It is mounted in `AppShell.tsx:115` and again at `:152` (mobile vs desktop).
- An `online/offline` hook exists at `src/hooks/use-online-status.ts:4–5`.

### Storage dashboard
- `src/components/settings/StorageQuotaManager.tsx` already calls
  `navigator.storage.estimate()` (line 38) and shows live usage. A configurable
  quota cap (`getStorageQuotaMB`) is read from this component.

### Bulk caching ("download trip for offline" precursor)
- `src/lib/bulk-cache.ts` (172 lines) already has:
  - `cachePhotoImages` — concurrency-4 worker pool fetching image blobs and
    saving to `image_blobs`.
  - `cacheTripPhotos`, `cacheChinaTripPhotos`, `cacheRecentPhotos`.
- What's missing is a **first-class status per trip** (downloaded / partial /
  stale / failed) and clearer UI; the underlying caching is done.

### Read paths that are already cache-first
- `TripDetail.tsx:348` and `ChinaTripDetail.tsx:366` already early-return from
  the network fetch when offline. The pages render from IndexedDB.

---

## Part 2 — Real gaps (build these)

### G1. Auto-delete of failed uploads after 5 retries
`src/lib/sync-service.ts:122–128` does:
```ts
const abandoned = pending.filter((u) => u.retry_count >= 5);
for (const u of abandoned) {
  await removePendingUpload(u.id);
}
```
On a weak network in China, a single photo can plausibly hit 5 transient
failures and then be silently deleted from the device. **This is the highest-risk
bug in the codebase for the offline use case.** Replace with a
`failed_needs_attention` status that requires user action.

### G2. No `navigator.storage.persist()`
`StorageQuotaManager.tsx` calls `.estimate()` but never requests persistent
storage. On iOS Safari this is the single biggest mitigation against eviction.
Add a "Request persistent storage" button and call it on first launch.

### G3. No offline fallback route
There is no `Offline.tsx` page wired to Workbox's `navigateFallback`. If the
service worker fails to find a cached response for a navigation request, the
user sees a browser error instead of a branded "you're offline" page.

### G4. No Web Share API "Save to Photos"
`navigator.share` is not called anywhere in `src/`. The captured Blob lives only
in IndexedDB. Add a `Save to Photos` button on the post-capture modal that calls
`navigator.canShare({ files: [file] })` then `navigator.share({ files: [file] })`.
This is best-effort — see Part 4 on the Capacitor question.

### G5. No exponential backoff
The 30s poll re-tries everything every 30s. A photo failing in a captive WiFi
loop will burn CPU and battery. Add `next_retry_at` per upload with backoff
30s → 2m → 5m → 15m → 1h.

### G6. No upload-stage tracking
The current `status` field is `pending | uploading | failed`. When debugging a
failure at a trade show, you want to know: did the storage upload succeed and
only the DB insert fail? Add `upload_stage: local_saved | hashing |
uploading_storage | inserting_db_row | done | failed`.

### G7. No first-class "downloaded this trip for offline" state
`cacheTripPhotos` works but there's no `offline_bundles` table storing
`{trip_id, status, cached_at, photo_count_cached, photo_count_expected,
failed_count}`. Without it, the UI can't show a per-trip "Downloaded ✓ /
Needs Refresh / Failed" badge. Add an `offline_bundles` store; expose
`Download Offline` / `Refresh Offline Copy` / `Remove Offline Copy` per trip.

### G8. No offline edits to already-synced rows
You can capture and queue new photos offline, but editing the metadata of a
photo that's already on the server while offline silently fails. Add a
`pending_mutations` store keyed by `{table, row_id, operation, payload}` and a
sync loop that replays them.

### G9. AI buttons don't disable when offline
`TripDetail.tsx` already imports `useOnlineStatus` but the AI Detect button
isn't gated on it. Disable AI buttons offline with a tooltip explaining why.

---

## Part 3 — Risks the original plan missed

### R1. HEIC on iPhone
iPhones shoot HEIC by default. Open questions, all worth verifying before any
field deployment:
- Does the `photos`/`china_photos` storage bucket accept HEIC?
- Does the `analyze-photo` edge function accept HEIC, or does it expect JPEG?
- Do `thumbnail-utils.ts` and `image-utils.ts` decode HEIC in the browser? They
  probably don't — `canvas.toBlob()` and most browser image decoding does not
  handle HEIC reliably outside Safari.
- If the answer to any of the above is "no," you need a HEIC→JPEG conversion
  step (e.g. `heic2any`) somewhere in the capture pipeline.

Recommendation: add a conversion step inside `handleBulkUpload` so the Blob
stored in `pending_uploads` is already in a portable format. Doing it on capture
is cheaper than doing it on sync (the device is already awake; there's no
network involved).

### R2. Supabase session expiry on multi-day offline trips
Supabase access tokens expire after 1 hour by default. The Supabase JS client
auto-refreshes using the refresh token, but only when online. An employee at a
2-day Canton Fair could be offline long enough that **both** tokens expire,
which kills sync until they sign in again.

Mitigations:
- Refresh proactively before going offline (e.g. when the user taps
  "Download for Offline").
- Detect 401s in `syncOne` and emit a clear "Sign in needed to sync" state
  rather than treating it as a transient failure that increments retry_count.
- Consider extending refresh-token lifetime in Supabase Auth settings (project
  `ryltkzzernhwnojzouyb` — but **verify in dashboard** before changing).

### R3. Service worker update behavior mid-trip
`registerType: "autoUpdate"` (vite.config.ts:18) means a new SW installs and
activates as soon as it's fetched, on the next page load. If a deploy happens
mid-trip and the device is online for 10 seconds, the new SW replaces the old
one. If asset hashes changed and the old assets are no longer on the CDN, an
employee can end up with a half-cached shell.

Recommendation: switch to `registerType: "prompt"` with a user-visible
"Update available — restart app to apply" toast. Or at minimum, ensure the
deployment pipeline retains old asset hashes for at least 30 days.

### R4. Resumable uploads
Supabase Storage supports TUS resumable uploads for files >6MB. HEICs and
high-quality photos can be 4–8MB. On weak LTE, a single failure at 80% wastes
bandwidth and time. Worth using `@supabase/storage-js` resumable mode for files
above some threshold.

### R5. IndexedDB eviction on iOS Safari
iOS Safari aggressively evicts IndexedDB after roughly 7 days of no use to the
origin. `navigator.storage.persist()` (G2) helps but iOS does not always honor
it the same way Chrome does. Mitigations:
- Tell employees to open the app at least weekly even when not on a trip.
- Surface a clear warning in `StorageQuotaManager` when persistent storage was
  requested but **denied**.
- Track `last_opened_at` and warn the user if it's been >5 days.

### R6. Background Sync API (Android only)
The `SyncManager` Background Sync API lets a service worker retry failed
uploads after the PWA is closed. iOS Safari does not support it. Android Chrome
does. Worth registering as a progressive enhancement — Android employees get
better reliability for free.

### R7. Concurrent upload limit on reconnect
`runSync` processes pending uploads sequentially (a `for` loop at line 135),
which is actually correct for weak networks. Don't change this to parallel.
Note this so it doesn't get "improved" by accident.

### R8. Observability when things break in the field
When a photo fails to upload at a Canton Fair booth, what does the on-site
employee see, and what can you (Albert) see remotely? Today: the local error
message, and nothing on the server. Consider:
- An `upload_errors` table that the sync service writes to (last 50 errors per
  user, with stage, error code, file size, mime type).
- A "Send Diagnostic Report" button that bundles pending_uploads metadata
  (without the blobs) and uploads it for review.

---

## Part 4 — The strategic fork: PWA vs Capacitor

The original plan acknowledges in passing that "guaranteed Camera Roll saving
becomes non-negotiable, that is when Capacitor becomes worth revisiting." But
it doesn't make you decide.

**Decide now.** The right framing:

If your business answer to **"what happens when an employee comes back from
China and their iPhone got reset / the app got uninstalled / IndexedDB got
evicted, and the only copy of their booth photos was in CompShop?"** is "that's
unacceptable" — then PWA is the wrong long-term tool and Capacitor is worth
the 2–4 week investment. The Web Share API approach in G4 is best-effort and
cannot be made reliable.

If the business answer is "we can train employees to back up via Files /
AirDrop / leave the app open," then the PWA approach is fine and this plan is
what you want.

My read on POP Creations' use case (employees in stores, trade shows, China
factories where lost photos = lost work) is that the data-safety bar is high
enough that **Capacitor is probably the right destination eventually**. The
work in this plan is still valuable as a stopgap and as the foundation Capacitor
would build on (the offline-first IndexedDB pattern is identical), so it's not
wasted effort. But name the decision so you're not surprised in 6 months.

---

## Part 5 — Reordered execution plan

Do not run the original 11 phases in order. Use this sequence:

### Sprint 1: high-stakes one-liners (half a day)
1. **Remove auto-delete of failed uploads.** (G1) Replace the `>= 5` cleanup
   with status `failed_needs_attention` and surface in
   `SyncStatusIndicator`/`PendingUploadsPanel`.
2. **Call `navigator.storage.persist()`** on first authenticated launch. (G2)
3. **Disable AI buttons when `!online`** with tooltip. (G9)

### Sprint 2: PWA shell + capture polish (1–2 days)
4. **Add `src/pages/Offline.tsx`** and wire it into Workbox `navigateFallback`.
   Add a small `src/components/pwa/InstallInstructions.tsx` shown to first-time
   users. (Phase 1 of original plan)
5. **Verify lazy chunks are precached.** Build, inspect `dist/sw.js` for the
   precache manifest, confirm all `assets/*.js` route chunks are listed.
6. **Add `local_created_at`, `local_file_size`, `local_mime_type`,
   `last_attempt_at`, `last_error_message`, `next_retry_at`,
   `camera_roll_save_status`, `upload_stage` to `PendingUpload`.** Bump DB to
   version 4. (G5, G6)
7. **Exponential backoff in `runSync`.** Skip uploads whose `next_retry_at` is
   in the future. (G5)
8. **HEIC conversion in `handleBulkUpload`** if the answers to R1 require it.
   Verify first.

### Sprint 3: save-to-photos + storage UX (1 day)
9. **Add `src/lib/save-to-camera-roll.ts`** with `canShareImageFile`,
   `shareImageForSaving`, `downloadFile` fallback. (G4)
10. **Add post-capture "Save to Photos / Skip" modal.** Set
    `camera_roll_save_status` after share-sheet returns.
11. **Extend `StorageQuotaManager`** to show pending count, failed count,
    persistent-storage state (granted/denied/unknown), and a "Clear cached
    images only" button that skips pending_uploads.

### Sprint 4: offline bundles + session handling (2 days)
12. **`offline_bundles` store** with the schema in G7. Bump DB to 5.
13. **Rename "Cache" to "Download Offline" in `Trips.tsx`** and show per-trip
    badge from `offline_bundles`. Add Refresh and Remove actions.
14. **Proactive session refresh** when user taps Download Offline. Detect 401s
    in sync. (R2)

### Sprint 5: defer until field data justifies (don't do yet)
- Phase 8 of original: `pending_mutations` for offline edits to synced rows
  (G8). Real but lower priority than data capture.
- Background Sync API (R6).
- Resumable uploads (R4).
- Service worker update strategy change (R3) — decide after the first
  multi-day field test.

### Across all sprints
- **Add a manual QA checklist** at `docs/offline-pwa-qa.md` covering iPhone
  Safari PWA, Android Chrome PWA, airplane-mode, weak-LTE, app-kill,
  phone-reboot, and duplicate-upload scenarios.
- **Test on real devices.** Specifically test HEIC capture on an iPhone
  running iOS 17+, since simulators don't reproduce HEIC behavior.
- Build with `npm run build` is **table stakes, not an acceptance criterion**.
  Acceptance is on-device behavior.

---

## Part 6 — The prompt to paste into Claude Code

You are working on the GitHub repo `u2giants/Compshop`. **Read
`docs/offline-pwa-plan.md` in full before starting.** That document is the
authoritative spec; it inventories what already exists, names the real gaps,
and reorders execution.

Do not rewrite features that already exist. In particular:
- The split between `Take Photo` (`capture="environment"`) and bulk upload
  inputs already exists in `TripDetail.tsx`, `ChinaTripDetail.tsx`,
  `FactoryDetail.tsx`, and `PhotoCard.tsx`. Do not create new inputs.
- The local-first capture flow already calls `addPendingUpload` before any
  network attempt in `TripDetail.tsx:handleBulkUpload`. Do not reimplement it;
  extend it.
- File-hash deduplication via `hashFile`/`checkDuplicatePhoto` already runs in
  both capture and sync paths.
- 90-second upload timeout already exists in `supabase-helpers.ts:uploadPhoto`.
- `SyncStatusIndicator.tsx` already shows online/offline/syncing/error with
  pending count and is mounted in `AppShell.tsx`.
- `StorageQuotaManager.tsx` already calls `navigator.storage.estimate()`.
- `bulk-cache.ts` already has the per-trip image caching primitives.

**Execute Sprint 1 first** (auto-delete fix, `storage.persist()`, AI-button
gating) and stop. Open a PR. Get manual QA on a real iPhone Safari PWA in
airplane mode. Only proceed to Sprint 2 after Sprint 1 is verified working
on-device. Do not bundle multiple sprints into one PR.

Each PR must include:
- A short description of which sprint items it implements (referencing the IDs
  G1, G2, R1, etc. from `docs/offline-pwa-plan.md`).
- A note about anything in the sprint scope that was **not** done and why.
- Updated `docs/offline-pwa-qa.md` reflecting any new manual test steps.

Do not change the service worker update strategy (`registerType: "autoUpdate"`)
without first opening an issue for discussion — see R3.

Do not change the sequential upload loop in `runSync` to parallel — see R7.

When uncertain about HEIC behavior (R1), pause and ask before committing a
conversion library choice; the answer affects bundle size meaningfully.
