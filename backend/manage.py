"""Служебные команды сервера.

На сервере (из папки с docker-compose.yml):
    docker compose exec backend python manage.py invite --note "Петя"
    docker compose exec backend python manage.py invite --count 5 --days 7
    docker compose exec backend python manage.py invites
"""
import argparse
import asyncio
from datetime import datetime, timezone

from db import invites as invites_db
from db.database import SessionLocal


async def create(count: int, note: str | None, days: int | None):
    async with SessionLocal() as session:
        invites = await invites_db.create_invites(session, count, note, days)
    expires = f", действует {days} дн." if days else ", бессрочный"
    print(f"Инвайт-коды{expires} — каждый на одну регистрацию:")
    for invite in invites:
        print(f"  {invite.code}" + (f"  ({note})" if note else ""))


async def show():
    async with SessionLocal() as session:
        rows = await invites_db.list_invites(session)
    if not rows:
        print("Инвайтов ещё нет")
        return
    for invite, username in rows:
        if username:
            state = f"использован: @{username}"
        elif invite.expires_at and invite.expires_at < datetime.now(timezone.utc):
            state = "просрочен"
        else:
            state = "свободен" + (f" до {invite.expires_at:%d.%m.%Y}" if invite.expires_at else "")
        print(f"{invite.code}  {state}" + (f"  — {invite.note}" if invite.note else ""))


def main():
    parser = argparse.ArgumentParser(description="Служебные команды Bonfire")
    commands = parser.add_subparsers(dest="command", required=True)

    invite = commands.add_parser("invite", help="создать инвайт-коды")
    invite.add_argument("--count", type=int, default=1, help="сколько кодов (по умолчанию 1)")
    invite.add_argument("--note", help="кому отдаёте, для себя")
    invite.add_argument("--days", type=int, help="срок действия в днях (по умолчанию бессрочно)")

    commands.add_parser("invites", help="список инвайтов")

    args = parser.parse_args()
    if args.command == "invite":
        asyncio.run(create(max(1, min(args.count, 50)), args.note, args.days))
    else:
        asyncio.run(show())


if __name__ == "__main__":
    main()
