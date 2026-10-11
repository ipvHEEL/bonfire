import { useEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
    title: string
    children: ReactNode
    confirmLabel: string
    onConfirm: () => Promise<void>
    onClose: () => void
}

// Подтверждение необратимого действия. Кнопка действия красная,
// а фокус по умолчанию на «Отмене», чтобы случайный Enter ничего не удалил
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose }: Props) {
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const dialogRef = useRef<HTMLDialogElement | null>(null)
    const cancelRef = useRef<HTMLButtonElement | null>(null)

    useEffect(() => {
        dialogRef.current?.showModal()
        cancelRef.current?.focus()
    }, [])

    async function handleConfirm() {
        setLoading(true)
        setError(null)
        try {
            await onConfirm()
        } catch {
            setError('Не получилось, попробуйте ещё раз')
            setLoading(false)
        }
    }

    return (
        <dialog
            ref={dialogRef}
            className="new-chat confirm"
            onClose={onClose}
            onClick={(e) => e.target === dialogRef.current && onClose()}
            aria-labelledby="confirm-title"
        >
            <div className="new-chat__form">
                <h3 id="confirm-title">{title}</h3>
                <div className="new-chat__note">{children}</div>
                <p className="new-chat__error" role="alert">{error}</p>
                <div className="new-chat__actions">
                    <button ref={cancelRef} type="button" className="new-chat__cancel" onClick={onClose}>
                        Отмена
                    </button>
                    <button type="button" className="confirm__danger" onClick={handleConfirm} disabled={loading}>
                        {loading ? 'Удаляем…' : confirmLabel}
                    </button>
                </div>
            </div>
        </dialog>
    )
}
