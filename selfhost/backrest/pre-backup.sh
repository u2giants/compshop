#!/bin/bash
# Pre-backup hook: dump small control-plane databases before Backrest snapshots.
set -euo pipefail

DUMP_DIR="${DUMP_DIR:-/db-dumps}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_MINUTES="${DUMP_RETENTION_MINUTES:-1440}"
MIN_FREE_MB="${DUMP_MIN_FREE_MB:-5120}"

echo "=== Pre-backup database dump started at $(date) ==="

find_container() {
    docker ps --format "{{.Names}}" | grep -E "^${1}(-[0-9]+)?$" | head -1 || true
}

free_mb() {
    df -Pm "${DUMP_DIR}" | awk 'NR == 2 {print $4}'
}

prune_old_dumps() {
    echo "Pruning local timestamped dumps older than ${RETENTION_MINUTES} minutes..."
    find "${DUMP_DIR}" -maxdepth 1 -type f -name "*-20*.sql" -mmin +"${RETENTION_MINUTES}" -delete 2>/dev/null || true
    find "${DUMP_DIR}" -maxdepth 1 -type f -name "*-20*.rdb" -mmin +"${RETENTION_MINUTES}" -delete 2>/dev/null || true
    echo "  Free space after prune: $(free_mb) MB"
}

require_free_space() {
    local free

    free=$(free_mb)
    if [ "${free}" -lt "${MIN_FREE_MB}" ]; then
        echo "ERROR: only ${free} MB free in ${DUMP_DIR}; need at least ${MIN_FREE_MB} MB before dumping"
        exit 1
    fi
}

write_latest_and_copy() {
    local latest_file="$1"
    local dated_file="$2"

    require_free_space
    cat > "${latest_file}"
    require_free_space
    cp "${latest_file}" "${dated_file}"
}

prune_old_dumps
require_free_space

echo "Dumping coolify-db..."
docker exec coolify-db pg_dumpall -U coolify 2>&1 | write_latest_and_copy "${DUMP_DIR}/coolify-db-latest.sql" "${DUMP_DIR}/coolify-db-${TIMESTAMP}.sql"
echo "  Done: coolify-db-latest.sql"

CS_DB=$(find_container "supabase-db-lc7f483hklyq89eej67idpbx")
if [ -n "${CS_DB}" ]; then
    echo "Dumping compshop Supabase DB (${CS_DB})..."
    docker exec "${CS_DB}" pg_dumpall -U postgres 2>&1 | write_latest_and_copy "${DUMP_DIR}/compshop-supabase-latest.sql" "${DUMP_DIR}/compshop-supabase-${TIMESTAMP}.sql"
    echo "  Done: compshop-supabase-latest.sql"
else
    echo "  WARNING: compshop Supabase DB not running, skipping"
fi

CS_DB2=$(find_container "db-h8nwhgk682eedokx8nh2eg1q")
if [ -n "${CS_DB2}" ]; then
    echo "Dumping second Supabase DB (${CS_DB2})..."
    docker exec "${CS_DB2}" pg_dumpall -U postgres 2>&1 | write_latest_and_copy "${DUMP_DIR}/compshop-supabase2-latest.sql" "${DUMP_DIR}/compshop-supabase2-${TIMESTAMP}.sql"
    echo "  Done: compshop-supabase2-latest.sql"
else
    echo "  WARNING: second Supabase DB not running, skipping"
fi

if docker ps --format "{{.Names}}" | grep -q "^coolify-redis$"; then
    echo "Dumping coolify-redis..."
    require_free_space
    docker exec coolify-redis redis-cli BGSAVE > /dev/null 2>&1
    sleep 2
    docker cp "coolify-redis:/data/dump.rdb" "${DUMP_DIR}/coolify-redis-latest.rdb" 2>&1
    require_free_space
    cp "${DUMP_DIR}/coolify-redis-latest.rdb" "${DUMP_DIR}/coolify-redis-${TIMESTAMP}.rdb"
    echo "  Done: coolify-redis-latest.rdb"
fi

prune_old_dumps

echo "=== Pre-backup database dump completed at $(date) ==="
