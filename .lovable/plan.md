## Part 1: One-time data migration (4 trips → Factory Visits)

The 4 trips are sitting in `shopping_trips` (Store Shopping). They each have photos in the `photos` table:

- Annie-yusen (18 photos)
- Amy-Fengfan (37 photos)
- Wendy-Sunway (33 photos)
- Hidy (20 photos)

There are NO matching `factories` records yet, and only Sunway exists as a `china_trips` factory visit. Since `china_photos` and `photos` are separate tables (with different storage paths), a true migration requires:

1. **Create 4 `factories` records** — Annie (Yusen), Amy (Fengfan), Wendy (Sunway), Hidy. Contact name = first part, supplier/company = second part. The Wendy-Sunway one should link to existing "Sunway" factory if you confirm it's the same one (I'll ask).
2. **Create 4 `china_trips` records** with `venue_type='factory_visit'`, dated 2026-04-13 / 2026-04-15, `created_by` = Elise (the original uploader).
3. **Copy storage objects** in the `photos` bucket (the file paths are user-scoped, so they stay valid — we just re-reference them under new `china_photos` rows pointing to the new `china_trips.id`).
4. **Insert `china_photos` rows** carrying over all metadata (product_name, category, price, brand, dimensions, country_of_origin, material, notes, image_type, file_path, thumbnail_path, GPS, file_hash, group_id, section, created_at, user_id).
5. **Soft-delete the 4 `shopping_trips**` by setting `deleted_at = now()` (they go to the Recycle Bin for 30 days as a safety net before vanishing). Original `photos` rows stay attached to those soft-deleted trips so nothing is destroyed if we need to revert.

Reason for soft-delete instead of hard-delete: easy rollback. After you confirm the move looks correct in the Asia Trips section, the Recycle Bin auto-cleans them.

## Part 2: Per-section read-only role

Currently the role system has only `admin` and `user`. We'll extend it so an admin can mark any user as read-only for one of the two sections.

### New role model

Add two new values to the `app_role` enum:

- `store_readonly` — can view Store Shopping but cannot create/edit/delete trips, photos, or comments there. Full access to Asia Trips/Factory Visits.
- `china_readonly` — can view Asia Trips/Factory Visits but cannot create/edit/delete there. Full access to Store Shopping.

Users can hold either, both, or neither (additive on top of base `user`).

### Database changes

- Extend `app_role` enum with the two values.
- Add helper functions `is_store_readonly()` and `is_china_readonly()` mirroring `is_admin()`.
- Update RLS policies on `shopping_trips`, `photos`, `comments`, `photo_annotations`, `trip_members` to block INSERT/UPDATE/DELETE when `is_store_readonly()` is true (admins still bypass).
- Update RLS policies on `china_trips`, `china_photos`, `china_trip_members`, `factories` to block INSERT/UPDATE/DELETE when `is_china_readonly()` is true.

### UI changes

- **Profile → Admin panel**: new "User Permissions" card listing all users with two toggles each: "Read-only in Store Shopping" / "Read-only in Asia Trips". Saves to `user_roles`.
- **AuthContext**: expose `isStoreReadOnly` and `isChinaReadOnly` flags alongside `isAdmin`.
- **Hide write actions** (New Trip button, Edit, Delete, Upload, Comment box, Move/Reclassify dialogs, etc.) on the relevant section based on these flags.
- **Mode banner**: small "Read-only" badge in the header when viewing a section the user can't write to.

## Files changed

- New migration (enum extend + helper functions + updated RLS policies)
- `src/contexts/AuthContext.tsx` — add the two flags
- `src/components/admin/UserPermissionsManager.tsx` — new
- `src/pages/Profile.tsx` — mount the new admin panel
- Hide-action edits across: `Trips.tsx`, `TripDetail.tsx`, `ChinaTrips.tsx`, `ChinaTripDetail.tsx`, `Factories.tsx`, `FactoryDetail.tsx`, `PhotoCard.tsx`, `PhotoComments.tsx`, `AppShell.tsx` (header badge)

## One question before I start

**Wendy-Sunway** — is this the same "Sunway" factory you already have in Asia Trips (id `09357a16…`), or a different supplier with a coincidental name? Three options:

1. Link to existing **Sunway** record
2. Link to existing **Xianju Sunway** record
3. Create a brand-new factory record for Wendy-Sunway

-all factories that have the word sunway in them are the same factory and should be merged and use Sunway