import { useState } from 'react'
import './Chat.css'

export function Chat() {
    const [messages, setMessages] = useState([
        { dialog_id: 1, message_id: 1, text: "Привет", user_name: "user1" },
        { dialog_id: 1, message_id: 2, text: "Привет, как дела?", user_name: "user2" },
    ])

    const [text, setText] = useState('')

    function handleSend(){
        if (!text.trim()) return;

        setMessages([
            ...messages,
            { dialog_id: 1, message_id: messages.length + 1, text: text, user_name: "user1" }
        ])
        setText('')
    }

    return (
        <div className="chat">

            <aside className="chat__sidebar">
                <h2>chats</h2>

                <div className="chat__user">
                    {messages.map((message) => (
                        <div key={message.dialog_id}>
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
                        <div key={message.dialog_id}>
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
                        <button className='btn'>
                            Отправить
                        </button>
                </footer>

            </main>

        </div>
    )
}