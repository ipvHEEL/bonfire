from sqlalchemy import case, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Dialog, DialogMember, User


def user_to_dict(user: User):
    return {
        "user_id": user.id,
        "username": user.username,
        "display_name": user.name,
    }


async def get_user(session: AsyncSession, user_id: int):
    return await session.get(User, user_id)


async def get_user_by_username(session: AsyncSession, username: str):
    return await session.scalar(select(User).where(User.username == username))


async def create_user(session: AsyncSession, username: str, password_hash: str, display_name: str | None):
    user = User(username=username, password_hash=password_hash, display_name=display_name)
    session.add(user)
    await session.commit()
    return user


async def get_peer_ids(session: AsyncSession, user_id: int):
    """Все, с кем у пользователя уже есть чат или запрос."""
    my_dialogs = select(DialogMember.dialog_id).where(DialogMember.user_id == user_id)
    result = await session.scalars(
        select(DialogMember.user_id).where(
            DialogMember.dialog_id.in_(my_dialogs), DialogMember.user_id != user_id
        )
    )
    return set(result.all())


async def get_users_by_ids(session: AsyncSession, user_ids: list[int]):
    if not user_ids:
        return []
    result = await session.scalars(select(User).where(User.id.in_(user_ids)))
    by_id = {u.id: u for u in result.all()}
    return [by_id[i] for i in user_ids if i in by_id]


def escape_like(text: str):
    # % и _ в LIKE — спецсимволы; экранируем, чтобы искать их буквально
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def search_new_contacts(session: AsyncSession, query: str, user_id: int, limit: int):
    """Ищет людей, которым можно отправить запрос на переписку.

    Без текста запроса ничего не отдаём: полного списка пользователей
    никто видеть не должен. Тех, с кем уже есть чат или запрос, пропускаем.
    """
    query = query.strip().lstrip("@")
    if not query:
        return []

    existing_peers = (
        select(DialogMember.user_id)
        .join(Dialog, Dialog.id == DialogMember.dialog_id)
        .where(
            Dialog.type == "direct",
            Dialog.id.in_(select(DialogMember.dialog_id).where(DialogMember.user_id == user_id)),
        )
    )
    pattern = escape_like(query)
    stmt = (
        select(User)
        .where(
            User.password_hash.is_not(None),
            User.id != user_id,
            User.id.not_in(existing_peers),
            or_(
                User.username.ilike(f"%{pattern}%", escape="\\"),
                User.display_name.ilike(f"%{pattern}%", escape="\\"),
            ),
        )
        # Сначала те, чьё имя начинается с введённого текста
        .order_by(
            case((User.username.ilike(f"{pattern}%", escape="\\"), 0), else_=1),
            User.username,
        )
        .limit(limit)
    )
    result = await session.scalars(stmt)
    return result.all()
