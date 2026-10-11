export type User = {
    user_id: number
    username: string
    display_name: string
}

export type Dialog = {
    dialog_id: number
    title: string
    type: 'group' | 'direct'
    // pending — запрос на переписку ещё не принят
    status: 'pending' | 'accepted'
    // Запрос пришёл нам, и только мы можем его принять или отклонить
    is_incoming_request: boolean
    members_count: number
    // Собеседник в личном чате, null у групповых
    peer_user_id: number | null
    last_message: string | null
    last_message_at: string | null
    // Время последней активности: по нему сортируется список чатов
    activity_at: string
}

export type Message = {
    dialog_id: number
    message_id: number
    text: string
    user_id: number
    user_name: string
    created_at: string
}

export type Call = {
    call_id: number
    dialog_id: number
    // ringing — ещё не ответили, active — идёт разговор
    status: 'ringing' | 'active' | 'ended'
    started_by: number | null
    end_reason: 'completed' | 'cancelled' | 'declined' | 'missed' | 'interrupted' | null
    started_at: string
    answered_at: string | null
}

// Ответ на «позвонить» и «ответить»: звонок и пропуск в комнату LiveKit
export type CallJoin = {
    call: Call
    room: string
    token: string
}

// События, которые сервер присылает по вебсокету
export type ServerEvent =
    | { type: 'message', message: Message }
    | { type: 'dialog', dialog: Dialog }
    | { type: 'dialog_removed', dialog_id: number }
    | { type: 'call', call: Call }
    | { type: 'call_ended', call: Call }

export class ApiError extends Error {
    status: number

    constructor(status: number, message: string) {
        super(message)
        this.status = status
    }
}

// FastAPI отдаёт ошибку либо строкой, либо списком ошибок валидации
function readError(status: number, body: unknown) {
    const detail = (body as { detail?: unknown } | null)?.detail
    if (typeof detail === 'string') return detail
    if (status === 422) return 'Проверьте правильность заполнения полей'
    return 'Что-то пошло не так, попробуйте ещё раз'
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`/api${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
        credentials: 'same-origin',
    })

    const body = response.status === 204 ? null : await response.json().catch(() => null)
    if (!response.ok) throw new ApiError(response.status, readError(response.status, body))
    return body as T
}

const WS_PROTOCOL = location.protocol === 'https:' ? 'wss' : 'ws'
export const WS_URL = `${WS_PROTOCOL}://${location.host}/ws`
// Сигнальное соединение LiveKit идёт через тот же адрес, nginx передаёт его дальше
export const LIVEKIT_URL = `${WS_PROTOCOL}://${location.host}/livekit`
