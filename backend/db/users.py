from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import DialogMember, User


# Общий чат из первой миграции: в него попадает каждый новый пользователь
GENERAL_DIALOG_ID = 1


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
    await session.flush()
    session.add(DialogMember(dialog_id=GENERAL_DIALOG_ID, user_id=user.id))
    await session.commit()
    return user


async def get_registered_users(session: AsyncSession, exclude_user_id: int):
    result = await session.scalars(
        select(User)
        .where(User.password_hash.is_not(None), User.id != exclude_user_id)
        .order_by(User.username)
    )
    return result.all()
