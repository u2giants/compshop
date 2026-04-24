#!/usr/bin/env bash
# ============================================================================
# 05-import-all.sh
# Replays schema → auth → data → storage onto your NEW self-hosted Supabase.
# Run from a machine that can reach the new Postgres (typically the VPS itself
# via `docker exec`, or any machine with psql + the new DB hostname).
# ============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-./.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

# Connection to the NEW self-hosted DB.
NEW_HOST="${NEW_PG_HOST:-localhost}"
NEW_PORT="${NEW_PG_PORT:-5432}"
NEW_USER="${NEW_PG_USER:-postgres}"
NEW_DB="${NEW_PG_DB:-postgres}"
: "${NEW_PG_PASSWORD:?NEW_PG_PASSWORD not set (use the POSTGRES_PASSWORD value)}"

OUT_DIR="${OUT_DIR:-./migration-export}"

run_psql() {
  PGPASSWORD="$NEW_PG_PASSWORD" psql -h "$NEW_HOST" -p "$NEW_PORT" -U "$NEW_USER" -d "$NEW_DB" -v ON_ERROR_STOP=1 "$@"
}

echo "1️⃣  Apply schema (migrations)…"
run_psql -f "$OUT_DIR/00_schema_bootstrap.sql"

echo ""
echo "2️⃣  Import auth.users + auth.identities…"
# Truncate first to avoid PK collisions if re-running.
run_psql -c "TRUNCATE auth.identities, auth.users CASCADE;"
run_psql -f "$OUT_DIR/02_auth.sql"

echo ""
echo "3️⃣  Import table data…"
# public schema tables; profiles row is auto-created by handle_new_user() trigger
# when auth.users was inserted, so wipe profiles first to avoid duplicates.
run_psql -c "TRUNCATE public.china_photos, public.china_trip_members, public.china_trips,
                      public.photo_annotations, public.comments, public.photos,
                      public.trip_members, public.shopping_trips,
                      public.invitations, public.user_roles, public.profiles,
                      public.factories, public.retailers,
                      public.image_types, public.categories, public.countries CASCADE;"
run_psql -f "$OUT_DIR/01_data.sql"

echo ""
echo "4️⃣  Upload storage files…"
# Storage in self-hosted backend = local files. Just copy into the storage volume.
# This script assumes you mounted the storage volume to /var/lib/storage on the host
# OR that you copy via `docker cp` (printed below).
if [ -d "$OUT_DIR/storage" ]; then
  echo "    Copy command (run on the VPS):"
  echo "      docker cp $OUT_DIR/storage/. \$(docker ps -qf name=storage):/var/lib/storage/"
  echo ""
  echo "    Then rebuild Storage's metadata so the new files show up:"
  echo "      curl -X POST \\"
  echo "        -H \"apikey: \$SERVICE_ROLE_KEY\" \\"
  echo "        -H \"Authorization: Bearer \$SERVICE_ROLE_KEY\" \\"
  echo "        https://api.comp.designflow.app/storage/v1/admin/migrate"
fi

echo ""
echo "✅ Import complete. Verify with:"
echo "   psql … -c \"SELECT 'photos', count(*) FROM photos UNION ALL SELECT 'china_photos', count(*) FROM china_photos UNION ALL SELECT 'shopping_trips', count(*) FROM shopping_trips;\""
