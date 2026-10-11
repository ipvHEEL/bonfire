import { useCallback, useEffect, useRef, useState } from 'react'
import { api, WS_URL, type Dialog, type Message, type User } from '../../api'
import './Chat.css'

type Props = {
    user: User
    onLogout: () => void
}

// Код закрытия, которым сервер отклоняет вебсокет без действующего входа
const WS_POLICY_VIOLATION = 1008

// История и новые сообщения из сокета могут прийти в любом порядке,
// поэтому объединяем по message_id без дублей и сортируем
function mergeMessages(current: Message[] = [], incoming: Message[]) {
    const byId = new Map(current.map((m) => [m.message_id, m]))
    for (const message of incoming) byId.set(message.message_id, message)
    return [...byId.values()].sort((a, b) => a.message_id - b.message_id)
}

function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function Chat({ user, onLogout }: Props) {
    const [dialogs, setDialogs] = useState<Dialog[]>([])
    const [people, setPeople] = useState<User[]>([])
    const [activeId, setActiveId] = useState<number | null>(null)
    const [messagesByDialog, setMessagesByDialog] = useState<Record<number, Message[]>>({})
    const [text, setText] = useState('')
    const ws = useRef<WebSocket | null>(null)
    const knownDialogIds = useRef(new Set<number>())
    const messagesEnd = useRef<HTMLDivElement | null>(null)

    const addMessages = useCallback((dialogId: number, incoming: Message[]) => {
        setMessagesByDialog((prev) => ({
            ...prev,
            [dialogId]: mergeMessages(prev[dialogId], incoming),
        }))
    }, [])

    const loadDialogs = useCallback(async () => {
        const data = await api<{ dialogs: Dialog[] }>('/dialogs')
        setDialogs(data.dialogs)
        setActiveId((current) => current ?? data.dialogs[0]?.dialog_id ?? null)
    }, [])

    useEffect(() => {
        knownDialogIds.current = new Set(dialogs.map((d) => d.dialog_id))
    }, [dialogs])

    useEffect(() => {
        loadDialogs().catch(console.error)
        api<{ users: User[] }>('/users')
            .then((data) => setPeople(data.users))
            .catch(console.error)
    }, [loadDialogs])

    useEffect(() => {
        const socket = new WebSocket(WS_URL)
        ws.current = socket

        socket.onmessage = (event) => {
            const message: Message = JSON.parse(event.data)
            addMessages(message.dialog_id, [message])
            // Кто-то впервые написал нам в личку — обновляем список чатов
            if (!knownDialogIds.current.has(message.dialog_id)) {
                loadDialogs().catch(console.error)
            }
        }

        socket.onclose = (event) => {
            if (event.code === WS_POLICY_VIOLATION) onLogout()
        }

        return () => {
            socket.onclose = null
            socket.close()
        }
    }, [addMessages, loadDialogs, onLogout])

    // Историю диалога загружаем при первом открытии
    const historyLoaded = activeId !== null && activeId in messagesByDialog
    useEffect(() => {
        if (activeId === null || historyLoaded) return

        const controller = new AbortController()
        api<{ messages: Message[] }>(`/dialogs/${activeId}/messages`, { signal: controller.signal })
            .then((data) => addMessages(activeId, data.messages))
            .catch((error) => {
                if (error.name !== 'AbortError') console.error('Не удалось загрузить историю', error)
            })
        return () => controller.abort()
    }, [activeId, historyLoaded, addMessages])

    const messages = activeId !== null ? messagesByDialog[activeId] ?? [] : []
    const activeDialog = dialogs.find((d) => d.dialog_id === activeId)

    useEffect(() => {
        messagesEnd.current?.scrollIntoView({ block: 'end' })
    }, [messages.length, activeId])

    async function openDirect(person: User) {
        const dialog = await api<Dialog>('/dialogs/direct', {
            method: 'POST',
            body: JSON.stringify({ user_id: person.user_id }),
        })
        setDialogs((current) =>
            current.some((d) => d.dialog_id === dialog.dialog_id) ? current : [...current, dialog]
        )
        setActiveId(dialog.dialog_id)
    }

    async function handleLogout() {
        await api('/auth/logout', { method: 'POST' }).catch(console.error)
        onLogout()
    }

    function handleSend() {
        if (!text.trim() || activeId === null) return
        if (ws.current?.readyState !== WebSocket.OPEN) return

        ws.current.send(JSON.stringify({ dialog_id: activeId, text }))
        setText('')
    }

    // Люди, с которыми ещё нет личного чата
    const peerIds = new Set(dialogs.map((d) => d.peer_user_id))
    const newPeople = people.filter((p) => !peerIds.has(p.user_id))

    return (
        <div className="chat">

            <aside className="chat__sidebar">
                <h2>Bonfire</h2>

                <nav className="chat__section">
                    <h3 className="chat__section-title">Чаты</h3>
                    {dialogs.map((dialog) => (
                        <button
                            key={dialog.dialog_id}
                            className={'chat__item' + (dialog.dialog_id === activeId ? ' chat__item--active' : '')}
                            onClick={() => setActiveId(dialog.dialog_id)}
                        >
                            {dialog.title}
                        </button>
                    ))}
                </nav>

                {newPeople.length > 0 && (
                    <div className="chat__section">
                        <h3 className="chat__section-title">Написать</h3>
                        {newPeople.map((person) => (
                            <button
                                key={person.user_id}
                                className="chat__item"
                                onClick={() => openDirect(person).catch(console.error)}
                            >
                                {person.display_name}
                            </button>
                        ))}
                    </div>
                )}

                <div className="chat__profile">
                    <div className="chat__profile-name">
                        <strong>{user.display_name}</strong>
                        <span>@{user.username}</span>
                    </div>
                    <button className="chat__logout" onClick={handleLogout}>
                        Выйти
                    </button>
                </div>
            </aside>


            <main className="chat__main">

                <header className="chat__header">
                    <h2>{activeDialog?.title ?? 'Чат'}</h2>
                    {activeDialog?.type === 'group' && (
                        <span className="chat__members">Участников: {activeDialog.members_count}</span>
                    )}
                </header>


                <section className="chat__messages">
                    {historyLoaded && messages.length === 0 && (
                        <p className="chat__empty">Сообщений пока нет — напишите первым</p>
                    )}
                    {messages.map((message) => {
                        const isOwn = message.user_id === user.user_id

                        return (
                            <div
                                key={message.message_id}
                                className={'message' + (isOwn ? ' message--own' : '')}
                            >
                                {!isOwn && activeDialog?.type !== 'direct' && (
                                    <span className="message__author">{message.user_name}</span>
                                )}
                                <span className="message__text">{message.text}</span>
                                <time className="message__time" dateTime={message.created_at}>
                                    {formatTime(message.created_at)}
                                </time>
                            </div>
                        )
                    })}
                    <div ref={messagesEnd} />
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
