import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { api, ApiError, type Dialog, type User } from '../../api'
import { Highlight } from './Highlight'

type Props = {
    onCreated: (dialog: Dialog) => void
    onClose: () => void
}

// Столько же отдаёт сервер в /users/search
const SEARCH_LIMIT = 10

type Lookup = {
    users: User[]
    // false — это лишь приблизительный результат, нужен запрос к серверу
    complete: boolean
}

function matches(user: User, query: string) {
    return user.username.toLowerCase().includes(query) || user.display_name.toLowerCase().includes(query)
}

// Тот же порядок, что на сервере: сначала имена, которые начинаются с запроса
function narrow(users: User[], query: string) {
    return users
        .filter((u) => matches(u, query))
        .sort((a, b) => {
            const aStarts = a.username.toLowerCase().startsWith(query) ? 0 : 1
            const bStarts = b.username.toLowerCase().startsWith(query) ? 0 : 1
            return aStarts - bStarts || a.username.localeCompare(b.username)
        })
}

// Ищем ответ без запроса к серверу. Всё, что содержит «mar», содержит и «ma»,
// поэтому если по «ma» сервер вернул меньше лимита — это полный список,
// и для «mar» его достаточно отфильтровать
function lookup(cache: Map<string, User[]>, query: string): Lookup | null {
    const exact = cache.get(query)
    if (exact) return { users: exact, complete: true }

    let partial: User[] | null = null
    let partialLength = 0
    for (const [cachedQuery, users] of cache) {
        if (!query.includes(cachedQuery)) continue
        if (users.length < SEARCH_LIMIT) return { users: narrow(users, query), complete: true }
        if (cachedQuery.length > partialLength) {
            partial = users
            partialLength = cachedQuery.length
        }
    }
    return partial ? { users: narrow(partial, query), complete: false } : null
}

