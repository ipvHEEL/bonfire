import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, get_session
from auth.security import (
    COOKIE_NAME, COOKIE_SECURE, TOKEN_LIFETIME,
    create_token, hash_password, verify_password,
)
from auth.rate_limit import RateLimiter
from db import invites as invites_db
from db import users as users_db
from db.models import User


router = APIRouter(prefix="/auth", tags=["auth"])

# open — регистрироваться может любой (для разработки и домашней сети),
# invite — только по инвайт-коду (для сервера в интернете)
REGISTRATION_MODE = os.getenv("REGISTRATION_MODE", "open")

# Защита от перебора: неудачные входы считаем и по адресу, и по имени —
# так не помогает ни перебор паролей одного пользователя с разных адресов,
# ни перебор разных пользователей с одного
login_failures_by_ip = RateLimiter(limit=20, window_seconds=15 * 60)
login_failures_by_user = RateLimiter(limit=8, window_seconds=15 * 60)
# Регистрации с одного адреса — заодно ограничивает перебор инвайт-кодов
registrations_by_ip = RateLimiter(limit=10, window_seconds=60 * 60)


def client_ip(request: Request):
    # Реальный адрес клиента подставляет uvicorn из X-Forwarded-For
    # (запуск с --proxy-headers): бэкенд доступен только через прокси
    return request.client.host if request.client else "unknown"


def ensure_not_limited(*checks: tuple[RateLimiter, str]):
    wait = max(limiter.retry_after(key) for limiter, key in checks)
    if wait:
        minutes = max(1, round(wait / 60))
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Слишком много попыток. Попробуйте через {minutes} мин.",
            headers={"Retry-After": str(wait)},
        )


class RegisterIn(BaseModel):
    username: str = Field(pattern=r"^[A-Za-z0-9_]{3,32}$")
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)
    invite_code: str | None = Field(default=None, max_length=32)


class LoginIn(BaseModel):
    username: str = Field(max_length=32)
    password: str = Field(max_length=128)


def set_auth_cookie(response: Response, user: User):
    response.set_cookie(
        COOKIE_NAME,
        create_token(user.id),
        max_age=int(TOKEN_LIFETIME.total_seconds()),
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
    )


@router.get("/config")
async def auth_config():
    """Что показать на странице входа: нужно ли поле для инвайт-кода."""
    return {"registration": REGISTRATION_MODE}


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    data: RegisterIn,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    ip = client_ip(request)
    ensure_not_limited((registrations_by_ip, ip))
    registrations_by_ip.hit(ip)

    if await users_db.get_user_by_username(session, data.username):
        raise HTTPException(status.HTTP_409_CONFLICT, "Это имя уже занято")

    display_name = (data.display_name or "").strip() or None
    password_hash = hash_password(data.password)

    if REGISTRATION_MODE == "invite":
        if not (data.invite_code or "").strip():
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Нужен инвайт-код — попросите его у владельца сервера")
        try:
            user = await invites_db.register_with_invite(
                session, data.invite_code, data.username, password_hash, display_name
            )
        except IntegrityError:
            raise HTTPException(status.HTTP_409_CONFLICT, "Это имя уже занято")
        if user is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Инвайт-код неверный, просрочен или уже использован")
    else:
        user = await users_db.create_user(session, data.username, password_hash, display_name)

    set_auth_cookie(response, user)
    return users_db.user_to_dict(user)


@router.post("/login")
async def login(
    data: LoginIn,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    ip = client_ip(request)
    username_key = data.username.strip().lower()
    ensure_not_limited((login_failures_by_ip, ip), (login_failures_by_user, username_key))

    user = await users_db.get_user_by_username(session, data.username)
    if not verify_password(data.password, user.password_hash if user else None):
        login_failures_by_ip.hit(ip)
        login_failures_by_user.hit(username_key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверное имя пользователя или пароль")

    login_failures_by_user.reset(username_key)
    set_auth_cookie(response, user)
    return users_db.user_to_dict(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, httponly=True, secure=COOKIE_SECURE, samesite="lax")


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return users_db.user_to_dict(user)
