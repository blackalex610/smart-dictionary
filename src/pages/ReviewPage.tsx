import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import { useT } from '@/context/I18nContext'
import {
  AGAIN,
  EASY,
  GOOD,
  HARD,
  formatIntervalPreview,
  previewNextState,
  type Rating,
  type ReviewState,
} from '@/domain/srs'
import { useReviewQueue, useSubmitReview } from '@/hooks/useReviewQueue'
import type { TranslationKey } from '@/i18n'
import { cn } from '@/lib/cn'

const RATING_BUTTONS: { rating: Rating; labelKey: TranslationKey; className: string }[] = [
  { rating: AGAIN, labelKey: 'rating-again', className: 'bg-error text-white' },
  { rating: HARD, labelKey: 'rating-hard', className: 'bg-amber-500 text-white' },
  { rating: GOOD, labelKey: 'rating-good', className: 'bg-brand text-white' },
  { rating: EASY, labelKey: 'rating-easy', className: 'bg-emerald-500 text-white' },
]

const SWIPE_THRESHOLD_PX = 60

export function ReviewPage() {
  const t = useT()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const dictionaryId = searchParams.get('dictionary_id') ?? undefined

  const { data: items, isLoading } = useReviewQueue(dictionaryId)
  const submit = useSubmitReview(dictionaryId)

  const [flipped, setFlipped] = useState(false)
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const [touchStartX, setTouchStartX] = useState<number | null>(null)

  const current = items?.[0]

  const rate = useCallback(
    (rating: Rating) => {
      if (!current) return
      submit.mutate({ wordId: current.word_id, rating, elapsedMs: Date.now() - startedAt })
      setFlipped(false)
      setStartedAt(Date.now())
    },
    [current, startedAt, submit],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault()
        setFlipped((prev) => !prev)
        return
      }
      if (event.key >= '1' && event.key <= '4') {
        rate(Number(event.key) as Rating)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [rate])

  const previews = useMemo(() => {
    if (!current) return null
    const state: ReviewState = {
      wordId: current.word_id,
      state: current.state as ReviewState['state'],
      step: 0,
      ease: 2.5,
      interval: 0,
    }
    const now = new Date()
    return RATING_BUTTONS.map(({ rating }) =>
      formatIntervalPreview(previewNextState(state, rating, now).dueAt, now),
    )
  }, [current])

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!current) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-[17px] font-semibold text-fg">{t('review-all-done-title')}</p>
        <p className="text-[14.5px] text-fg-muted">{t('review-all-done-body')}</p>
        <button
          type="button"
          onClick={() => navigate('/app/flashcards')}
          className="mt-2 text-[14.5px] font-medium text-brand hover:text-brand-hover"
        >
          {t('review-back-to-flashcards')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex min-h-[70vh] flex-col items-center justify-center gap-6 py-6"
      onTouchStart={(event) => setTouchStartX(event.touches[0].clientX)}
      onTouchEnd={(event) => {
        if (touchStartX === null) return
        const deltaX = event.changedTouches[0].clientX - touchStartX
        if (Math.abs(deltaX) > SWIPE_THRESHOLD_PX) rate(deltaX > 0 ? GOOD : AGAIN)
        setTouchStartX(null)
      }}
    >
      <span className="text-[13.5px] font-medium text-fg-muted">
        {t('review-remaining', { n: items.length })}
      </span>

      <button
        type="button"
        onClick={() => setFlipped((prev) => !prev)}
        className="flip-scene w-full max-w-[520px]"
        aria-label={t('shortcut-flip')}
      >
        <div className={cn('flip-card block h-[300px] w-full', flipped && 'is-flipped')}>
          <span className="flip-face flex flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-surface p-8 text-center shadow-pop">
            <span className="text-[30px] font-bold text-fg">{current.word}</span>
            {current.part_of_speech && (
              <span className="rounded-md bg-brand-soft px-2.5 py-[3px] text-[12.5px] font-medium text-brand">
                {t(current.part_of_speech as TranslationKey)}
              </span>
            )}
          </span>
          <span className="flip-face flip-face-back flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface p-8 text-center shadow-pop">
            <span className="text-[18px] font-medium text-fg">{current.definition}</span>
            {current.example && (
              <span className="text-[13.5px] italic text-fg-muted">{current.example}</span>
            )}
          </span>
        </div>
      </button>

      <div className="grid w-full max-w-[520px] grid-cols-4 gap-2">
        {RATING_BUTTONS.map(({ rating, labelKey, className }, i) => (
          <button
            key={rating}
            type="button"
            onClick={() => rate(rating)}
            className={cn(
              'flex h-[56px] flex-col items-center justify-center gap-0.5 rounded-[10px] text-[13px] font-semibold transition hover:brightness-95',
              className,
            )}
          >
            <span>{t(labelKey)}</span>
            <span className="text-[11px] font-normal opacity-80">{previews?.[i]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
