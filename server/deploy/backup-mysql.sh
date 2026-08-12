#!/usr/bin/env bash
# mysqldump xy_game → gzip → /opt/xy/backups/ (保留 30 天 + 每月 1 号)
set -euo pipefail

DB="${1:-xy_game}"
DIR="${XY_BACKUP_DIR:-/opt/xy/backups}"
SECRET="${DB_SECRET_FILE:-/opt/xy/server/.db_password}"
DB_USER="${DB_USER:-xy_game}"
DATE="$(date -u +%Y-%m-%d)"
DAY_OF_MONTH="$(date -u +%d)"

mkdir -p "$DIR"
TMP="$(mktemp "$DIR/.tmp-XXXXXX.sql.gz")"
trap 'rm -f "$TMP"' EXIT

echo "==> mysqldump $DB …"
MYSQL_PWD="$(cat "$SECRET")" \
  mysqldump -u"$DB_USER" --single-transaction --no-tablespaces "$DB" | gzip -9 > "$TMP"
OUT="$DIR/${DB}-${DATE}.sql.gz"
mv "$TMP" "$OUT"
trap - EXIT
echo "==> wrote $OUT ($(du -h "$OUT" | cut -f1))"

# prune: keep last 30 days; keep month-day 01 forever
find "$DIR" -name "${DB}-*.sql.gz" -type f | while read -r f; do
  base="$(basename "$f" .sql.gz)"
  d="${base#${DB}-}"
  # skip monthly anchors
  if [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-01$ ]]; then
    continue
  fi
  # delete if older than 30 days
  if [[ "$(uname)" == Darwin ]]; then
    cutoff="$(date -u -v-30d +%Y-%m-%d)"
  else
    cutoff="$(date -u -d '30 days ago' +%Y-%m-%d)"
  fi
  if [[ "$d" < "$cutoff" ]]; then
    rm -f "$f"
    echo "    pruned $f"
  fi
done

# silence unused
: "$DAY_OF_MONTH"
