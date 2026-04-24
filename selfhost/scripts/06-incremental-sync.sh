#!/usr/bin/env bash
# ============================================================================
# 06-incremental-sync.sh
# Right before final cutover, copy any rows created/updated in Lovable Cloud
# AFTER the initial export. Uses each table's `updated_at` column.
# Pass SINCE=2026-04-25T00:00:00Z (UTC) to limit the window.
# ============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-./.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

SINCE="${SINCE:?Set SINCE=YYYY-MM-DDTHH:MM:SSZ to the time of your last export}"
OUT_DIR="${OUT_DIR:-./migration-export}"
DELTA_FILE="$OUT_DIR/03_delta_${SINCE//[:T-]/}.sql"

# Tables WITH updated_at — safe to delta.
TABLES_WITH_UPDATED_AT=(
  shopping_trips photos comments photo_annotations
  china_trips china_photos
  factories profiles
)

echo "📤 Building delta dump for rows updated_at >= $SINCE"
> "$DELTA_FILE"

for t in "${TABLES_WITH_UPDATED_AT[@]}"; do
  echo "  • $t"
  PGPASSWORD="$LOVABLE_PG_PASSWORD" psql \
    -h "$LOVABLE_PG_HOST" -p "${LOVABLE_PG_PORT:-6543}" \
    -U "$LOVABLE_PG_USER" -d "${LOVABLE_PG_DB:-postgres}" \
    -AtF$'\t' \
    -c "COPY (SELECT * FROM public.$t WHERE updated_at >= '$SINCE') TO STDOUT WITH CSV HEADER" \
    > "$OUT_DIR/delta_$t.csv"
done

echo ""
echo "✅ Wrote per-table CSVs to $OUT_DIR/delta_*.csv"
echo ""
echo "Import on the new DB with (per table):"
echo "  PGPASSWORD=… psql -h \$NEW_HOST … -c \"\\\\copy public.<table> FROM 'delta_<table>.csv' WITH CSV HEADER\""
echo ""
echo "Use ON CONFLICT (id) DO UPDATE if you need true upsert — see runbook."
