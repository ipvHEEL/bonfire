import os
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError


JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-secret-change-me-in-the-env-file")
JWT_ALGORITHM = "HS256"
TOKEN_LIFETIME = timedelta(days=7)

COOKIE_NAME = "access_token"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

password_hasher = PasswordHasher()
# Проверяем пароль даже для несуществующего пользователя, чтобы по времени
# ответа нельзя было понять, зарегистрировано ли имя
DUMMY_HASH = password_hasher.hash("dummy-password")


def hash_password(password: str):
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str | None):
    try:
        return password_hasher.verify(password_hash or DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_token(user_id: int):
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "iat": now, "exp": now + TOKEN_LIFETIME}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def read_token(token: str | None):
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
