import socket
import threading


class Server:

    def __init__(self, max_clients):
        self.server_sock = socket.socket(
            socket.AF_INET,
            socket.SOCK_STREAM
        )
        self.server_sock.bind(('127.0.0.1', 9090))
        self.server_sock.listen(max_clients)
        self.clients = []
        print("Сервер запущен и ждет подключения...")

    def broadcast(self, message, sender):
        for client in self.clients:
            if client != sender:
                try:
                    client.sendall(message)
                except:
                    self.clients.remove(client)

    def handle_client(self, conn, addr):
        print(f"Обработчик запущен для {addr}")
        while True:
            try:
                message = conn.recv(1024)
                if not message:
                    break
                print(f"{addr}: {message.decode('utf-8')}")
                self.broadcast(message, conn)
            except:
                break

        print(f"Клиент отключился: {addr}")

        if conn in self.clients:
            self.clients.remove(conn)

        conn.close()

    def start(self):
        while True:
            conn, addr = self.server_sock.accept()
            print(f"Подключен клиент: {addr}")
            self.clients.append(conn)

            client_thread = threading.Thread(
                target=self.handle_client,
                args=(conn, addr)
            )

            client_thread.start()