from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, get_session
from auth.security import (
    COOKIE_NAME, COOKIE_SECURE, TOKEN_LIFETIME,
    create_token, hash_password, verify_password,
)
from db import users as users_db
from db.models import User


router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    username: str = Field(pattern=r"^[A-Za-z0-9_]{3,32}$")
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)


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


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(data: RegisterIn, response: Response, session: AsyncSession = Depends(get_session)):
    if await users_db.get_user_by_username(session, data.username):
        raise HTTPException(status.HTTP_409_CONFLICT, "Это имя уже занято")

    display_name = (data.display_name or "").strip() or None
    user = await users_db.create_user(session, data.username, hash_password(data.password), display_name)
    set_auth_cookie(response, user)
    return users_db.user_to_dict(user)


@router.post("/login")
async def login(data: LoginIn, response: Response, session: AsyncSession = Depends(get_session)):
    user = await users_db.get_user_by_username(session, data.username)
    if not verify_password(data.password, user.password_hash if user else None):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверное имя пользователя или пароль")

    set_auth_cookie(response, user)
    return users_db.user_to_dict(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, httponly=True, secure=COOKIE_SECURE, samesite="lax")


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return users_db.user_to_dict(user)
