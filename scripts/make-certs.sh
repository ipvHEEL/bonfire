#!/usr/bin/env bash
# Выпускает HTTPS-сертификат для запуска Bonfire в локальной сети.
#
# Браузер даёт доступ к микрофону только по https (или на localhost),
# поэтому для звонков между устройствами нужен сертификат.
#
# Использование (из корня проекта, в Git Bash):
#   ./scripts/make-certs.sh 192.168.1.13 192.168.1.6
# Аргументы — адреса, по которым чат будут открывать с других устройств.
# localhost и 127.0.0.1 добавляются всегда.
#
# Создаётся свой центр сертификации (certs/ca.crt). Чтобы браузеры не
# ругались на сертификат, ca.crt нужно один раз добавить в доверенные
# на каждом устройстве. Ключи (*.key) никому не отправляйте.

set -euo pipefail

# Git Bash иначе превращает "/CN=..." в путь Windows
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."
mkdir -p certs
cd certs

san="DNS:localhost,IP:127.0.0.1,IP:::1"
for address in "$@"; do
    if [[ "$address" =~ ^[0-9.]+$ ]]; then
        san="$san,IP:$address"
    else
        san="$san,DNS:$address"
    fi
done

# Центр сертификации создаём один раз: если его перевыпустить,
# доверие к нему придётся заново настраивать на всех устройствах
if [[ ! -f ca.key ]]; then
    openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
        -keyout ca.key -out ca.crt -subj "/CN=Bonfire local CA" \
        -addext "basicConstraints=critical,CA:TRUE" \
        -addext "keyUsage=critical,keyCertSign,cRLSign"
    echo "Создан центр сертификации certs/ca.crt"
fi

# Сертификат сервера можно перевыпускать сколько угодно, например
# когда у компьютера сменился адрес в сети
openssl req -newkey rsa:2048 -nodes -sha256 \
    -keyout server.key -out server.csr -subj "/CN=Bonfire"
# Расширения через временный файл: openssl для Windows не читает из <(...)
printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n" "$san" > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out server.crt -days 825 -sha256 -extfile server.ext
rm -f server.csr server.ext ca.srl

echo "Выпущен certs/server.crt для: $san"
