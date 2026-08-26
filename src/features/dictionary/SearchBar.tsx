import { useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { useT } from '@/context/I18nContext'

interface Props {
  value: string
  onChange: (value: string) => void
}

export function SearchBar({ value, onChange }: Props) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex h-[52px] items-center gap-3 rounded-card border border-line bg-surface px-5 shadow-card">
      <Search size={19} className="shrink-0 text-fg-subtle" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('search-placeholder')}
        aria-label={t('search-placeholder')}
        className="h-full flex-1 border-0 bg-transparent p-0 text-[15px] text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="shrink-0 rounded-md border border-line bg-surface-2 px-2 py-1 text-[11.5px] font-medium text-fg-subtle">
        {t('search-shortcut')}
      </kbd>
    </div>
  )
}
