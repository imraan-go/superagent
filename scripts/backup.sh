#!/usr/bin/env bash
# Nightly backup of tj-lhos-panel: Postgres dump (via the `panel-db` container)
# plus a tarball of the uploads volume. Keeps 14 days. Run as root.
#
#   scripts/backup.sh              full backup into $BACKUP_DIR
#   scripts/backup.sh --db-only    just the pg_dump (also what the test uses)
#
# Env overrides (all optional): BACKUP_DIR, UPLOAD_DIR, KEEP_DAYS,
# DB_CONTAINER, DB_USER, DB_NAME.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/root/backups/tj-lhos-panel}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/tj-lhos-panel/uploads}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB_CONTAINER="${DB_CONTAINER:-panel-db}"
DB_USER="${DB_USER:-panel}"
DB_NAME="${DB_NAME:-panel}"
TS=$(date +%Y%m%d-%H%M%S)
DB_ONLY=0
[ "${1:-}" = "--db-only" ] && DB_ONLY=1

umask 077
mkdir -p "$BACKUP_DIR"

DUMP="$BACKUP_DIR/db-$TS.sql.gz"
echo "== pg_dump $DB_NAME -> $DUMP"
# Write to a temp name first so a failed dump never looks like a good backup.
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner | gzip -9 > "$DUMP.partial"
[ -s "$DUMP.partial" ] || { echo "dump is empty" >&2; rm -f "$DUMP.partial"; exit 1; }
gzip -t "$DUMP.partial"
mv "$DUMP.partial" "$DUMP"

if [ "$DB_ONLY" = 0 ]; then
  if [ -d "$UPLOAD_DIR" ]; then
    FILES="$BACKUP_DIR/uploads-$TS.tar.gz"
    echo "== tar $UPLOAD_DIR -> $FILES"
    tar -czf "$FILES.partial" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
    mv "$FILES.partial" "$FILES"
  else
    echo "== skip uploads (no $UPLOAD_DIR)"
  fi

  echo "== prune backups older than $KEEP_DAYS days"
  find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.sql.gz' -o -name 'uploads-*.tar.gz' \) \
    -mtime +"$KEEP_DAYS" -print -delete
fi
echo "== done"
