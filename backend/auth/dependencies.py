from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from auth.security import COOKIE_NAME, read_token
from db.database import SessionLocal
from db.users import get_user


async def get_session():
    async with SessionLocal() as session:
        yield session


async def get_current_user(request: Request, session: AsyncSession = Depends(get_session)):
    user_id = read_token(request.cookies.get(COOKIE_NAME))
    user = await get_user(session, user_id) if user_id else None
    if user is None or user.password_hash is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужно войти в аккаунт")
    return user
