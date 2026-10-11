from fastapi import WebSocket


class ConnectionManager:

    def __init__(self):
        self.clients: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.clients.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.clients:
            self.clients.remove(websocket)

    async def broadcast(self, message: dict):
        for client in self.clients.copy():
            try:
                await client.send_json(message)
            except Exception:
                self.disconnect(client)
