import { useState, type FormEvent } from 'react'
import { api, ApiError, type User } from '../../api'
import './AuthPage.css'

type Mode = 'login' | 'register'

type Props = {
    onAuth: (user: User) => void
}

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/

function validate(mode: Mode, username: string, password: string) {
    if (mode === 'login') {
        return username && password ? null : 'Введите имя пользователя и пароль'
    }
    if (!USERNAME_PATTERN.test(username)) {
        return 'Имя: от 3 до 32 символов — латиница, цифры и _'
    }
    if (password.length < 8) {
        return 'Пароль должен быть не короче 8 символов'
    }
    return null
}

export function AuthPage({ onAuth }: Props) {
    const [mode, setMode] = useState<Mode>('login')
    const [username, setUsername] = useState('')
    const [displayName, setDisplayName] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const isRegister = mode === 'register'

    function switchMode(next: Mode) {
        setMode(next)
        setError(null)
    }

    async function handleSubmit(event: FormEvent) {
        event.preventDefault()

        const validationError = validate(mode, username.trim(), password)
        if (validationError) {
            setError(validationError)
            return
        }

        setLoading(true)
        setError(null)
        try {
            const user = await api<User>(isRegister ? '/auth/register' : '/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    username: username.trim(),
                    password,
                    ...(isRegister && { display_name: displayName.trim() || null }),
                }),
            })
            onAuth(user)
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Сервер недоступен, попробуйте позже')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth">
            <div className="auth__card">
                <div className="auth__brand">
                    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
                        <path
                            d="M12 2c.5 3.2-1.4 5-3 6.8C7.4 10.6 6 12.4 6 15a6 6 0 0 0 12 0c0-2.2-1-4-2.2-5.4-.3 1.5-1 2.6-2.3 3.2.4-3.6-.6-7.6-1.5-10.8z"
                            fill="currentColor"
                        />
                    </svg>
                    <h1>Bonfire</h1>
                </div>

                <div className="auth__tabs" role="tablist">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={!isRegister}
                        className={'auth__tab' + (!isRegister ? ' auth__tab--active' : '')}
                        onClick={() => switchMode('login')}
                    >
                        Вход
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={isRegister}
                        className={'auth__tab' + (isRegister ? ' auth__tab--active' : '')}
                        onClick={() => switchMode('register')}
                    >
                        Регистрация
                    </button>
                </div>

                <form className="auth__form" onSubmit={handleSubmit} noValidate>
                    <label className="auth__field">
                        <span>Имя пользователя</span>
                        <input
                            className="auth__input"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="username"
                            autoFocus
                            maxLength={32}
                        />
                        {isRegister && (
                            <small className="auth__hint">Латиница, цифры и _, от 3 до 32 символов</small>
                        )}
                    </label>

                    {isRegister && (
                        <label className="auth__field">
                            <span>Как вас показывать в чате <em>(необязательно)</em></span>
                            <input
                                className="auth__input"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                autoComplete="nickname"
                                maxLength={64}
                            />
                        </label>
                    )}

                    <label className="auth__field">
                        <span>Пароль</span>
                        <div className="auth__password">
                            <input
                                className="auth__input"
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete={isRegister ? 'new-password' : 'current-password'}
                                maxLength={128}
                            />
                            <button
                                type="button"
                                className="auth__toggle"
                                onClick={() => setShowPassword((v) => !v)}
                                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                            >
                                {showPassword ? 'Скрыть' : 'Показать'}
                            </button>
                        </div>
                        {isRegister && <small className="auth__hint">Не короче 8 символов</small>}
                    </label>

                    <p className="auth__error" role="alert">{error}</p>

                    <button className="auth__submit" type="submit" disabled={loading}>
                        {loading ? 'Подождите…' : isRegister ? 'Создать аккаунт' : 'Войти'}
                    </button>
                </form>
            </div>
        </div>
    )
}