export function NewChatDialog({ onCreated, onClose }: Props) {
    const [username, setUsername] = useState('')
    const [selected, setSelected] = useState<User | null>(null)
    const [randomPeople, setRandomPeople] = useState<User[]>([])
    const [cache, setCache] = useState(() => new Map<string, User[]>())
    const [isListOpen, setIsListOpen] = useState(true)
    const [activeIndex, setActiveIndex] = useState(0)
    const [text, setText] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const dialogRef = useRef<HTMLDialogElement | null>(null)
    const usernameRef = useRef<HTMLInputElement | null>(null)
    const textRef = useRef<HTMLTextAreaElement | null>(null)

    // showModal даёт затемнение фона и закрытие по Esc, но сам ставит фокус
    // на первое поле — поэтому фокус переводим уже после открытия
    useEffect(() => {
        dialogRef.current?.showModal()
        usernameRef.current?.focus()
    }, [])

    // Случайных людей берём один раз на открытие окна
    useEffect(() => {
        const controller = new AbortController()
        api<{ users: User[] }>('/users/suggestions', { signal: controller.signal })
            .then((data) => setRandomPeople(data.users))
            .catch((err) => {
                if (err.name !== 'AbortError') console.error('Не удалось загрузить подсказки', err)
            })
        return () => controller.abort()
    }, [])

    const query = username.trim().replace(/^@/, '').toLowerCase()
    const found = query ? lookup(cache, query) : null

    // К серверу идём, только если ответа нельзя получить из уже загруженного.
    // Предыдущий запрос отменяем, чтобы опоздавший ответ не затёр свежий
    const needsFetch = Boolean(query) && !selected && !found?.complete
    useEffect(() => {
        if (!needsFetch) return

        const controller = new AbortController()
        api<{ users: User[] }>(`/users/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
            .then((data) => setCache((prev) => new Map(prev).set(query, data.users)))
            .catch((err) => {
                if (err.name !== 'AbortError') console.error('Поиск не удался', err)
            })
        return () => controller.abort()
    }, [needsFetch, query])

    const options = query ? found?.users ?? [] : randomPeople
    const showList = isListOpen && !selected && options.length > 0
    const nothingFound = Boolean(query) && !selected && found?.complete && found.users.length === 0
    const active = Math.min(activeIndex, options.length - 1)

    function choose(user: User) {
        setSelected(user)
        setUsername(user.username)
        setIsListOpen(false)
        setError(null)
        textRef.current?.focus()
    }

    function handleUsernameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (!showList) return

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex((active + 1) % options.length)
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((active - 1 + options.length) % options.length)
        } else if (event.key === 'Enter') {
            event.preventDefault()
            choose(options[active])
        } else if (event.key === 'Escape') {
            // Первый Esc закрывает список, а не всё окно
            event.preventDefault()
            setIsListOpen(false)
        }
    }

    async function handleSubmit(event: FormEvent) {
        event.preventDefault()

        if (!selected) {
            setError('Выберите собеседника из списка')
            setIsListOpen(true)
            usernameRef.current?.focus()
            return
        }
        if (!text.trim()) {
            setError('Напишите сообщение к запросу')
            textRef.current?.focus()
            return
        }

        setLoading(true)
        setError(null)
        try {
            const dialog = await api<Dialog>('/dialogs/requests', {
                method: 'POST',
                body: JSON.stringify({ username: selected.username, text: text.trim() }),
            })
            onCreated(dialog)
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Сервер недоступен, попробуйте позже')
            setLoading(false)
        }
    }

    let hint = ''
    if (selected) hint = `Запрос получит ${selected.display_name}`
    else if (nothingFound) hint = 'Никого не нашли'

    return (
        <dialog
            ref={dialogRef}
            className="new-chat"
            onClose={onClose}
            onClick={(e) => e.target === dialogRef.current && onClose()}
            aria-labelledby="new-chat-title"
        >
            <form className="new-chat__form" onSubmit={handleSubmit}>
                <h3 id="new-chat-title">Новый собеседник</h3>
                <p className="new-chat__note">
                    Найдите человека по имени и отправьте запрос с одним сообщением.
                    Продолжить переписку можно будет, когда он его примет.
                </p>

                <div className="new-chat__field">
                    <label htmlFor="new-chat-username">Кому</label>
                    <div className="new-chat__combobox">
                        <input
                            id="new-chat-username"
                            ref={usernameRef}
                            className="new-chat__input"
                            value={username}
                            onChange={(e) => {
                                setUsername(e.target.value)
                                setSelected(null)
                                setIsListOpen(true)
                                setActiveIndex(0)
                            }}
                            onFocus={() => setIsListOpen(true)}
                            onBlur={() => setIsListOpen(false)}
                            onKeyDown={handleUsernameKeyDown}
                            placeholder="Начните вводить имя…"
                            autoComplete="off"
                            maxLength={33}
                            role="combobox"
                            aria-expanded={showList}
                            aria-controls="new-chat-suggestions"
                            aria-activedescendant={showList ? `new-chat-option-${active}` : undefined}
                        />
                        {selected && <span className="new-chat__selected" aria-hidden="true">✓</span>}

                        {showList && (
                            <ul id="new-chat-suggestions" className="new-chat__suggestions" role="listbox">
                                {!query && (
                                    <li className="new-chat__suggestions-title" role="presentation">
                                        Можно написать
                                    </li>
                                )}
                                {options.map((person, index) => (
                                    <li
                                        key={person.user_id}
                                        id={`new-chat-option-${index}`}
                                        role="option"
                                        aria-selected={index === active}
                                        className={'new-chat__option' + (index === active ? ' new-chat__option--active' : '')}
                                        // mousedown, а не click: иначе поле потеряет фокус раньше выбора
                                        onMouseDown={(e) => {
                                            e.preventDefault()
                                            choose(person)
                                        }}
                                        onMouseEnter={() => setActiveIndex(index)}
                                    >
                                        <span className="new-chat__option-name">
                                            <Highlight text={person.display_name} query={query} />
                                        </span>
                                        <span className="new-chat__option-username">
                                            @<Highlight text={person.username} query={query} />
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    {/* Строка всегда на месте, чтобы окно не прыгало, когда текст появляется */}
                    <small className="new-chat__hint" aria-live="polite">{hint}</small>
                </div>

                <label className="new-chat__field">
                    <span>Сообщение</span>
                    <textarea
                        ref={textRef}
                        className="new-chat__input new-chat__textarea"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Привет! Это …"
                        rows={3}
                        maxLength={4000}
                    />
                </label>

                <p className="new-chat__error" role="alert">{error}</p>

                <div className="new-chat__actions">
                    <button type="button" className="new-chat__cancel" onClick={onClose}>
                        Отмена
                    </button>
                    <button type="submit" className="new-chat__submit" disabled={loading}>
                        {loading ? 'Отправляем…' : 'Отправить запрос'}
                    </button>
                </div>
            </form>
        </dialog>
    )
}
