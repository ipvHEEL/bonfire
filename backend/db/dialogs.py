from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models import Dialog, DialogMember, User


def dialog_to_dict(dialog: Dialog, current_user: User):
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
        "members_count": len(dialog.members),
        "peer_user_id": peer_user_id,
    }


async def get_user_dialogs(session: AsyncSession, user_id: int):
    result = await session.scalars(
        select(Dialog)
        .join(DialogMember)
        .where(DialogMember.user_id == user_id)
        .options(selectinload(Dialog.members))
        .order_by(Dialog.id)
    )
    return result.all()


async def is_member(session: AsyncSession, dialog_id: int, user_id: int):
    return await session.get(DialogMember, (dialog_id, user_id)) is not None


async def get_member_ids(session: AsyncSession, dialog_id: int):
    result = await session.scalars(
        select(DialogMember.user_id).where(DialogMember.dialog_id == dialog_id)
    )
    return set(result.all())


async def get_or_create_direct(session: AsyncSession, user: User, other: User):
    direct_key = f"{min(user.id, other.id)}:{max(user.id, other.id)}"

    # Если такой чат уже есть (или его прямо сейчас создаёт другой запрос),
    # ON CONFLICT ничего не вставит и вернёт пустой результат
    dialog_id = await session.scalar(
        insert(Dialog)
        .values(title="direct", type="direct", direct_key=direct_key)
        .on_conflict_do_nothing(index_elements=[Dialog.direct_key])
        .returning(Dialog.id)
    )
    if dialog_id is not None:
        session.add_all([
            DialogMember(dialog_id=dialog_id, user_id=user.id),
            DialogMember(dialog_id=dialog_id, user_id=other.id),
        ])
    await session.commit()

    return await session.scalar(
        select(Dialog)
        .where(Dialog.direct_key == direct_key)
        .options(selectinload(Dialog.members))
    )
