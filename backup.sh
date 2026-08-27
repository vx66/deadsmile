#!/bin/sh
# Backup de la base de datos y subidas de Dead Smile Labs.
# Uso (en el VPS, vía cron):
#   BACKUP_DIR=/var/backups/deadsmile ./backup.sh
# Cron diario:  0 3 * * * /root/deadsmile/backup.sh
set -e

CONTAINER="${CONTAINER:-deadsmile-labs}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/deadsmile}"
KEEP="${KEEP:-7}"

mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y%m%d-%H%M%S)

# Copia datos fuera del volumen (los volúmenes viven en /var/lib/docker/volumes)
docker run --rm \
  --volumes-from "$CONTAINER" \
  -v "$BACKUP_DIR:/backup" \
  alpine sh -c "\
    cp /app/data/database.db /backup/database-$STAMP.db && \
    cp /app/data/database.backup.db /backup/database.backup-$STAMP.db && \
    tar -C /app -czf /backup/uploads-$STAMP.tar.gz uploads \
  "

echo "[backup] OK -> $BACKUP_DIR/database-$STAMP.db"

# Limpia backups viejos
ls -1t "$BACKUP_DIR"/database-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f