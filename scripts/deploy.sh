#!/usr/bin/env bash
# Выкладывает текущую версию Bonfire на сервер (запуск у себя, в Git Bash):
#   ./scripts/deploy.sh root@141.133.200.47
#
# Отправляет файлы проекта (без того, что в .gitignore: секретов, node_modules,
# venv), при первом запуске создаёт на сервере .env с секретами, затем
# пересобирает и перезапускает контейнеры. Данные базы при этом сохраняются.

set -euo pipefail
target=${1:?укажите сервер: ./scripts/deploy.sh root@IP}
remote_dir=/opt/bonfire
cd "$(dirname "$0")/.."

echo "Отправляю код на $target…"
git ls-files -co --exclude-standard -z \
    | grep -zv -E '^(desktop|docs)/' \
    | tar --null -T - -czf - \
    | ssh "$target" "mkdir -p $remote_dir && tar -xzf - -C $remote_dir"

ssh "$target" "cd $remote_dir && bash scripts/server-init.sh && \
    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --remove-orphans && \
    docker image prune -f > /dev/null && \
    docker compose -f docker-compose.yml -f docker-compose.prod.yml ps --format '{{.Name}}: {{.Status}}'"

domain=$(ssh "$target" "grep '^BONFIRE_DOMAIN=' $remote_dir/.env | cut -d= -f2")
echo ""
echo "Готово: https://$domain"
