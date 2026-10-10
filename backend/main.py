from schema.server import Server
from fastapi import FastAPI, WebSocket


app = FastAPI()

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
    await websocket.accept()

    while True:
        message = await websocket.receive_text()

        await websocket.send_text("Сервер плучил")


if __name__ == "__main__":
    server = Server(2)
    server.start()

