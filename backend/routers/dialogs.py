import random

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, get_session
from db import dialogs as dialogs_db
from db import messages as messages_db
from db import users as users_db
from db.user_pool import user_pool
from db.models import User
from schema import events


router = APIRouter(tags=["dialogs"])


class RequestIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    text: str = Field(min_length=1, max_length=messages_db.MAX_TEXT_LENGTH)


async def get_member_dialog(session: AsyncSession, dialog_id: int, user: User):
    dialog = await dialogs_db.get_dialog(session, dialog_id)
    # 404, а не 403: чужие диалоги не должны выдавать даже факт своего существования
    if dialog is None or user.id not in {m.id for m in dialog.members}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Диалог не найден")
    return dialog


async def get_incoming_request(session: AsyncSession, dialog_id: int, user: User):
    dialog = await get_member_dialog(session, dialog_id, user)
    if dialog.status != "pending" or dialog.created_by == user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Это не входящий запрос")
    return dialog


SUGGESTIONS_COUNT = 5


@router.get("/users/suggestions")
async def suggest_users(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Несколько случайных людей, которым можно написать.

    Случайный выбор идёт из пула в памяти, поэтому запрос стоит два обращения
    к базе по индексам, сколько бы пользователей ни было.
    """
    pool = await user_pool.get(session)
    excluded = await users_db.get_peer_ids(session, user.id) | {user.id}
    candidates = [i for i in pool if i not in excluded]
    # Берём с запасом: пул обновляется раз в полминуты, и кто-то из него
    # мог за это время удалиться
    chosen = random.sample(candidates, min(SUGGESTIONS_COUNT * 3, len(candidates)))

    users = await users_db.get_users_by_ids(session, chosen)
    registered = [u for u in users if u.password_hash is not None][:SUGGESTIONS_COUNT]
    return {"users": [users_db.user_to_dict(u) for u in registered]}


@router.get("/users/search")
async def search_users(
    q: str = Query("", max_length=64),
    limit: int = Query(10, ge=1, le=20),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    users = await users_db.search_new_contacts(session, q, user.id, limit)
    return {"users": [users_db.user_to_dict(u) for u in users]}


@router.get("/dialogs")
async def get_dialogs(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    dialogs = await dialogs_db.get_user_dialogs(session, user.id)
    last = await dialogs_db.get_last_messages(session, [d.id for d in dialogs])
    result = [dialogs_db.dialog_to_dict(d, user, last.get(d.id)) for d in dialogs]
    # Сверху чаты со свежими сообщениями
    result.sort(key=lambda d: d["last_message_at"] or "", reverse=True)
    return {"dialogs": result}


@router.post("/dialogs/requests", status_code=status.HTTP_201_CREATED)
async def create_request(
    data: RequestIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    text = data.text.strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Напишите сообщение к запросу")

    other = await users_db.get_user_by_username(session, data.username.strip().lstrip("@"))
    if other is None or other.password_hash is None or other.id == user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь с таким именем не найден")

    dialog, message = await dialogs_db.create_request(session, user, other, text)
    if dialog is None:
        existing = await dialogs_db.get_direct(session, user, other)
        if existing is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Не получилось отправить запрос, попробуйте ещё раз")
        if existing.status == "accepted":
            raise HTTPException(status.HTTP_409_CONFLICT, "Этот пользователь уже есть в ваших чатах")
        if existing.created_by == user.id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Запрос уже отправлен, дождитесь ответа")
        raise HTTPException(status.HTTP_409_CONFLICT, "Этот пользователь уже прислал вам запрос — загляните в «Запросы»")

    await events.send_dialog(dialog, message)
    await events.send_message({user.id, other.id}, message)
    return dialogs_db.dialog_to_dict(dialog, user, message)


@router.post("/dialogs/{dialog_id}/accept")
async def accept_request(
    dialog_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dialog = await get_incoming_request(session, dialog_id, user)
    await dialogs_db.accept_request(session, dialog)

    last = (await dialogs_db.get_last_messages(session, [dialog.id])).get(dialog.id)
    await events.send_dialog(dialog, last)
    return dialogs_db.dialog_to_dict(dialog, user, last)


@router.post("/dialogs/{dialog_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline_request(
    dialog_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dialog = await get_incoming_request(session, dialog_id, user)
    member_ids = {m.id for m in dialog.members}
    await dialogs_db.delete_dialog(session, dialog)
    await events.send_dialog_removed(member_ids, dialog_id)


@router.delete("/dialogs/{dialog_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dialog(
    dialog_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Удаляет собеседника: личный чат и вся переписка пропадают у обоих.

    Этим же отменяется свой ещё не принятый запрос. После удаления
    можно снова найти человека и отправить ему запрос.
    """
    dialog = await get_member_dialog(session, dialog_id, user)
    if dialog.type != "direct":
        raise HTTPException(status.HTTP_409_CONFLICT, "Удалить можно только личный чат")

    member_ids = {m.id for m in dialog.members}
    await dialogs_db.delete_dialog(session, dialog)
    await events.send_dialog_removed(member_ids, dialog_id)


@router.get("/dialogs/{dialog_id}/messages")
async def get_messages(
    dialog_id: int,
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if not await dialogs_db.is_member(session, dialog_id, user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Диалог не найден")

    messages = await messages_db.get_messages(session, dialog_id, limit, before_id)
    return {"messages": [messages_db.message_to_dict(m) for m in messages]}
