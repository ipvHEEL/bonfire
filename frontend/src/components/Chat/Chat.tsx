import { useEffect, useRef, useState } from 'react'
import './Chat.css'

type Message = {
    dialog_id: number
    message_id: number
    text: string
    user_name: string
    created_at: string
}

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
const DIALOG_ID = 1
const USER_NAME_KEY = 'bonfire:user_name'

function loadUserName() {
    try {
        const saved = localStorage.getItem(USER_NAME_KEY)
        if (saved) return saved
    } catch {
        // localStorage может быть недоступен (приватный режим)
    }

    const name = `user${Math.floor(Math.random() * 1000)}`
    try {
        localStorage.setItem(USER_NAME_KEY, name)
    } catch {
        // имя просто не сохранится между перезагрузками
    }
    return name
}

// История и новые сообщения из сокета могут прийти в любом порядке,
// поэтому объединяем по message_id без дублей и сортируем
function mergeMessages(current: Message[], incoming: Message[]) {
    const byId = new Map(current.map((m) => [m.message_id, m]))
    for (const message of incoming) byId.set(message.message_id, message)
    return [...byId.values()].sort((a, b) => a.message_id - b.message_id)
}

function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function Chat() {
    const [messages, setMessages] = useState<Message[]>([])
    const [text, setText] = useState('')
    const [userName] = useState(loadUserName)
    const ws = useRef<WebSocket | null>(null)

    useEffect(() => {
        const controller = new AbortController()

        fetch(`/api/dialogs/${DIALOG_ID}/messages`, { signal: controller.signal })
            .then((response) => response.json())
            .then((data: { messages: Message[] }) => {
                setMessages((prev) => mergeMessages(prev, data.messages))
            })
            .catch((error) => {
                if (error.name !== 'AbortError') console.error('Не удалось загрузить историю', error)
            })

        const socket = new WebSocket(WS_URL)
        ws.current = socket

        socket.onmessage = (event) => {
            const message: Message = JSON.parse(event.data)
            if (message.dialog_id !== DIALOG_ID) return
            setMessages((prev) => mergeMessages(prev, [message]))
        }

        return () => {
            controller.abort()
            socket.close()
        }
    }, [])

    function handleSend(){
        if (!text.trim()) return;
        if (ws.current?.readyState !== WebSocket.OPEN) return;

        ws.current.send(JSON.stringify({
            dialog_id: DIALOG_ID,
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
                                <time className="message__time" dateTime={message.created_at}>
                                    {formatTime(message.created_at)}
                                </time>
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