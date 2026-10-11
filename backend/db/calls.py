from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Call, CallParticipant, DialogMember


def call_to_dict(call: Call):
    return {
        "call_id": call.id,
        "dialog_id": call.dialog_id,
        "status": call.status,
        "started_by": call.started_by,
        "end_reason": call.end_reason,
        "started_at": call.started_at.isoformat(),
        "answered_at": call.answered_at.isoformat() if call.answered_at else None,
    }


async def get_call(session: AsyncSession, call_id: int):
    return await session.get(Call, call_id)


async def get_open_call(session: AsyncSession, dialog_id: int):
    return await session.scalar(
        select(Call).where(Call.dialog_id == dialog_id, Call.ended_at.is_(None))
    )


async def start_call(session: AsyncSession, dialog_id: int, user_id: int):
    """Начинает звонок в чате. Если звонок там уже идёт, возвращает его.

    Возвращает (call, created).
    """
    # Уникальный частичный индекс: если звонок в этом чате уже открыт
    # (или его прямо сейчас открывает собеседник), ничего не вставится
    call_id = await session.scalar(
        insert(Call)
        .values(dialog_id=dialog_id, started_by=user_id)
        .on_conflict_do_nothing(
            index_elements=[Call.dialog_id], index_where=Call.ended_at.is_(None)
        )
        .returning(Call.id)
    )
    await session.commit()

    if call_id is None:
        return await get_open_call(session, dialog_id), False
    return await get_call(session, call_id), True


async def join_call(session: AsyncSession, call: Call, user_id: int):
    """Отмечает, что пользователь в звонке. Ответ собеседника начинает разговор."""
    await session.execute(
        insert(CallParticipant)
        .values(call_id=call.id, user_id=user_id)
        .on_conflict_do_update(
            index_elements=[CallParticipant.call_id, CallParticipant.user_id],
            set_={"joined_at": func.now(), "left_at": None},
        )
    )
    if call.status == "ringing" and user_id != call.started_by:
        call.status = "active"
        call.answered_at = func.now()
    await session.commit()
    await session.refresh(call)
    return call


async def leave_call(session: AsyncSession, call: Call, user_id: int):
    """Отмечает выход из звонка. Возвращает, сколько участников ещё в нём."""
    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == call.id, CallParticipant.user_id == user_id)
        .values(left_at=func.now())
    )
    await session.commit()
    remaining = await session.scalar(
        select(func.count()).where(
            CallParticipant.call_id == call.id, CallParticipant.left_at.is_(None)
        )
    )
    return remaining


async def end_call(session: AsyncSession, call: Call, reason: str):
    call.status = "ended"
    call.end_reason = reason
    call.ended_at = func.now()
    await session.execute(
        update(CallParticipant)
        .where(CallParticipant.call_id == call.id, CallParticipant.left_at.is_(None))
        .values(left_at=func.now())
    )
    await session.commit()
    await session.refresh(call)
    return call


async def get_open_calls_for_user(session: AsyncSession, user_id: int):
    result = await session.scalars(
        select(Call)
        .join(DialogMember, DialogMember.dialog_id == Call.dialog_id)
        .where(DialogMember.user_id == user_id, Call.ended_at.is_(None))
    )
    return result.all()


async def end_all_open_calls(session: AsyncSession):
    """При старте сервера: звонки, которые шли до перезапуска, уже оборвались."""
    await session.execute(
        update(Call)
        .where(Call.ended_at.is_(None))
        .values(status="ended", end_reason="interrupted", ended_at=func.now())
    )
    await session.execute(
        update(CallParticipant).where(CallParticipant.left_at.is_(None)).values(left_at=func.now())
    )
    await session.commit()
