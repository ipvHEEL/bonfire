// Подсвечивает совпадение с поисковым запросом
export function Highlight({ text, query }: { text: string, query: string }) {
    const index = query ? text.toLowerCase().indexOf(query) : -1
    if (index === -1) return <>{text}</>

    return (
        <>
            {text.slice(0, index)}
            <mark className="chat__match">{text.slice(index, index + query.length)}</mark>
            {text.slice(index + query.length)}
        </>
    )
}
