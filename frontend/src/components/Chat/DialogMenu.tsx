import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type MenuItem = {
    label: string
    icon?: ReactNode
    danger?: boolean
    onSelect: () => void
}

type Props = {
    items: MenuItem[]
}

function MoreIcon() {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="5" cy="12" r="2" fill="currentColor" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <circle cx="19" cy="12" r="2" fill="currentColor" />
        </svg>
    )
}

// Кнопка «⋯» с выпадающим меню действий над чатом
export function DialogMenu({ items }: Props) {
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const buttonRef = useRef<HTMLButtonElement | null>(null)
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

    // Закрываем по клику мимо меню
    useEffect(() => {
        if (!open) return

        function handlePointerDown(event: PointerEvent) {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('pointerdown', handlePointerDown)
        itemRefs.current[0]?.focus()
        return () => document.removeEventListener('pointerdown', handlePointerDown)
    }, [open])

    function close() {
        setOpen(false)
        buttonRef.current?.focus()
    }

    function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const index = itemRefs.current.findIndex((el) => el === document.activeElement)

        if (event.key === 'Escape') {
            event.preventDefault()
            close()
        } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            itemRefs.current[(index + 1) % items.length]?.focus()
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            itemRefs.current[(index - 1 + items.length) % items.length]?.focus()
        } else if (event.key === 'Tab') {
            setOpen(false)
        }
    }

    return (
        <div className="menu" ref={rootRef}>
            <button
                ref={buttonRef}
                className={'chat__icon-btn' + (open ? ' chat__icon-btn--active' : '')}
                onClick={() => setOpen((v) => !v)}
                aria-label="Действия с чатом"
                title="Действия с чатом"
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <MoreIcon />
            </button>

            {open && (
                <div className="menu__list" role="menu" onKeyDown={handleMenuKeyDown}>
                    {items.map((item, index) => (
                        <button
                            key={item.label}
                            ref={(el) => { itemRefs.current[index] = el }}
                            role="menuitem"
                            className={'menu__item' + (item.danger ? ' menu__item--danger' : '')}
                            onClick={() => {
                                setOpen(false)
                                item.onSelect()
                            }}
                        >
                            {item.icon}
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
