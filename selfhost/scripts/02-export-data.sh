#!/usr/bin/env bash
# ============================================================================
# 02-export-data.sh
# Dumps row data from Lovable Cloud's Postgres into a single SQL file
# that can be replayed against the new self-hosted Postgres.
# Requires: pg_dump (install: apt install postgresql-client).
# Reads connection info from .env (LOVABLE_PG_*).
# ============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-./.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${LOVABLE_PG_HOST:?LOVABLE_PG_HOST not set}"
: "${LOVABLE_PG_PASSWORD:?LOVABLE_PG_PASSWORD not set}"
: "${LOVABLE_PG_USER:?LOVABLE_PG_USER not set}"

OUT_DIR="${OUT_DIR:-./migration-export}"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/01_data.sql"

# Tables in dependency-safe order (parents first).
TABLES=(
  countries
  categories
  image_types
  retailers
  factories
  profiles
  user_roles
  invitations
  shopping_trips
  trip_members
  photos
  comments
  photo_annotations
  china_trips
  china_trip_members
  china_photos
)

INCLUDE_FLAGS=""
for t in "${TABLES[@]}"; do
  INCLUDE_FLAGS+=" -t public.$t"
done

echo "📦 Dumping ${#TABLES[@]} tables from $LOVABLE_PG_HOST → $OUT_FILE"

PGPASSWORD="$LOVABLE_PG_PASSWORD" pg_dump \
  -h "$LOVABLE_PG_HOST" \
  -p "${LOVABLE_PG_PORT:-6543}" \
  -U "$LOVABLE_PG_USER" \
  -d "${LOVABLE_PG_DB:-postgres}" \
  --data-only \
  --no-owner \
  --no-privileges \
  --disable-triggers \
  --column-inserts \
  $INCLUDE_FLAGS \
  > "$OUT_FILE"

LINES=$(wc -l < "$OUT_FILE")
echo "✅ Wrote $OUT_FILE ($LINES lines)"

# Quick row-count summary so the user can verify on the new side.
echo ""
echo "Row counts in source:"
for t in "${TABLES[@]}"; do
  C=$(PGPASSWORD="$LOVABLE_PG_PASSWORD" psql -h "$LOVABLE_PG_HOST" -p "${LOVABLE_PG_PORT:-6543}" \
        -U "$LOVABLE_PG_USER" -d "${LOVABLE_PG_DB:-postgres}" -tAc "SELECT count(*) FROM public.$t" 2>/dev/null || echo "?")
  printf "  %-22s %s\n" "$t" "$C"
done
