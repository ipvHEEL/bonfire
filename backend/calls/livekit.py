import os
from datetime import datetime, timedelta, timezone

import jwt


LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "devkey")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "dev-only-livekit-secret-change-me-in-env")
# Токен нужен только чтобы войти в комнату: дальше LiveKit сам продлевает
# доступ подключённым участникам
TOKEN_LIFETIME = timedelta(minutes=10)


def room_name(dialog_id: int):
    # Комната звонка = диалог. Для групп будет работать так же
    return f"dialog-{dialog_id}"


def create_access_token(room: str, identity: str, name: str):
    """Токен доступа к комнате LiveKit — JWT, подписанный секретом API."""
    now = datetime.now(timezone.utc)
    payload = {
        "iss": LIVEKIT_API_KEY,
        "sub": identity,
        "name": name,
        "nbf": now,
        "exp": now + TOKEN_LIFETIME,
        "video": {
            "room": room,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
            # Текст ходит через наш вебсокет, канал данных LiveKit не нужен
            "canPublishData": False,
        },
    }
    return jwt.encode(payload, LIVEKIT_API_SECRET, algorithm="HS256")
