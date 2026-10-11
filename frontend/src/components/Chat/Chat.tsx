import { useEffect, useRef, useState } from 'react'
import './Chat.css'

type Message = {
    dialog_id: number
    message_id: number
    text: string
    user_name: string
}

const WS_URL = "ws://localhost:8000/ws"

export function Chat() {
    const [messages, setMessages] = useState<Message[]>([])
    const [text, setText] = useState('')
    const [userName] = useState(() => `user${Math.floor(Math.random() * 1000)}`)
    const ws = useRef<WebSocket | null>(null)

    useEffect(() => {
        const socket = new WebSocket(WS_URL)
        ws.current = socket

        socket.onmessage = (event) => {
            const message: Message = JSON.parse(event.data)
            setMessages((prev) => [...prev, message])
        }

        return () => socket.close()
    }, [])

    function handleSend(){
        if (!text.trim()) return;
        if (ws.current?.readyState !== WebSocket.OPEN) return;

        ws.current.send(JSON.stringify({
            dialog_id: 1,
            text: text,
            user_name: userName,
        }))
        setText('')
    }

    const users = [...new Set(messages.map((message) => message.user_name))]
        .filter((user) => user !== userName)

    return (
        <div className="chat">

            <aside className="chat__sidebar">
                <h2>Bonfire</h2>

                <div className="chat__user">
                    {users.map((user) => (
                        <div key={user}>
                            {user}
                        </div>
                    ))}
                </div>
            </aside>


            <main className="chat__main">

                <header className="chat__header">
                    <h2>Общий чат</h2>
                </header>

                
                <section className="chat__messages">
                    {messages.map((message) => {
                        const isOwn = message.user_name === userName

                        return (
                            <div
                                key={message.message_id}
                                className={'message' + (isOwn ? ' message--own' : '')}
                            >
                                {!isOwn && (
                                    <span className="message__author">{message.user_name}</span>
                                )}
                                <span className="message__text">{message.text}</span>
                            </div>
                        )
                    })}
                </section>


                <footer className="chat__input">

                    <input className='chat__input-field'
                        type="text"
                        placeholder="Введите сообщение..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    />
                    <button
                        className="btn-send"
                        onClick={handleSend}
                        disabled={!text.trim()}
                        aria-label="Отправить"
                        title="Отправить"
                    >
                        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                            <path
                                d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87z"
                                fill="currentColor"
                            />
                        </svg>
                    </button>
                </footer>

            </main>

        </div>
    )
}