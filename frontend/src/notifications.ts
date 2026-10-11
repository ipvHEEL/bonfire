// Системные уведомления через стандартный Notification API.
// В браузере это обычные уведомления сайта, а в десктоп-клиенте Tauri
// подменяет window.Notification на уведомления Windows — код один и тот же

const supported = typeof window !== 'undefined' && 'Notification' in window

// Браузер спрашивает разрешение только в ответ на действие пользователя,
// поэтому просим его при первом клике или нажатии клавиши после входа
export function requestPermissionOnFirstInteraction() {
    if (!supported || Notification.permission !== 'default') return () => {}

    function ask() {
        cleanup()
        if (Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    }
    function cleanup() {
        window.removeEventListener('pointerdown', ask)
        window.removeEventListener('keydown', ask)
    }
    window.addEventListener('pointerdown', ask)
    window.addEventListener('keydown', ask)
    return cleanup
}

// Пользователь сейчас смотрит на приложение
export function isAppVisible() {
    return !document.hidden && document.hasFocus()
}

type NotifyOptions = {
    title: string
    body: string
    // Уведомления с одинаковым tag заменяют друг друга, а не копятся пачкой
    tag: string
    onClick?: () => void
}

export function notify({ title, body, tag, onClick }: NotifyOptions) {
    if (!supported || Notification.permission !== 'granted') return
    try {
        const notification = new Notification(title, { body, tag, icon: '/favicon.svg' })
        if (notification && onClick) {
            notification.onclick = () => {
                window.focus()
                onClick()
                notification.close?.()
            }
        }
    } catch {
        // Некоторые мобильные браузеры не дают создавать уведомления напрямую
    }
}
