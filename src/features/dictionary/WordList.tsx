import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronDown, LayoutGrid, List, ListFilter } from 'lucide-react'
import { WordCard } from './WordCard'
import { useT } from '@/context/I18nContext'
import { cn } from '@/lib/cn'
import {
  PARTS_OF_SPEECH,
  type PartOfSpeech,
  type SortOrder,
  type ViewMode,
  type Word,
} from '@/types/domain'
import type { TranslationKey } from '@/i18n'

const SORTS: { value: SortOrder; key: TranslationKey }[] = [
  { value: 'newest', key: 'sort-newest' },
  { value: 'oldest', key: 'sort-oldest' },
  { value: 'az', key: 'sort-az' },
  { value: 'za', key: 'sort-za' },
]

const PAGE_SIZE = 15
/** "Show more" adds this many; rendering all 10,000 cards at once froze the page. */
const LOAD_MORE_STEP = 60

interface Props {
  words: Word[]
  totalCount: number
  query: string
  sort: SortOrder
  onSortChange: (sort: SortOrder) => void
  partOfSpeech: PartOfSpeech | 'all'
  onPartOfSpeechChange: (value: PartOfSpeech | 'all') => void
  editingId: string | null
  onEdit: (word: Word) => void
  onDelete: (word: Word) => void
  onMove: (word: Word) => void
  loading: boolean
}

function FilterMenu({
  value,
  onChange,
}: {
  value: PartOfSpeech | 'all'
  onChange: (value: PartOfSpeech | 'all') => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const options: { value: PartOfSpeech | 'all'; key: TranslationKey }[] = [
    { value: 'all', key: 'all-parts-of-speech' },
    ...PARTS_OF_SPEECH.map((pos) => ({ value: pos, key: pos as TranslationKey })),
  ]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={cn(
          'flex h-[38px] items-center gap-2 rounded-lg border px-3 text-[14px] font-medium transition',
          value === 'all'
            ? 'border-line text-fg hover:bg-surface-2'
            : 'border-brand/40 bg-brand-soft text-brand',
        )}
      >
        <ListFilter size={15} className={value === 'all' ? 'text-fg-muted' : 'text-brand'} />
        {t('filter')}
      </button>

      {open && (
        <div className="absolute right-0 top-[44px] z-30 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop animate-slide-up">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm text-fg transition hover:bg-surface-2"
            >
              {t(option.key)}
              {value === option.value && <Check size={15} className="text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function WordList({
  words,
  totalCount,
  query,
  sort,
  onSortChange,
  partOfSpeech,
  onPartOfSpeechChange,
  editingId,
  onEdit,
  onDelete,
  onMove,
  loading,
}: Props) {
  const t = useT()
  const [view, setView] = useState<ViewMode>('list')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const visible = words.slice(0, limit)
  const remaining = words.length - visible.length

  return (
    <section className="flex h-full flex-col rounded-card border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-[18px]">
        <h2 className="text-[20px] font-bold tracking-[-0.01em] text-fg">
          {t('your-words')} ({totalCount})
        </h2>

        <div className="flex items-center gap-3">
          <FilterMenu value={partOfSpeech} onChange={onPartOfSpeechChange} />

          <span className="text-[14px] text-fg-muted">{t('sort-by')}</span>

          <div className="relative">
            <select
              value={sort}
              onChange={(event) => onSortChange(event.target.value as SortOrder)}
              aria-label={t('sort-by')}
              className="h-[38px] appearance-none rounded-lg border border-line bg-surface py-0 pl-3 pr-9 text-[14px] font-medium text-fg transition hover:bg-surface-2 focus:border-brand focus:outline-none focus:ring-0"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.key)}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted"
            />
          </div>

          <div className="flex h-[38px] items-center rounded-lg border border-line p-[3px]">
            <button
              type="button"
              onClick={() => setView('list')}
              aria-label={t('view-list')}
              aria-pressed={view === 'list'}
              className={cn(
                'flex h-full w-[32px] items-center justify-center rounded-md transition',
                view === 'list' ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:text-fg',
              )}
            >
              <List size={16} />
            </button>
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-label={t('view-grid')}
              aria-pressed={view === 'grid'}
              className={cn(
                'flex h-full w-[32px] items-center justify-center rounded-md transition',
                view === 'grid' ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:text-fg',
              )}
            >
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 pb-2">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-[116px] animate-pulse rounded-[10px] bg-surface-2" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
            <p className="text-[16px] font-semibold text-fg">
              {query ? t('empty-search-title') : t('empty-title')}
            </p>
            <p className="mt-1.5 max-w-xs text-[14px] text-fg-muted">
              {query ? t('empty-search-body', { query }) : t('empty-body')}
            </p>
          </div>
        ) : (
          <div
            className={cn(
              view === 'grid'
                ? 'grid grid-cols-1 gap-[var(--list-gap)] xl:grid-cols-2'
                : 'flex flex-col gap-[var(--list-gap)]',
            )}
          >
            {visible.map((word) => (
              <WordCard
                key={word.id}
                word={word}
                isEditing={editingId === word.id}
                onEdit={onEdit}
                onDelete={onDelete}
                onMove={onMove}
              />
            ))}
          </div>
        )}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setLimit((prev) => prev + LOAD_MORE_STEP)}
          className="mt-1 flex items-center justify-center gap-2 border-t border-line py-4 text-[14px] font-medium text-fg-muted transition hover:text-brand"
        >
          {t('show-more-words', { n: remaining })}
          <ArrowRight size={15} />
        </button>
      )}
    </section>
  )
}
