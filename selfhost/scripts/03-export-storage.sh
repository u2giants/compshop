#!/usr/bin/env bash
# ============================================================================
# 03-export-storage.sh
# Downloads every file from the `photos` and `retailer-logos` buckets in
# Lovable Cloud Storage to a local folder, preserving the path structure.
# Uses the Storage REST API + service role key.
# ============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-./.env}"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${LOVABLE_SUPABASE_URL:?LOVABLE_SUPABASE_URL not set}"
: "${LOVABLE_SERVICE_ROLE_KEY:?LOVABLE_SERVICE_ROLE_KEY not set}"

OUT_DIR="${OUT_DIR:-./migration-export}"
mkdir -p "$OUT_DIR/storage"

BUCKETS=(photos retailer-logos)

list_bucket() {
  local bucket="$1"
  local prefix="${2:-}"
  curl -fsS -X POST \
    -H "apikey: $LOVABLE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $LOVABLE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"prefix\":\"$prefix\",\"limit\":1000,\"offset\":0,\"sortBy\":{\"column\":\"name\",\"order\":\"asc\"}}" \
    "$LOVABLE_SUPABASE_URL/storage/v1/object/list/$bucket"
}

download_file() {
  local bucket="$1"
  local path="$2"
  local dest="$OUT_DIR/storage/$bucket/$path"
  mkdir -p "$(dirname "$dest")"
  curl -fsS \
    -H "apikey: $LOVABLE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $LOVABLE_SERVICE_ROLE_KEY" \
    "$LOVABLE_SUPABASE_URL/storage/v1/object/$bucket/$path" \
    -o "$dest"
}

# Recursively walk the bucket. `list` returns folders (id == null) and files.
walk() {
  local bucket="$1"
  local prefix="$2"
  local items
  items=$(list_bucket "$bucket" "$prefix")
  echo "$items" | jq -r '.[] | @base64' | while read -r row; do
    _jq() { echo "$row" | base64 -d | jq -r "$1"; }
    local name id
    name=$(_jq '.name')
    id=$(_jq '.id // "null"')
    local fullpath="${prefix}${name}"
    if [ "$id" = "null" ]; then
      walk "$bucket" "${fullpath}/"
    else
      echo "  ↓ $bucket/$fullpath"
      download_file "$bucket" "$fullpath" || echo "  ⚠️  failed: $fullpath"
    fi
  done
}

if ! command -v jq >/dev/null; then
  echo "❌ jq is required. Install: apt install jq"
  exit 1
fi

for b in "${BUCKETS[@]}"; do
  echo "📦 Bucket: $b"
  walk "$b" ""
done

COUNT=$(find "$OUT_DIR/storage" -type f | wc -l)
SIZE=$(du -sh "$OUT_DIR/storage" | cut -f1)
echo ""
echo "✅ Downloaded $COUNT files ($SIZE) → $OUT_DIR/storage/"
