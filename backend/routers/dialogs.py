from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, get_session
from db import dialogs as dialogs_db
from db import messages as messages_db
from db import users as users_db
from db.models import User


router = APIRouter(tags=["dialogs"])


class DirectIn(BaseModel):
    user_id: int


@router.get("/users")
async def get_users(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    users = await users_db.get_registered_users(session, exclude_user_id=user.id)
    return {"users": [users_db.user_to_dict(u) for u in users]}


@router.get("/dialogs")
async def get_dialogs(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    dialogs = await dialogs_db.get_user_dialogs(session, user.id)
    return {"dialogs": [dialogs_db.dialog_to_dict(d, user) for d in dialogs]}


@router.post("/dialogs/direct")
async def open_direct(
    data: DirectIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    other = await users_db.get_user(session, data.user_id)
    if other is None or other.password_hash is None or other.id == user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")

    dialog = await dialogs_db.get_or_create_direct(session, user, other)
    return dialogs_db.dialog_to_dict(dialog, user)


@router.get("/dialogs/{dialog_id}/messages")
async def get_messages(
    dialog_id: int,
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    # 404, а не 403: чужие диалоги не должны выдавать даже факт своего существования
    if not await dialogs_db.is_member(session, dialog_id, user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Диалог не найден")

    messages = await messages_db.get_messages(session, dialog_id, limit, before_id)
    return {"messages": [messages_db.message_to_dict(m) for m in messages]}
