import json
import os
from urllib.parse import urlparse

from schema.connection_manager import manager
from schema import events
from auth.security import COOKIE_NAME, read_token
from db.database import SessionLocal
from db import dialogs as dialogs_db
from db import messages as messages_db
from db import users as users_db
from routers import auth, dialogs
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(dialogs.router)


def is_same_origin(websocket: WebSocket):
    # Браузер сам прикладывает cookie к вебсокету с любого сайта,
    # поэтому пускаем только страницы с нашего же адреса
    origin = websocket.headers.get("origin")
    host = websocket.headers.get("host")
    return origin is not None and urlparse(origin).netloc == host


@app.websocket('/ws')
async def websocket_start(websocket: WebSocket):
    async with SessionLocal() as session:
        user_id = read_token(websocket.cookies.get(COOKIE_NAME))
        user = await users_db.get_user(session, user_id) if user_id else None

    if user is None or user.password_hash is None or not is_same_origin(websocket):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(user.id, websocket)

    try:
        while True:
            try:
                data = json.loads(await websocket.receive_text())
            except json.JSONDecodeError:
                continue
            if not isinstance(data, dict):
                continue

            text = str(data.get("text", "")).strip()
            dialog_id = data.get("dialog_id")
            if not text or not isinstance(dialog_id, int):
                continue

            async with SessionLocal() as session:
                dialog = await dialogs_db.get_dialog(session, dialog_id)
                member_ids = {m.id for m in dialog.members} if dialog else set()
                # Пока запрос не принят, писать нельзя: первое сообщение
                # уже ушло вместе с запросом
                if user.id not in member_ids or dialog.status != "accepted":
                    continue
                message = await messages_db.create_message(session, dialog_id, user.id, text)

            await events.send_message(member_ids, message)
    except WebSocketDisconnect:
        manager.disconnect(user.id, websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", reload=True)
