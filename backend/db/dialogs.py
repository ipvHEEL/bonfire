from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models import Dialog, DialogMember, Message, User


def dialog_to_dict(dialog: Dialog, current_user: User, last_message: Message | None = None):
    title = dialog.title
    peer_user_id = None
    if dialog.type == "direct":
        # У личного чата нет общего названия: каждый видит имя собеседника
        other = next((m for m in dialog.members if m.id != current_user.id), current_user)
        title = other.name
        peer_user_id = other.id

    return {
        "dialog_id": dialog.id,
        "title": title,
        "type": dialog.type,
        "status": dialog.status,
        # Входящий запрос: принять или отклонить его может только получатель
        "is_incoming_request": dialog.status == "pending" and dialog.created_by != current_user.id,
        "members_count": len(dialog.members),
        "peer_user_id": peer_user_id,
        "last_message": last_message.text if last_message else None,
        "last_message_at": last_message.created_at.isoformat() if last_message else None,
    }


async def get_dialog(session: AsyncSession, dialog_id: int):
    return await session.scalar(
        select(Dialog)
        .where(Dialog.id == dialog_id)
        .options(selectinload(Dialog.members))
    )


async def get_user_dialogs(session: AsyncSession, user_id: int):
    result = await session.scalars(
        select(Dialog)
        .join(DialogMember)
        .where(DialogMember.user_id == user_id)
        .options(selectinload(Dialog.members))
    )
    return result.all()


async def get_last_messages(session: AsyncSession, dialog_ids: list[int]):
    if not dialog_ids:
        return {}

    # DISTINCT ON берёт по одной (самой новой) строке на каждый диалог
    result = await session.scalars(
        select(Message)
        .where(Message.dialog_id.in_(dialog_ids))
        .order_by(Message.dialog_id, Message.id.desc())
        .distinct(Message.dialog_id)
    )
    return {m.dialog_id: m for m in result.all()}


async def is_member(session: AsyncSession, dialog_id: int, user_id: int):
    return await session.get(DialogMember, (dialog_id, user_id)) is not None


async def get_member_ids(session: AsyncSession, dialog_id: int):
    result = await session.scalars(
        select(DialogMember.user_id).where(DialogMember.dialog_id == dialog_id)
    )
    return set(result.all())


def direct_key_for(user: User, other: User):
    return f"{min(user.id, other.id)}:{max(user.id, other.id)}"


async def get_direct(session: AsyncSession, user: User, other: User):
    return await session.scalar(
        select(Dialog)
        .where(Dialog.direct_key == direct_key_for(user, other))
        .options(selectinload(Dialog.members))
    )


async def create_request(session: AsyncSession, user: User, other: User, text: str):
    """Создаёт запрос на переписку вместе с первым сообщением.

    Возвращает (dialog, message), или (None, None), если чат этой пары уже есть.
    """
    # ON CONFLICT по direct_key: если чат этой пары уже существует
    # или его прямо сейчас создаёт другой запрос, ничего не вставится
    dialog_id = await session.scalar(
        insert(Dialog)
        .values(
            title="direct",
            type="direct",
            status="pending",
            created_by=user.id,
            direct_key=direct_key_for(user, other),
        )
        .on_conflict_do_nothing(index_elements=[Dialog.direct_key])
        .returning(Dialog.id)
    )
    if dialog_id is None:
        return None, None

    session.add_all([
        DialogMember(dialog_id=dialog_id, user_id=user.id),
        DialogMember(dialog_id=dialog_id, user_id=other.id),
    ])
    message = Message(dialog_id=dialog_id, user_id=user.id, text=text)
    session.add(message)
    await session.commit()
    await session.refresh(message)

    return await get_dialog(session, dialog_id), message


async def accept_request(session: AsyncSession, dialog: Dialog):
    dialog.status = "accepted"
    await session.commit()


async def delete_dialog(session: AsyncSession, dialog: Dialog):
    await session.delete(dialog)
    await session.commit()
