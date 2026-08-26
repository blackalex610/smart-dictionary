import { useState } from 'react'
import { Layers, Play } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { FlashcardModal } from '@/features/flashcards/FlashcardModal'
import { WordPicker } from '@/features/shared/WordPicker'
import { useT } from '@/context/I18nContext'
import { useWords } from '@/hooks/useWords'
import { shuffle } from '@/lib/shuffle'
import type { Word } from '@/types/domain'

export function FlashcardsPage() {
  const t = useT()
  const toast = useToast()
  const { data: words = [], isLoading } = useWords()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deck, setDeck] = useState<Word[] | null>(null)

  const start = () => {
    const chosen = words.filter((word) => selected.has(word.id))
    if (chosen.length === 0) {
      toast.push(t('err-select-word'), 'error')
      return
    }
    setDeck(shuffle(chosen))
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
        <Button size="lg" onClick={start} disabled={isLoading || words.length === 0}>
          <Play size={17} />
          {t('start-practice')}
        </Button>
      </header>

      <section className="mt-6 rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="text-[15px] font-semibold text-fg">{t('select-words-label')}</h2>

        {isLoading ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-[52px] animate-pulse rounded-lg bg-surface-2" />
            ))}
          </div>
        ) : words.length === 0 ? (
          <p className="py-10 text-center text-[14.5px] text-fg-muted">{t('empty-body')}</p>
        ) : (
          <WordPicker className="mt-4" words={words} selected={selected} onChange={setSelected} />
        )}
      </section>

      {deck && <FlashcardModal words={deck} onClose={() => setDeck(null)} />}
    </>
  )
}
