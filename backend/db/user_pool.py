import asyncio
import random
import time

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import User


class RandomUserPool:
    """Запас случайных id зарегистрированных пользователей в памяти.

    ORDER BY random() перебирает и сортирует всю таблицу, поэтому делать его
    на каждый запрос нельзя. Пул обновляется не чаще раза в `ttl` секунд,
    а каждый запрос берёт из него случайные id без обращения к базе.
    """

    def __init__(self, size: int = 500, ttl: float = 30):
        self.size = size
        self.ttl = ttl
        self.ids: list[int] = []
        self.loaded_at = 0.0
        self.lock = asyncio.Lock()

    def is_fresh(self):
        return time.monotonic() - self.loaded_at < self.ttl

    async def get(self, session: AsyncSession):
        if self.is_fresh():
            return self.ids

        # Пока один запрос обновляет пул, остальные ждут его, а не идут в базу
        async with self.lock:
            if not self.is_fresh():
                self.ids = await self.load(session)
                self.loaded_at = time.monotonic()
        return self.ids

    async def load(self, session: AsyncSession):
        lowest, highest = (await session.execute(select(func.min(User.id), func.max(User.id)))).one()
        if lowest is None:
            return []

        registered = User.password_hash.is_not(None)
        shuffle_all = (
            select(User.id).where(registered).order_by(func.random()).limit(self.size)
        )

        # Небольшой диапазон id дешевле перемешать целиком
        if highest - lowest + 1 <= self.size * 4:
            return list((await session.scalars(shuffle_all)).all())

        # Иначе — выборочно: берём случайные id из диапазона и проверяем их
        # по первичному ключу. Несуществующие (удалённые) просто отсеются
        probes = random.sample(range(lowest, highest + 1), self.size * 2)
        found = list((await session.scalars(
            select(User.id).where(User.id.in_(probes), registered).limit(self.size)
        )).all())

        # Если в диапазоне в основном дыры (много удалённых), выборка почти
        # ничего не находит — тогда перемешиваем целиком. Это не чаще раза в ttl
        if len(found) < self.size // 4:
            return list((await session.scalars(shuffle_all)).all())
        return found


user_pool = RandomUserPool()
