import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client'
import { LIVEKIT_URL, type Call } from '../../api'
import './Call.css'

type Props = {
    call: Call
    // Имя собеседника
    title: string
    // Пропуск в комнату LiveKit. Пока его нет, мы не в разговоре
    token: string | null
    isIncoming: boolean
    onAccept: () => void
    onDecline: () => void
    onHangup: () => void
    onError: (message: string) => void
}

function formatDuration(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

function PhoneIcon({ down = false }: { down?: boolean }) {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
             style={down ? { transform: 'rotate(135deg)' } : undefined}>
            <path
                fill="currentColor"
                d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.25 1z"
            />
        </svg>
    )
}

function MicIcon({ muted }: { muted: boolean }) {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  d="M19 11a7 7 0 0 1-14 0M12 18v3" />
            {muted && <path stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M4 4l16 16" />}
        </svg>
    )
}

export function CallPanel({ call, title, token, isIncoming, onAccept, onDecline, onHangup, onError }: Props) {
    const [connected, setConnected] = useState(false)
    const [peerJoined, setPeerJoined] = useState(false)
    const [muted, setMuted] = useState(false)
    const [speaking, setSpeaking] = useState<{ me: boolean, peer: boolean }>({ me: false, peer: false })
    const [audioBlocked, setAudioBlocked] = useState(false)
    const [now, setNow] = useState(() => Date.now())
    const roomRef = useRef<Room | null>(null)
    // Колбэки могут меняться при каждом рендере, а соединение — нет
    const onErrorRef = useRef(onError)
    const onHangupRef = useRef(onHangup)
    useEffect(() => {
        onErrorRef.current = onError
        onHangupRef.current = onHangup
    })

    useEffect(() => {
        if (!token) return

        const room = new Room({ adaptiveStream: true, dynacast: true })
        roomRef.current = room
        // Звук собеседника проигрываем через скрытые <audio>, их создаёт LiveKit
        const audioElements: HTMLMediaElement[] = []

        room
            .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
                if (track.kind !== Track.Kind.Audio) return
                const element = track.attach()
                audioElements.push(element)
                document.body.appendChild(element)
            })
            .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
                track.detach().forEach((el) => el.remove())
            })
            .on(RoomEvent.ParticipantConnected, () => setPeerJoined(true))
            .on(RoomEvent.ParticipantDisconnected, () => setPeerJoined(room.remoteParticipants.size > 0))
            .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
                setSpeaking({
                    me: speakers.some((p) => p.identity === room.localParticipant.identity),
                    peer: speakers.some((p) => p.identity !== room.localParticipant.identity),
                })
            })
            // Браузер может запретить звук без нажатия пользователя
            .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio))
            .on(RoomEvent.Disconnected, () => setConnected(false))

        let cancelled = false
        async function connect() {
            try {
                await room.connect(LIVEKIT_URL, token!)
                if (cancelled) return
                setConnected(true)
                setPeerJoined(room.remoteParticipants.size > 0)
                setAudioBlocked(!room.canPlaybackAudio)
            } catch {
                if (cancelled) return
                // Без соединения звонок бесполезен: завершаем, чтобы собеседник не ждал
                onErrorRef.current('Не удалось подключиться к звонку. Проверьте сеть')
                onHangupRef.current()
                return
            }
            try {
                await room.localParticipant.setMicrophoneEnabled(true)
            } catch {
                if (cancelled) return
                // Без микрофона всё равно можно слушать: остаёмся в звонке
                // с выключенным звуком, кнопка микрофона попробует ещё раз
                setMuted(true)
                onErrorRef.current('Нет доступа к микрофону — вас не слышно. Разрешите его в настройках браузера')
            }
        }
        connect()

        return () => {
            cancelled = true
            room.disconnect()
            audioElements.forEach((el) => el.remove())
            roomRef.current = null
        }
    }, [token])

    // Таймер разговора
    const isTalking = call.status === 'active' && call.answered_at !== null
    useEffect(() => {
        if (!isTalking) return
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [isTalking])

    async function toggleMute() {
        const room = roomRef.current
        if (!room) return
        try {
            await room.localParticipant.setMicrophoneEnabled(muted)
            setMuted(!muted)
        } catch {
            onError('Нет доступа к микрофону — вас не слышно. Разрешите его в настройках браузера')
        }
    }

    let statusText = 'Подключение…'
    if (isIncoming) statusText = 'Входящий звонок'
    else if (call.status === 'ringing') statusText = 'Вызов…'
    else if (!token) statusText = 'Идёт звонок'
    else if (isTalking && peerJoined) {
        statusText = formatDuration(Math.max(0, Math.floor((now - Date.parse(call.answered_at!)) / 1000)))
    } else if (connected) statusText = 'Ждём собеседника…'

    return (
        <section className="call" aria-label={`Звонок: ${title}`}>
            <div className={'call__avatar' + (speaking.peer ? ' call__avatar--speaking' : '')} aria-hidden="true">
                {title.slice(0, 1).toUpperCase()}
            </div>
            <div className="call__info">
                <strong className="call__name">{title}</strong>
                <span className="call__status" aria-live="polite">{statusText}</span>
            </div>

            {audioBlocked && (
                <button className="call__unblock" onClick={() => roomRef.current?.startAudio()}>
                    Включить звук
                </button>
            )}

            <div className="call__controls">
                {isIncoming ? (
                    <>
                        <button className="call__btn call__btn--decline" onClick={onDecline}
                                aria-label="Отклонить" title="Отклонить">
                            <PhoneIcon down />
                        </button>
                        <button className="call__btn call__btn--accept" onClick={onAccept}
                                aria-label="Принять" title="Принять">
                            <PhoneIcon />
                        </button>
                    </>
                ) : !token ? (
                    // Звонок идёт, но мы не в нём — например, перезагрузили страницу
                    <>
                        <button className="call__btn call__btn--decline" onClick={onHangup}
                                aria-label="Завершить" title="Завершить">
                            <PhoneIcon down />
                        </button>
                        <button className="call__btn call__btn--accept" onClick={onAccept}
                                aria-label="Вернуться в звонок" title="Вернуться в звонок">
                            <PhoneIcon />
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            className={'call__btn call__btn--mute' + (muted ? ' call__btn--muted' : '')
                                + (speaking.me && !muted ? ' call__btn--speaking' : '')}
                            onClick={toggleMute}
                            aria-pressed={muted}
                            aria-label={muted ? 'Включить микрофон' : 'Выключить микрофон'}
                            title={muted ? 'Включить микрофон' : 'Выключить микрофон'}
                            disabled={!connected}
                        >
                            <MicIcon muted={muted} />
                        </button>
                        <button className="call__btn call__btn--decline" onClick={onHangup}
                                aria-label="Завершить" title="Завершить">
                            <PhoneIcon down />
                        </button>
                    </>
                )}
            </div>
        </section>
    )
}
