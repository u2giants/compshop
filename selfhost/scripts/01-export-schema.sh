#!/usr/bin/env bash
# ============================================================================
# 01-export-schema.sh
# Bundles all the Lovable Cloud Postgres migrations into one bootstrap SQL.
# Run on your laptop / VPS after cloning this repo.
# ============================================================================
set -euo pipefail

OUT_DIR="${OUT_DIR:-./migration-export}"
mkdir -p "$OUT_DIR"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGR_DIR="$REPO_ROOT/supabase/migrations"

if [ ! -d "$MIGR_DIR" ]; then
  echo "❌ Cannot find $MIGR_DIR. Run from inside the project repo."
  exit 1
fi

OUT_FILE="$OUT_DIR/00_schema_bootstrap.sql"
echo "-- Generated $(date -u) -- bundles all migrations in chronological order" > "$OUT_FILE"
echo "BEGIN;" >> "$OUT_FILE"

for f in $(ls "$MIGR_DIR"/*.sql | sort); do
  echo "" >> "$OUT_FILE"
  echo "-- ===== $(basename "$f") =====" >> "$OUT_FILE"
  cat "$f" >> "$OUT_FILE"
done

echo "" >> "$OUT_FILE"
echo "COMMIT;" >> "$OUT_FILE"

LINES=$(wc -l < "$OUT_FILE")
echo "✅ Wrote $OUT_FILE ($LINES lines, $(ls "$MIGR_DIR"/*.sql | wc -l) migrations bundled)"
