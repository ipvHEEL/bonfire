from fastapi import WebSocket


class ConnectionManager:

    def __init__(self):
        self.clients: list[WebSocket] = []
        self.last_message_id = 0

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.clients.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.clients:
            self.clients.remove(websocket)

    def next_message_id(self):
        self.last_message_id += 1
        return self.last_message_id

    async def broadcast(self, message: dict):
        for client in self.clients.copy():
            try:
                await client.send_json(message)
            except Exception:
                self.disconnect(client)
