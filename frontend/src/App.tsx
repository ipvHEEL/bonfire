import { useCallback, useEffect, useState } from 'react'
import './App.css'

import { api, type User } from './api'
import { AuthPage } from './components/Auth/AuthPage'
import { Chat } from './components/Chat/Chat'

function App() {
    // undefined — ещё проверяем сессию, null — не вошли
    const [user, setUser] = useState<User | null | undefined>(undefined)

    useEffect(() => {
        api<User>('/auth/me')
            .then(setUser)
            .catch(() => setUser(null))
    }, [])

    const handleLogout = useCallback(() => setUser(null), [])

    if (user === undefined) return null
    if (user === null) return <AuthPage onAuth={setUser} />

    return (
        <Chat key={user.user_id} user={user} onLogout={handleLogout} />
    )
}

export default App
