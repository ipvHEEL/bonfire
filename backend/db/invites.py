import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Invite, User


# Без похожих символов (0/O, 1/I/L), чтобы код было легко продиктовать
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_code():
    groups = ["".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(3)]
    return "-".join(groups)


def normalize_code(code: str):
    # Принимаем код в любом регистре, с пробелами и без дефисов
    raw = "".join(ch for ch in code.upper() if ch in ALPHABET)
    return "-".join(raw[i:i + 4] for i in range(0, len(raw), 4))


async def create_invites(session: AsyncSession, count: int, note: str | None, days: int | None):
    expires_at = datetime.now(timezone.utc) + timedelta(days=days) if days else None
    invites = [Invite(code=generate_code(), note=note, expires_at=expires_at) for _ in range(count)]
    session.add_all(invites)
    await session.commit()
    return invites


async def list_invites(session: AsyncSession):
    result = await session.execute(
        select(Invite, User.username)
        .outerjoin(User, User.id == Invite.used_by)
        .order_by(Invite.id)
    )
    return result.all()


async def register_with_invite(
    session: AsyncSession, code: str, username: str, password_hash: str, display_name: str | None
):
    """Создаёт пользователя и гасит инвайт в одной транзакции.

    Возвращает пользователя или None, если код неверный, просрочен или уже
    использован. Условие used_by IS NULL в UPDATE не даёт потратить один код
    дважды, даже если два человека отправят его одновременно.
    """
    user = User(username=username, password_hash=password_hash, display_name=display_name)
    session.add(user)
    try:
        await session.flush()
    except IntegrityError:
        # Имя успели занять между проверкой и созданием
        await session.rollback()
        raise

    claimed = await session.scalar(
        update(Invite)
        .where(
            Invite.code == normalize_code(code),
            Invite.used_by.is_(None),
            or_(Invite.expires_at.is_(None), Invite.expires_at > func.now()),
        )
        .values(used_by=user.id, used_at=func.now())
        .returning(Invite.id)
    )
    if claimed is None:
        await session.rollback()
        return None

    await session.commit()
    return user
