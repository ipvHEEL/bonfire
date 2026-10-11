# Подключает Bonfire к сети Tailscale: получает настоящий сертификат
# Let's Encrypt на имя машины (имя.tailnet.ts.net), включает его в nginx
# и переключает LiveKit на Tailscale-адрес, чтобы друзья могли звонить.
#
# Запуск из корня проекта:
#   powershell -ExecutionPolicy Bypass -File scripts\tailscale-cert.ps1
#
# Сертификат живёт 90 дней — запускайте скрипт снова раз в 2–3 месяца.
# Перед первым запуском в админке Tailscale (DNS) должны быть включены
# MagicDNS и HTTPS Certificates.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$certs = Join-Path $root 'certs'
$tailscale = 'C:\Program Files\Tailscale\tailscale.exe'

if (-not (Test-Path $tailscale)) { throw 'Tailscale не установлен' }
$status = & $tailscale status --json | ConvertFrom-Json
if ($status.BackendState -ne 'Running') { throw 'Tailscale не подключён — войдите в аккаунт' }

$name = $status.Self.DNSName.TrimEnd('.')
$ip = $status.Self.TailscaleIPs | Where-Object { $_ -match '^\d+\.' } | Select-Object -First 1

New-Item -ItemType Directory -Force $certs | Out-Null
Write-Host "Получаю сертификат для $name…"
& $tailscale cert --cert-file (Join-Path $certs 'tailscale.crt') --key-file (Join-Path $certs 'tailscale.key') $name
if ($LASTEXITCODE -ne 0) {
    # Самая частая причина: HTTPS включили в админке, а клиент ещё
    # не получил новые настройки аккаунта
    throw ('Не удалось получить сертификат. Проверьте, что в админке Tailscale (DNS) ' +
        'включены MagicDNS и HTTPS Certificates, затем переподключите Tailscale ' +
        '(значок в трее → Disconnect → Connect) и запустите скрипт снова')
}

# Отдельный server-блок nginx для Tailscale-имени: frontend/nginx.conf
# подключает certs/tailscale*.conf, если такой файл есть
$site = @"
# Создано scripts/tailscale-cert.ps1 — не редактируйте вручную
server {
    listen 443 ssl;
    http2 on;
    server_name $name;

    ssl_certificate /etc/nginx/certs/tailscale.crt;
    ssl_certificate_key /etc/nginx/certs/tailscale.key;

    include /etc/nginx/bonfire/locations.conf;
}
"@
# Без BOM: nginx не понимает отметку порядка байтов в начале файла
[System.IO.File]::WriteAllText((Join-Path $certs 'tailscale-site.conf'), $site, (New-Object System.Text.UTF8Encoding $false))

# LiveKit должен объявлять собеседникам адрес, до которого они доберутся
$envFile = Join-Path $root '.env'
$lines = if (Test-Path $envFile) { @(Get-Content $envFile | Where-Object { $_ -notmatch '^LIVEKIT_NODE_IP=' }) } else { @() }
$lines += "LIVEKIT_NODE_IP=$ip"
[System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding $false))

Push-Location $root
try {
    docker compose up -d livekit frontend | Out-Null
    # nginx перечитывает сертификаты только при перезагрузке
    docker compose exec -T frontend nginx -s reload | Out-Null
} finally {
    Pop-Location
}

$expires = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (Join-Path $certs 'tailscale.crt')).NotAfter
Write-Host ''
Write-Host "Готово. Адрес для друзей: https://${name}:8443"
Write-Host "LiveKit объявляет адрес: $ip"
Write-Host ("Сертификат действует до {0:dd.MM.yyyy} — запустите скрипт снова до этой даты" -f $expires)
