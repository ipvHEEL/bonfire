#!/usr/bin/env bash
# Резервная копия базы Bonfire. По расписанию её запускает cron (см.
# scripts/server-init.sh); вручную — bash scripts/backup.sh.
# Восстановление:
#   gunzip -c backups/bonfire-ДАТА.sql.gz | docker compose exec -T db psql -U bonfire -d bonfire

set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
file="backups/bonfire-$(date +%Y-%m-%d_%H%M).sql.gz"

docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' | gzip > "$file"
chmod 600 "$file"

# Храним две недели
find backups -name 'bonfire-*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') сохранено $file ($(du -h "$file" | cut -f1))"
