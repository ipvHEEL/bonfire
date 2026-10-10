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

    return (
        <div className="chat">

            <aside className="chat__sidebar">
                <h2>chats</h2>

                <div className="chat__user">
                    {messages.map((message) => (
                        <div key={message.message_id}>
                            {message.user_name}
                        </div>
                    ))}
                </div>
            </aside>


            <main className="chat__main">

                <header className="chat__header">
                    <h2>Общий чат</h2>
                </header>

                
                <section className="chat__messages">
                    {messages.map((message) => (
                        <div key={message.message_id}>
                            {message.user_name}: {message.text}
                        </div>
                    ))}
                </section>


                <footer className="chat__input">

                    <input className='chat__input-field'
                        type="text"
                        placeholder="Введите сообщение..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    />
                        <button className='btn' onClick={handleSend}>
                            Отправить
                        </button>
                </footer>

            </main>

        </div>
    )
}