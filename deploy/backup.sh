#!/bin/sh
# Encrypted backup of the VRS database and the uploads (media volume), as one file. Run on the Docker host as root:
#   15 1 * * * /opt/vrs/deploy/backup.sh >> /var/log/vrs-backup.log 2>&1
# Settings come from /etc/vrs-backup.env (copy deploy/backup.env.example; VRS_BACKUP_CONFIG points elsewhere).
set -eu

CONFIG=${VRS_BACKUP_CONFIG:-/etc/vrs-backup.env}
. "$CONFIG"
: "${MYSQL_CONTAINER:?set in $CONFIG}" "${MEDIA_VOLUME:?set in $CONFIG}" "${BACKUP_DIR:?set in $CONFIG}"
: "${PASSPHRASE_FILE:?set in $CONFIG}"
DB_NAME=${DB_NAME:-vims}
KEEP_DAYS=${KEEP_DAYS:-30}

umask 077  # the backup holds personal data (drivers, license scans) and the audit trail
stamp=$(date +%Y%m%d-%H%M%S)
out="$BACKUP_DIR/vrs-$stamp.tar.gz.gpg"
work=$(mktemp -d)
trap 'rm -rf "$work" "$out.part"' EXIT  # a failed run leaves no file that looks like a backup
mkdir -p "$BACKUP_DIR"

echo "$(date -Is) backup start"
# mysqldump from the MySQL container itself, so the client matches the server. MYSQL_PWD keeps the password out of ps.
docker exec "$MYSQL_CONTAINER" sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces "$1"' \
  sh "$DB_NAME" > "$work/db.sql"
tail -n 1 "$work/db.sql" | grep -q 'Dump completed' || { echo "mysqldump did not finish" >&2; exit 1; }

docker run --rm -v "$MEDIA_VOLUME":/media:ro alpine:3.20 tar -C /media -czf - . > "$work/media.tar.gz"

tar -C "$work" -czf - db.sql media.tar.gz |
  gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
      --symmetric --cipher-algo AES256 -o "$out.part"
mv "$out.part" "$out"
echo "$(date -Is) wrote $out ($(du -h "$out" | cut -f1))"

# Off-site copy, e.g. OFFSITE_CMD='rclone copy "$1" dole-backup:vrs'. The file is already encrypted.
if [ -n "${OFFSITE_CMD:-}" ]; then
  sh -c "$OFFSITE_CMD" sh "$out"
  echo "$(date -Is) off-site copy done"
fi

find "$BACKUP_DIR" -name 'vrs-*.tar.gz.gpg' -mtime +"$KEEP_DAYS" -delete

# Optional heartbeat (Uptime Kuma push monitor, healthchecks.io, ...): a missed ping means the backup failed.
if [ -n "${HEARTBEAT_URL:-}" ]; then
  wget -q -O /dev/null "$HEARTBEAT_URL" || curl -fsS -o /dev/null "$HEARTBEAT_URL" || true
fi
echo "$(date -Is) backup done"
