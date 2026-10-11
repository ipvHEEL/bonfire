import asyncio
import os

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, get_session
from calls.livekit import create_access_token, room_name
from db import calls as calls_db
from db import dialogs as dialogs_db
from db.database import SessionLocal
from db.models import Call, Dialog, User
from schema import events


router = APIRouter(tags=["calls"])

# Сколько ждём ответа, прежде чем считать звонок пропущенным
RING_TIMEOUT_SECONDS = float(os.getenv("CALL_RING_TIMEOUT", "45"))

# Ссылки на фоновые задачи, иначе сборщик мусора может удалить их до срабатывания
background_tasks: set[asyncio.Task] = set()


async def get_call_dialog(session: AsyncSession, dialog_id: int, user: User) -> Dialog:
    dialog = await dialogs_db.get_dialog(session, dialog_id)
    # 404, а не 403: чужие диалоги не должны выдавать даже факт своего существования
    if dialog is None or user.id not in {m.id for m in dialog.members}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Диалог не найден")
    if dialog.status != "accepted":
        raise HTTPException(status.HTTP_409_CONFLICT, "Позвонить можно, когда запрос на переписку принят")
    return dialog


async def get_open_member_call(session: AsyncSession, call_id: int, user: User) -> tuple[Call, Dialog]:
    call = await calls_db.get_call(session, call_id)
    if call is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Звонок не найден")
    dialog = await get_call_dialog(session, call.dialog_id, user)
    if call.ended_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Звонок уже завершён")
    return call, dialog


def call_response(call: Call, user: User):
    """Звонок и пропуск в комнату LiveKit: без токена в разговор не попасть.

    Права проверяем здесь: LiveKit о пользователях и чатах ничего не знает
    и пускает любого с действующим токеном.
    """
    room = room_name(call.dialog_id)
    return {
        "call": calls_db.call_to_dict(call),
        "room": room,
        "token": create_access_token(room, identity=str(user.id), name=user.name),
    }


async def finish(session: AsyncSession, call: Call, dialog: Dialog, reason: str):
    call = await calls_db.end_call(session, call, reason)
    await events.send_call_ended({m.id for m in dialog.members}, call)


async def end_if_unanswered(call_id: int):
    await asyncio.sleep(RING_TIMEOUT_SECONDS)
    async with SessionLocal() as session:
        call = await calls_db.get_call(session, call_id)
        if call is None or call.status != "ringing" or call.ended_at is not None:
            return
        dialog = await dialogs_db.get_dialog(session, call.dialog_id)
        await finish(session, call, dialog, "missed")


@router.get("/calls/active")
async def get_active_calls(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Идущие звонки в чатах пользователя: нужны, если страницу открыли во время вызова."""
    calls = await calls_db.get_open_calls_for_user(session, user.id)
    return {"calls": [calls_db.call_to_dict(c) for c in calls]}


@router.post("/dialogs/{dialog_id}/calls")
async def start_call(
    dialog_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    dialog = await get_call_dialog(session, dialog_id, user)
    call, created = await calls_db.start_call(session, dialog.id, user.id)
    # Если собеседник позвонил одновременно с нами, просто отвечаем на его звонок
    call = await calls_db.join_call(session, call, user.id)

    await events.send_call({m.id for m in dialog.members}, call)
    if created:
        task = asyncio.create_task(end_if_unanswered(call.id))
        background_tasks.add(task)
        task.add_done_callback(background_tasks.discard)
    return call_response(call, user)


@router.post("/calls/{call_id}/join")
async def join_call(
    call_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    call, dialog = await get_open_member_call(session, call_id, user)
    call = await calls_db.join_call(session, call, user.id)
    await events.send_call({m.id for m in dialog.members}, call)
    return call_response(call, user)


@router.post("/calls/{call_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline_call(
    call_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    call, dialog = await get_open_member_call(session, call_id, user)
    if call.status != "ringing" or call.started_by == user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Это не входящий вызов")
    await finish(session, call, dialog, "declined")


@router.post("/calls/{call_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_call(
    call_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    call, dialog = await get_open_member_call(session, call_id, user)
    remaining = await calls_db.leave_call(session, call, user.id)

    if call.status == "ringing":
        # Положили трубку, пока собеседник не ответил
        await finish(session, call, dialog, "cancelled")
    elif dialog.type == "direct" or remaining == 0:
        # В личном звонке выход одного завершает разговор. В группе звонок
        # идёт, пока в нём кто-то остаётся
        await finish(session, call, dialog, "completed")
    else:
        await events.send_call({m.id for m in dialog.members}, call)
