import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useT } from '@/context/I18nContext'
import { cn } from '@/lib/cn'
import { PARTS_OF_SPEECH, type PartOfSpeech, type Word } from '@/types/domain'
import type { TranslationKey } from '@/i18n'

const PAGE_SIZE = 15

interface Props {
  words: Word[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  /** Restricts the pool — the verb-form quiz only works on verbs. */
  restrictTo?: PartOfSpeech
  className?: string
}

export function WordPicker({ words, selected, onChange, restrictTo, className }: Props) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<PartOfSpeech | 'all'>('all')
  const [page, setPage] = useState(0)

  const pool = useMemo(
    () => (restrictTo ? words.filter((w) => w.partOfSpeech === restrictTo) : words),
    [words, restrictTo],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return pool.filter((word) => {
      if (pos !== 'all' && word.partOfSpeech !== pos) return false
      if (!needle) return true
      return (
        word.word.toLowerCase().includes(needle) || word.definition.toLowerCase().includes(needle)
      )
    })
  }, [pool, query, pos])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  // Clamp during render instead of writing back via an effect: `page` can go
  // stale when a search/filter shrinks the result set, but the displayed
  // page is always derivable from `page` and `pageCount`, so there is
  // nothing here that needs to be synchronised after the fact.
  const currentPage = Math.min(page, pageCount - 1)

  const pageWords = visible.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  const selectAllVisible = () => {
    const next = new Set(selected)
    visible.forEach((word) => next.add(word.id))
    onChange(next)
  }

  const deselectAllVisible = () => {
    const next = new Set(selected)
    visible.forEach((word) => next.delete(word.id))
    onChange(next)
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(0)
            }}
            placeholder={t('flashcard-search-placeholder')}
            className="h-[38px] w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[14px] text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-0"
          />
        </div>

        {!restrictTo && (
          <select
            value={pos}
            onChange={(event) => {
              setPos(event.target.value as PartOfSpeech | 'all')
              setPage(0)
            }}
            aria-label={t('pos-filter-label')}
            className="h-[38px] rounded-lg border border-line bg-surface px-3 text-[14px] text-fg focus:border-brand focus:outline-none focus:ring-0"
          >
            <option value="all">{t('all-parts-of-speech')}</option>
            {PARTS_OF_SPEECH.map((value) => (
              <option key={value} value={value}>
                {t(value as TranslationKey)}
              </option>
            ))}
          </select>
        )}

        <Button variant="secondary" size="sm" onClick={selectAllVisible}>
          {t('select-all')}
        </Button>
        <Button variant="secondary" size="sm" onClick={deselectAllVisible}>
          {t('deselect-all')}
        </Button>
      </div>

      <div className="max-h-[300px] overflow-y-auto scrollbar-slim rounded-lg border border-line">
        {pageWords.length === 0 ? (
          <p className="px-4 py-8 text-center text-[14px] text-fg-muted">{t('picker-empty')}</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {pageWords.map((word) => {
              const checked = selected.has(word.id)
              return (
                <li key={word.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 px-3.5 py-2.5 transition',
                      checked ? 'bg-brand-soft/60' : 'hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(word.id)}
                      className="mt-[3px] h-[16px] w-[16px] rounded border-line text-brand focus:ring-brand"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold text-fg">{word.word}</span>
                      <span className="block truncate text-[13px] text-fg-muted">
                        {word.definition}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-md bg-surface-2 px-2 py-[2px] text-[12px] text-fg-muted">
                      {t(word.partOfSpeech as TranslationKey)}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between text-[13px] text-fg-muted">
        <span>{t('selected-count', { n: selected.size })}</span>
        {pageCount > 1 && (
          <span className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('previous')}
              disabled={currentPage === 0}
              onClick={() => setPage(Math.max(0, currentPage - 1))}
            >
              <ChevronLeft size={15} />
            </Button>
            <span className="tabular-nums">
              {currentPage + 1} / {pageCount}
            </span>
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('next')}
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
            >
              <ChevronRight size={15} />
            </Button>
          </span>
        )}
      </div>
    </div>
  )
}
