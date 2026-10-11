from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Message


MAX_TEXT_LENGTH = 4000


def message_to_dict(message: Message):
    return {
        "dialog_id": message.dialog_id,
        "message_id": message.id,
        "text": message.text,
        "user_id": message.user_id,
        "user_name": message.user.name,
        "created_at": message.created_at.isoformat(),
    }


async def create_message(session: AsyncSession, dialog_id: int, user_id: int, text: str):
    message = Message(dialog_id=dialog_id, user_id=user_id, text=text[:MAX_TEXT_LENGTH])
    session.add(message)
    await session.commit()
    await session.refresh(message)
    return message


async def get_messages(session: AsyncSession, dialog_id: int, limit: int, before_id: int | None):
    query = select(Message).where(Message.dialog_id == dialog_id)
    if before_id is not None:
        query = query.where(Message.id < before_id)

    # Берём последние `limit` сообщений, а отдаём в хронологическом порядке
    result = await session.scalars(query.order_by(Message.id.desc()).limit(limit))
    return list(reversed(result.all()))
