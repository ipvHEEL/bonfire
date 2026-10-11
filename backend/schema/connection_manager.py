from fastapi import WebSocket


class ConnectionManager:

    def __init__(self):
        # У одного пользователя может быть несколько вкладок
        self.clients: dict[int, set[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        self.clients.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket):
        sockets = self.clients.get(user_id)
        if sockets is None:
            return
        sockets.discard(websocket)
        if not sockets:
            del self.clients[user_id]

    async def send_to_users(self, user_ids: set[int], message: dict):
        for user_id in user_ids:
            for websocket in self.clients.get(user_id, set()).copy():
                try:
                    await websocket.send_json(message)
                except Exception:
                    self.disconnect(user_id, websocket)


# Один на всё приложение: им пользуются и вебсокет, и HTTP-эндпоинты
manager = ConnectionManager()
