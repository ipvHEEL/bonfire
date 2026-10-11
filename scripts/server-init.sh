#!/usr/bin/env bash
# Первичная настройка Bonfire на сервере. Запускается из папки проекта
# на сервере (обычно её вызывает scripts/deploy.sh). Повторный запуск
# безопасен: существующий .env не перезаписывается.
#
#   BONFIRE_DOMAIN=141-133-200-47.sslip.io bash scripts/server-init.sh

set -euo pipefail
cd "$(dirname "$0")/.."

public_ip=$(curl -4 -s --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')
domain=${BONFIRE_DOMAIN:-$(echo "$public_ip" | tr . -).sslip.io}

secret() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

if [[ ! -f .env ]]; then
    umask 077
    cat > .env <<ENV
# Создано scripts/server-init.sh — секреты сервера, никому не отправляйте
# Любая команда docker compose на сервере сразу берёт боевую конфигурацию
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
BONFIRE_DOMAIN=$domain
POSTGRES_DB=bonfire
POSTGRES_USER=bonfire
POSTGRES_PASSWORD=$(secret 32)
JWT_SECRET=$(secret 64)
LIVEKIT_API_KEY=bonfire$(secret 8)
LIVEKIT_API_SECRET=$(secret 48)
LIVEKIT_NODE_IP=$public_ip
ENV
    echo "Создан .env для $domain ($public_ip)"
else
    echo ".env уже есть — секреты не трогаю"
fi

# Ежедневная резервная копия базы в 04:00
cron_line="0 4 * * * cd $(pwd) && bash scripts/backup.sh >> /var/log/bonfire-backup.log 2>&1"
# На новом сервере расписания ещё нет: crontab -l и grep без совпадений
# завершаются с ошибкой, а это не повод останавливать настройку
{ { crontab -l 2>/dev/null || true; } | { grep -v 'scripts/backup.sh' || true; }; echo "$cron_line"; } | crontab -
echo "Резервные копии: каждый день в 04:00, папка $(pwd)/backups"
