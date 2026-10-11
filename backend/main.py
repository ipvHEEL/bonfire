import json
import os

from schema.connection_manager import ConnectionManager
from db.database import SessionLocal
from db import messages as messages_db
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = ConnectionManager()

@app.get("/user")
async def get_users():
    async with SessionLocal() as session:
        users = await messages_db.get_users(session)

    return {
        "users": [
            {
                "user_id": str(user.id),
                "user_name": user.username
            }
            for user in users
        ]
    }

@app.get("/dialogs/{dialog_id}/messages")
async def get_messages(
    dialog_id: int,
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = None,
):
    async with SessionLocal() as session:
        messages = await messages_db.get_messages(session, dialog_id, limit, before_id)

    return {"messages": [messages_db.message_to_dict(m) for m in messages]}

@app.websocket('/ws')
async def websocket_start(websocket: WebSocket):
    await manager.connect(websocket)

    try:
        while True:
            try:
                data = json.loads(await websocket.receive_text())
            except json.JSONDecodeError:
                continue
            if not isinstance(data, dict):
                continue

            text = str(data.get("text", "")).strip()
            user_name = str(data.get("user_name", "")).strip() or "anonymous"
            dialog_id = data.get("dialog_id", 1)
            if not text or not isinstance(dialog_id, int):
                continue

            async with SessionLocal() as session:
                message = await messages_db.create_message(session, dialog_id, user_name, text)
            if message is None:
                continue

            await manager.broadcast(messages_db.message_to_dict(message))
    except WebSocketDisconnect:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", reload=True)
