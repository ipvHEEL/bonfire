from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Dialog, Message, User


MAX_TEXT_LENGTH = 4000
MAX_USERNAME_LENGTH = 32


def message_to_dict(message: Message):
    return {
        "dialog_id": message.dialog_id,
        "message_id": message.id,
        "text": message.text,
        "user_name": message.user.username,
        "created_at": message.created_at.isoformat(),
    }


async def get_or_create_user(session: AsyncSession, username: str):
    await session.execute(
        insert(User).values(username=username).on_conflict_do_nothing(
            index_elements=[User.username]
        )
    )
    return await session.scalar(select(User).where(User.username == username))


async def create_message(session: AsyncSession, dialog_id: int, username: str, text: str):
    if await session.get(Dialog, dialog_id) is None:
        return None

    user = await get_or_create_user(session, username[:MAX_USERNAME_LENGTH])
    message = Message(dialog_id=dialog_id, user=user, text=text[:MAX_TEXT_LENGTH])
    session.add(message)
    await session.commit()
    await session.refresh(message)
    return message


async def get_messages(session: AsyncSession, dialog_id: int, limit: int, before_id: int | None):
    query = select(Message).where(Message.dialog_id == dialog_id)
    if before_id is not None:
        query = query.where(Message.id < before_id)

    result = await session.scalars(query.order_by(Message.id.desc()).limit(limit))
    return list(reversed(result.all()))


async def get_users(session: AsyncSession):
    result = await session.scalars(select(User).order_by(User.id))
    return result.all()
