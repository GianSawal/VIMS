#!/bin/sh
# Check or restore a backup made by backup.sh. Run on the Docker host as root.
#   deploy/restore.sh --check /backups/vrs/vrs-20261101-011500.tar.gz.gpg    decrypt and verify only, changes nothing
#   deploy/restore.sh /backups/vrs/vrs-20261101-011500.tar.gz.gpg            replace the database and the uploads
# Restore into staging first: VRS_BACKUP_CONFIG=/etc/vrs-staging.env points it at the staging containers.
set -eu

CONFIG=${VRS_BACKUP_CONFIG:-/etc/vrs-backup.env}
. "$CONFIG"
: "${MYSQL_CONTAINER:?set in $CONFIG}" "${MEDIA_VOLUME:?set in $CONFIG}" "${PASSPHRASE_FILE:?set in $CONFIG}"
DB_NAME=${DB_NAME:-vims}

check_only=
if [ "${1:-}" = "--check" ]; then check_only=1; shift; fi
file=${1:?usage: restore.sh [--check] <backup file>}

umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

gpg --batch --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" -d "$file" | tar -C "$work" -xzf -
tail -n 1 "$work/db.sql" | grep -q 'Dump completed' || { echo "db.sql is incomplete" >&2; exit 1; }
gzip -t "$work/media.tar.gz"
echo "Backup OK: database dump $(du -h "$work/db.sql" | cut -f1), $(grep -c '^INSERT INTO' "$work/db.sql") insert statements;" \
     "uploads: $(tar -tzf "$work/media.tar.gz" | grep -vc '/$') files"
[ -n "$check_only" ] && exit 0

echo "This REPLACES database '$DB_NAME' in container $MYSQL_CONTAINER and every file in volume $MEDIA_VOLUME."
echo "Stop the VRS backend first (Coolify: stop the resource). Type the database name to continue:"
read -r answer
[ "$answer" = "$DB_NAME" ] || { echo "Cancelled."; exit 1; }

docker exec -i "$MYSQL_CONTAINER" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "$1"' sh "$DB_NAME" < "$work/db.sql"
docker run --rm -i -v "$MEDIA_VOLUME":/media alpine:3.20 \
  sh -c 'find /media -mindepth 1 -delete && tar -C /media -xzf -' < "$work/media.tar.gz"
echo "Restored. Start the backend again: it runs migrate on start. Then open a few vehicles, documents and attachments."
