import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Volume2, X } from 'lucide-react'
import { useT } from '@/context/I18nContext'
import { cn } from '@/lib/cn'
import { canSpeak, speakWord } from '@/lib/speech'
import type { TranslationKey } from '@/i18n'
import type { Word } from '@/types/domain'

interface Props {
  words: Word[]
  onClose: () => void
}

/** Full-screen practice deck. The deck is shuffled by the caller. */
export function FlashcardModal({ words, onClose }: Props) {
  const t = useT()
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const card = words[index]
  const atStart = index === 0
  const atEnd = index >= words.length - 1

  const go = useCallback(
    (delta: number) => {
      setIndex((prev) => {
        const next = Math.min(words.length - 1, Math.max(0, prev + delta))
        if (next !== prev) setFlipped(false)
        return next
      })
    },
    [words.length],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key === 'ArrowLeft') go(-1)
      else if (event.key === 'ArrowRight') go(1)
      else if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault()
        setFlipped((prev) => !prev)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [go, onClose])

  if (!card) return null

  const shortcuts: { keyLabel: string; key: TranslationKey }[] = [
    { keyLabel: '←', key: 'shortcut-prev' },
    { keyLabel: 'Space', key: 'shortcut-flip' },
    { keyLabel: '→', key: 'shortcut-next' },
  ]

  return (
    <div
      // Backdrop only — see Modal.tsx for the same pattern and rationale.
      role="presentation"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 p-4 animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex w-full max-w-[640px] flex-col items-center gap-5">
        <div className="flex w-full items-center justify-between">
          <span className="text-[14px] font-medium text-white/80">
            {t('card-n-of-m', { n: index + 1, total: words.length })}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flip-scene w-full">
          <button
            type="button"
            onClick={() => setFlipped((prev) => !prev)}
            className={cn('flip-card block h-[320px] w-full text-left', flipped && 'is-flipped')}
            aria-label={t('shortcut-flip')}
          >
            <span className="flip-face flex flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-surface p-8 text-center shadow-pop">
              <span className="rounded-md bg-brand-soft px-2.5 py-[3px] text-[12.5px] font-medium text-brand">
                {t(card.partOfSpeech as TranslationKey)}
              </span>
              <span className="text-[34px] font-bold leading-tight text-fg">{card.word}</span>
              <span className="text-[13.5px] text-fg-subtle">{t('flip-hint-front')}</span>
            </span>

            <span className="flip-face flip-face-back flex flex-col items-center justify-center gap-4 overflow-y-auto rounded-2xl border border-line bg-surface p-8 text-center shadow-pop">
              <span className="rounded-md bg-brand-soft px-2.5 py-[3px] text-[12.5px] font-medium text-brand">
                {t(card.partOfSpeech as TranslationKey)}
              </span>
              <span className="text-[19px] font-medium leading-relaxed text-fg">
                {card.definition}
              </span>
              {card.example && (
                <span className="border-l-2 border-line pl-3 text-[14px] italic text-fg-muted">
                  {card.example}
                </span>
              )}
              <span className="text-[13.5px] text-fg-subtle">{t('flip-hint-back')}</span>
            </span>
          </button>
        </div>

        <div className="flex w-full items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={atStart}
            className="flex h-[44px] items-center gap-2 rounded-[10px] border border-white/25 px-5 text-[14.5px] font-semibold text-white transition hover:bg-white/10 disabled:opacity-40"
          >
            <ChevronLeft size={17} />
            {t('previous')}
          </button>

          {canSpeak() && (
            <button
              type="button"
              onClick={() => speakWord(card.word)}
              aria-label={t('pronounce-word')}
              className="flex h-[44px] w-[44px] items-center justify-center rounded-[10px] border border-white/25 text-white transition hover:bg-white/10"
            >
              <Volume2 size={18} />
            </button>
          )}

          <button
            type="button"
            onClick={() => go(1)}
            disabled={atEnd}
            className="flex h-[44px] items-center gap-2 rounded-[10px] bg-brand px-5 text-[14.5px] font-semibold text-white transition hover:bg-brand-hover disabled:opacity-40"
          >
            {t('next')}
            <ChevronRight size={17} />
          </button>
        </div>

        <div className="hidden items-center gap-6 text-[12.5px] text-white/60 sm:flex">
          {shortcuts.map((shortcut) => (
            <span key={shortcut.keyLabel} className="flex items-center gap-2">
              <kbd className="rounded-md border border-white/25 px-1.5 py-[1px] font-sans">
                {shortcut.keyLabel}
              </kbd>
              {t(shortcut.key)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
