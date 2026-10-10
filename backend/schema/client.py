import socket
import threading


class Client:

    def __init__(self):
        self.client_sock = socket.socket(
            socket.AF_INET,
            socket.SOCK_STREAM
        )
        self.client_sock.connect(('127.0.0.1', 9090))

    def receive_messages(self):
        while True:
            try:
                data = self.client_sock.recv(1024)
                if not data:
                    print("Сервер разорвал соединение")
                    break
                print(f"\nПолучено: {data.decode('utf-8')}")
            except:
                print("Соединение разорвано")
                break

    def send_messages(self):
        while True:
            message = input()
            if message == "stop":
                self.client_sock.close()
                break
            self.client_sock.sendall(
                message.encode('utf-8')
            )


if __name__ == "__main__":
    client = Client()
    receive_thread = threading.Thread(
        target=client.receive_messages
    )
    receive_thread.start()
    client.send_messages()