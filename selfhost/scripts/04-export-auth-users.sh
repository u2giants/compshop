#!/usr/bin/env bash
# ============================================================================
# 04-export-auth-users.sh
# Exports auth.users + auth.identities from Lovable Cloud so users keep their
# IDs, password hashes, and Google OAuth links. CRITICAL for not breaking
# foreign keys (every photo/trip references auth.uid).
# ============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-./.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${LOVABLE_PG_HOST:?LOVABLE_PG_HOST not set}"
: "${LOVABLE_PG_PASSWORD:?LOVABLE_PG_PASSWORD not set}"

OUT_DIR="${OUT_DIR:-./migration-export}"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/02_auth.sql"

echo "🔐 Exporting auth.users + auth.identities → $OUT_FILE"

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
  -t auth.users \
  -t auth.identities \
  > "$OUT_FILE"

# Strip columns that don't exist on a fresh self-hosted Supabase if needed.
# (Newer GoTrue versions add columns; old dumps may include extras.)
LINES=$(wc -l < "$OUT_FILE")
USERS=$(PGPASSWORD="$LOVABLE_PG_PASSWORD" psql -h "$LOVABLE_PG_HOST" -p "${LOVABLE_PG_PORT:-6543}" \
          -U "$LOVABLE_PG_USER" -d "${LOVABLE_PG_DB:-postgres}" -tAc "SELECT count(*) FROM auth.users")
IDENT=$(PGPASSWORD="$LOVABLE_PG_PASSWORD" psql -h "$LOVABLE_PG_HOST" -p "${LOVABLE_PG_PORT:-6543}" \
          -U "$LOVABLE_PG_USER" -d "${LOVABLE_PG_DB:-postgres}" -tAc "SELECT count(*) FROM auth.identities")

echo "✅ Wrote $OUT_FILE ($LINES lines)"
echo "   Users:      $USERS"
echo "   Identities: $IDENT"
echo ""
echo "⚠️  After importing this on the new DB, users keep their UUIDs and Google links."
echo "   Email/password users keep their hashes — they can log in with their existing password."
