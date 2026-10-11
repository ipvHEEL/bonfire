import json
import os

from schema.connection_manager import ConnectionManager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
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
def get_users():
    return {
        "users": [
            {
                "user_id": "1",
                "user_name": "user1"
            },
            {
                "user_id": "2",
                "user_name": "user2"
            }
        ]
    }

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
            if not text:
                continue

            await manager.broadcast({
                "dialog_id": data.get("dialog_id", 1),
                "message_id": manager.next_message_id(),
                "text": text,
                "user_name": data.get("user_name", "anonymous"),
            })
    except WebSocketDisconnect:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", reload=True)
