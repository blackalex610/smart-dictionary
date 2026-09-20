import { Layers, Play } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useT } from '@/context/I18nContext'
import { useDictionaries } from '@/hooks/useDictionaries'

export function FlashcardsPage() {
  const t = useT()
  const navigate = useNavigate()
  const { data: dictionaries = [], isLoading } = useDictionaries()

  const start = (dictionaryId?: string) => {
    navigate(dictionaryId ? `/app/review?dictionary_id=${dictionaryId}` : '/app/review')
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4 pt-8">
        <div>
          <h1 className="flex items-center gap-2.5 text-[26px] font-bold tracking-[-0.01em] text-fg">
            <Layers size={24} className="text-brand" />
            {t('flashcards-title')}
          </h1>
          <p className="mt-1.5 text-[14.5px] text-fg-muted">{t('flashcards-subtitle')}</p>
        </div>
      </header>

      <section className="mt-6 rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="text-[15px] font-semibold text-fg">{t('select-words-label')}</h2>

        {isLoading ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-[52px] animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        ) : dictionaries.length === 0 ? (
          <p className="py-10 text-center text-[14.5px] text-fg-muted">{t('empty-body')}</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => start()}
              className="flex items-center justify-between rounded-[10px] border border-line bg-surface-2 px-4 py-3.5 text-left transition hover:border-brand"
            >
              <span className="text-[14.5px] font-medium text-fg">{t('flashcards-all-words')}</span>
              <Play size={16} className="text-brand" />
            </button>
            {dictionaries.map((dictionary) => (
              <button
                key={dictionary.id}
                type="button"
                onClick={() => start(dictionary.id)}
                className="flex items-center justify-between rounded-[10px] border border-line bg-surface-2 px-4 py-3.5 text-left transition hover:border-brand"
              >
                <span className="text-[14.5px] font-medium text-fg">{dictionary.name}</span>
                <span className="text-[13px] text-fg-muted">
                  {t('flashcards-due-count', { n: dictionary.due_count })}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
