import { useCallback, useEffect, useRef, useState } from 'react'
import { api, WS_URL, type Dialog, type Message, type ServerEvent, type User } from '../../api'
import { ConfirmDialog } from './ConfirmDialog'
import { DialogMenu } from './DialogMenu'
import { Highlight } from './Highlight'
import { NewChatDialog } from './NewChatDialog'
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

// Добавляет или заменяет чат и держит сверху чаты со свежими сообщениями
function upsertDialog(dialogs: Dialog[], dialog: Dialog) {
    const rest = dialogs.filter((d) => d.dialog_id !== dialog.dialog_id)
    return [dialog, ...rest].sort((a, b) => b.activity_at.localeCompare(a.activity_at))
}

function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function RemoveUserIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="9" cy="8" r="3.5" fill="currentColor" />
            <path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5z" fill="currentColor" />
            <path d="M16 10h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    )
}

function SearchIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    )
}

function AddUserIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="9" cy="8" r="3.5" fill="currentColor" />
            <path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5z" fill="currentColor" />
            <path d="M19 7v6M16 10h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    )
}

export function Chat({ user, onLogout }: Props) {
    const [dialogs, setDialogs] = useState<Dialog[]>([])
    const [activeId, setActiveId] = useState<number | null>(null)
    const [messagesByDialog, setMessagesByDialog] = useState<Record<number, Message[]>>({})
    const [text, setText] = useState('')
    const [search, setSearch] = useState<string | null>(null)
    const [isAdding, setIsAdding] = useState(false)
    const [removing, setRemoving] = useState<Dialog | null>(null)
    const [requestError, setRequestError] = useState<string | null>(null)
    const ws = useRef<WebSocket | null>(null)
    const messagesEnd = useRef<HTMLDivElement | null>(null)

    const addMessages = useCallback((dialogId: number, incoming: Message[]) => {
        setMessagesByDialog((prev) => ({
            ...prev,
            [dialogId]: mergeMessages(prev[dialogId], incoming),
        }))
    }, [])

    const handleEvent = useCallback((event: ServerEvent) => {
        if (event.type === 'message') {
            const { message } = event
            addMessages(message.dialog_id, [message])
            setDialogs((current) => {
                const dialog = current.find((d) => d.dialog_id === message.dialog_id)
                if (!dialog) return current
                return upsertDialog(current, {
                    ...dialog,
                    last_message: message.text,
                    last_message_at: message.created_at,
                    activity_at: message.created_at,
                })
            })
        } else if (event.type === 'dialog') {
            setDialogs((current) => upsertDialog(current, event.dialog))
        } else if (event.type === 'dialog_removed') {
            setDialogs((current) => current.filter((d) => d.dialog_id !== event.dialog_id))
            setActiveId((current) => (current === event.dialog_id ? null : current))
        }
    }, [addMessages])

    useEffect(() => {
        api<{ dialogs: Dialog[] }>('/dialogs')
            .then((data) => setDialogs(data.dialogs))
            .catch(console.error)
    }, [])

    useEffect(() => {
        const socket = new WebSocket(WS_URL)
        ws.current = socket

        socket.onmessage = (event) => handleEvent(JSON.parse(event.data))
        socket.onclose = (event) => {
            if (event.code === WS_POLICY_VIOLATION) onLogout()
        }

        return () => {
            socket.onclose = null
            socket.close()
        }
    }, [handleEvent, onLogout])

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

    function openDialog(dialogId: number) {
        setActiveId(dialogId)
        setRequestError(null)
    }

    function handleCreated(dialog: Dialog) {
        setDialogs((current) => upsertDialog(current, dialog))
        openDialog(dialog.dialog_id)
        setIsAdding(false)
    }

    async function answerRequest(dialog: Dialog, answer: 'accept' | 'decline') {
        setRequestError(null)
        try {
            if (answer === 'accept') {
                handleEvent({ type: 'dialog', dialog: await api<Dialog>(`/dialogs/${dialog.dialog_id}/accept`, { method: 'POST' }) })
            } else {
                await api(`/dialogs/${dialog.dialog_id}/decline`, { method: 'POST' })
                handleEvent({ type: 'dialog_removed', dialog_id: dialog.dialog_id })
            }
        } catch {
            setRequestError('Не получилось ответить на запрос, попробуйте ещё раз')
        }
    }

    async function removeDialog(dialog: Dialog) {
        await api(`/dialogs/${dialog.dialog_id}`, { method: 'DELETE' })
        handleEvent({ type: 'dialog_removed', dialog_id: dialog.dialog_id })
        setRemoving(null)
    }

    async function handleLogout() {
        await api('/auth/logout', { method: 'POST' }).catch(console.error)
        onLogout()
    }

    function handleSend() {
        if (!text.trim() || activeDialog?.status !== 'accepted') return
        if (ws.current?.readyState !== WebSocket.OPEN) return

        ws.current.send(JSON.stringify({ dialog_id: activeDialog.dialog_id, text }))
        setText('')
    }

    const query = search?.trim().toLowerCase() ?? ''
    const visibleDialogs = query
        ? dialogs.filter((d) => d.title.toLowerCase().includes(query))
        : dialogs
    const requests = visibleDialogs.filter((d) => d.is_incoming_request)
    const chats = visibleDialogs.filter((d) => !d.is_incoming_request)

    function renderItem(dialog: Dialog) {
        const isOutgoing = dialog.status === 'pending' && !dialog.is_incoming_request
        let preview = dialog.last_message ?? 'Нет сообщений'
        if (isOutgoing) preview = 'Ждёт ответа на запрос'
        else if (dialog.is_incoming_request && !dialog.last_message) preview = 'Хочет начать переписку'

        return (
            <button
                key={dialog.dialog_id}
                className={'chat__item' + (dialog.dialog_id === activeId ? ' chat__item--active' : '')}
                onClick={() => openDialog(dialog.dialog_id)}
            >
                <span className="chat__item-title"><Highlight text={dialog.title} query={query} /></span>
                <span className="chat__item-preview">
                    {preview}
                </span>
            </button>
        )
    }

    function renderFooter() {
        if (!activeDialog) return null

        if (activeDialog.is_incoming_request) {
            return (
                <footer className="chat__request">
                    <p>
                        <strong>{activeDialog.title}</strong> хочет начать с вами переписку
                    </p>
                    {requestError && <p className="chat__request-error" role="alert">{requestError}</p>}
                    <div className="chat__request-actions">
                        <button className="chat__decline" onClick={() => answerRequest(activeDialog, 'decline')}>
                            Отклонить
                        </button>
                        <button className="chat__accept" onClick={() => answerRequest(activeDialog, 'accept')}>
                            Принять
                        </button>
                    </div>
                </footer>
            )
        }

        if (activeDialog.status === 'pending') {
            return (
                <footer className="chat__request">
                    <p>
                        Запрос отправлен. Писать снова можно будет, когда{' '}
                        <strong>{activeDialog.title}</strong> его примет
                    </p>
                </footer>
            )
        }

        return (
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
        )
    }

    return (
        <div className="chat">

            <aside className="chat__sidebar">
                <div className="chat__sidebar-header">
                    <h2>Bonfire</h2>
                    <div className="chat__tools">
                        <button
                            className={'chat__icon-btn' + (search !== null ? ' chat__icon-btn--active' : '')}
                            onClick={() => setSearch((s) => (s === null ? '' : null))}
                            aria-label="Поиск по чатам"
                            aria-pressed={search !== null}
                            title="Поиск по чатам"
                        >
                            <SearchIcon />
                        </button>
                        <button
                            className="chat__icon-btn"
                            onClick={() => setIsAdding(true)}
                            aria-label="Добавить собеседника"
                            title="Добавить собеседника"
                        >
                            <AddUserIcon />
                        </button>
                    </div>
                </div>

                {search !== null && (
                    <input
                        className="chat__search"
                        type="search"
                        placeholder="Найти чат…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Escape' && setSearch(null)}
                        aria-label="Поиск по чатам"
                        autoFocus
                    />
                )}

                {requests.length > 0 && (
                    <nav className="chat__section" aria-label="Запросы">
                        <h3 className="chat__section-title">
                            Запросы <span className="chat__badge">{requests.length}</span>
                        </h3>
                        {requests.map(renderItem)}
                    </nav>
                )}

                <nav className="chat__section" aria-label="Чаты">
                    <h3 className="chat__section-title">Чаты</h3>
                    {chats.map(renderItem)}
                    {chats.length === 0 && (
                        <p className="chat__section-empty">
                            {query ? 'Ничего не найдено' : 'Пока пусто. Нажмите на иконку с плюсом, чтобы найти собеседника'}
                        </p>
                    )}
                </nav>

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
                {activeDialog ? (
                    <>
                        <header className="chat__header">
                            <h2>{activeDialog.title}</h2>
                            {activeDialog.status === 'pending' && (
                                <span className="chat__members">
                                    {activeDialog.is_incoming_request ? 'входящий запрос' : 'запрос отправлен'}
                                </span>
                            )}
                            {/* У входящего запроса для этого есть «Отклонить» */}
                            {!activeDialog.is_incoming_request && (
                                <div className="chat__header-actions">
                                    <DialogMenu
                                        items={[{
                                            label: activeDialog.status === 'pending' ? 'Отменить запрос' : 'Удалить собеседника',
                                            icon: <RemoveUserIcon />,
                                            danger: true,
                                            onSelect: () => setRemoving(activeDialog),
                                        }]}
                                    />
                                </div>
                            )}
                        </header>

                        <section className="chat__messages">
                            {/* Пока запрос не принят, писать всё равно нельзя */}
                            {historyLoaded && messages.length === 0 && activeDialog.status === 'accepted' && (
                                <p className="chat__empty">Сообщений пока нет — напишите первым</p>
                            )}
                            {messages.map((message) => {
                                const isOwn = message.user_id === user.user_id

                                return (
                                    <div
                                        key={message.message_id}
                                        className={'message' + (isOwn ? ' message--own' : '')}
                                    >
                                        <span className="message__text">{message.text}</span>
                                        <time className="message__time" dateTime={message.created_at}>
                                            {formatTime(message.created_at)}
                                        </time>
                                    </div>
                                )
                            })}
                            <div ref={messagesEnd} />
                        </section>

                        {renderFooter()}
                    </>
                ) : (
                    <div className="chat__placeholder">
                        <p>Выберите чат слева</p>
                        <button className="chat__accept" onClick={() => setIsAdding(true)}>
                            Написать новому собеседнику
                        </button>
                    </div>
                )}
            </main>

            {isAdding && <NewChatDialog onCreated={handleCreated} onClose={() => setIsAdding(false)} />}

            {removing && (
                <ConfirmDialog
                    title={removing.status === 'pending' ? 'Отменить запрос?' : 'Удалить собеседника?'}
                    confirmLabel={removing.status === 'pending' ? 'Отменить запрос' : 'Удалить'}
                    onConfirm={() => removeDialog(removing)}
                    onClose={() => setRemoving(null)}
                >
                    {removing.status === 'pending' ? (
                        <p>Запрос и сообщение к нему пропадут, а <strong>{removing.title}</strong> его так и не увидит.</p>
                    ) : (
                        <p>
                            <strong>{removing.title}</strong> пропадёт из ваших чатов, а переписка
                            удалится у вас обоих — восстановить её не получится. Чтобы снова
                            общаться, нужно будет отправить новый запрос.
                        </p>
                    )}
                </ConfirmDialog>
            )}
        </div>
    )
}
