import { useMemo, useState } from 'react'
import { Brain, Play } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { AiUsageMeter } from '@/features/quiz/AiUsageMeter'
import { QuizHistoryList } from '@/features/quiz/QuizHistoryList'
import { QuizRunner } from '@/features/quiz/QuizRunner'
import { generateQuiz, ReadingParseError } from '@/features/quiz/generators'
import { WordPicker } from '@/features/shared/WordPicker'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/context/I18nContext'
import { isQuotaExhausted, useAiUsage, useRefreshAiUsage } from '@/hooks/useAiUsage'
import { useQuizHistory, useSaveQuizResult } from '@/hooks/useQuizHistory'
import { useWords } from '@/hooks/useWords'
import { AiDailyLimitError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { QUIZ_TYPES, type QuizType } from '@/types/domain'
import type { QuizGrade, QuizSession } from '@/features/quiz/types'
import type { TranslationKey } from '@/i18n'

const MIN_WORDS: Record<QuizType, number> = {
  multiple: 4,
  open: 1,
  reading: 1,
  gap: 1,
  'gap-verb-form': 1,
}

export function TestsPage() {
  const t = useT()
  const toast = useToast()
  const { state } = useAuth()

  const { data: words = [], isLoading } = useWords()
  const { data: usage, isLoading: usageLoading } = useAiUsage()
  const { data: history = [], isLoading: historyLoading } = useQuizHistory()
  const refreshUsage = useRefreshAiUsage()
  const saveResult = useSaveQuizResult()

  const [type, setType] = useState<QuizType>('multiple')
  const [questionCount, setQuestionCount] = useState(10)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [session, setSession] = useState<QuizSession | null>(null)

  const isAuthenticated = state.status === 'authenticated'
  const restrictTo = type === 'gap-verb-form' ? ('verb' as const) : undefined

  const selectedWords = useMemo(() => {
    const chosen = words.filter((word) => selected.has(word.id))
    return restrictTo ? chosen.filter((word) => word.partOfSpeech === restrictTo) : chosen
  }, [words, selected, restrictTo])

  const quotaExhausted = isAuthenticated && isQuotaExhausted(usage)
  const enough = selectedWords.length >= MIN_WORDS[type]

  const start = async () => {
    if (!enough) {
      toast.push(t('err-need-words', { n: MIN_WORDS[type] }), 'error')
      return
    }

    setGenerating(true)
    try {
      const built = await generateQuiz({
        type,
        words: selectedWords,
        questionCount: Math.max(1, Math.min(questionCount, 20)),
        useAi: isAuthenticated && !quotaExhausted,
      })

      if (built.questions.length === 0) {
        toast.push(t('err-quiz-generate'), 'error')
        return
      }
      if (built.quotaReached) toast.push(t('ai-limit-reached'), 'error')
      else if (built.fallbackCount > 0) {
        toast.push(t('quiz-fallback-notice', { n: built.fallbackCount }), 'info')
      }

      setSession(built)
    } catch (error) {
      if (error instanceof AiDailyLimitError) toast.push(t('ai-limit-reached'), 'error')
      else if (error instanceof ReadingParseError) toast.push(t('err-reading-quiz'), 'error')
      else toast.push(t('err-quiz-generate'), 'error')
    } finally {
      setGenerating(false)
      if (isAuthenticated) refreshUsage()
    }
  }

  const finish = (grade: QuizGrade) => {
    if (!session) return
    saveResult.mutate({
      quizType: session.type,
      score: grade.score,
      totalQuestions: grade.total,
      wordsCount: session.words.length,
      details: { percentage: grade.percentage },
    })
  }

  const maxQuestions = Math.max(1, Math.min(20, selectedWords.length || 20))

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4 pt-8">
        <div>
          <h1 className="flex items-center gap-2.5 text-[26px] font-bold tracking-[-0.01em] text-fg">
            <Brain size={24} className="text-brand" />
            {t('quiz-title')}
          </h1>
          <p className="mt-1.5 text-[14.5px] text-fg-muted">{t('quiz-subtitle')}</p>
        </div>
        <Button
          size="lg"
          onClick={start}
          loading={generating}
          disabled={isLoading || words.length === 0 || generating}
        >
          <Play size={17} />
          {t('start-quiz')}
        </Button>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-card border border-line bg-surface p-5 shadow-card">
          <fieldset>
            <legend className="text-[15px] font-semibold text-fg">{t('quiz-type-label')}</legend>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {QUIZ_TYPES.map((value) => (
                <label
                  key={value}
                  aria-label={t(`quiz-type-${value}` as TranslationKey)}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition',
                    type === value
                      ? 'border-brand bg-brand-soft'
                      : 'border-line hover:bg-surface-2',
                  )}
                >
                  <input
                    type="radio"
                    name="quizType"
                    value={value}
                    checked={type === value}
                    onChange={() => setType(value)}
                    className="mt-[3px] h-[16px] w-[16px] border-line text-brand focus:ring-brand"
                  />
                  <span>
                    <span className="block text-[14.5px] font-medium text-fg">
                      {t(`quiz-type-${value}` as TranslationKey)}
                    </span>
                    <span className="block text-[12.5px] text-fg-muted">
                      {t(`quiz-type-${value}-hint` as TranslationKey)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label htmlFor="questionCount" className="text-[14px] font-medium text-fg">
              {t('question-count-label')}
            </label>
            <input
              id="questionCount"
              type="number"
              min={1}
              max={maxQuestions}
              value={questionCount}
              onChange={(event) => setQuestionCount(Number(event.target.value) || 1)}
              className="h-[38px] w-[90px] rounded-lg border border-line bg-surface px-3 text-[14px] text-fg focus:border-brand focus:outline-none focus:ring-0"
            />
            <span className="text-[13px] text-fg-subtle">
              {t('question-count-hint', { max: maxQuestions })}
            </span>
          </div>

          <div className="mt-6">
            <h2 className="text-[15px] font-semibold text-fg">{t('quiz-select-words')}</h2>
            {isLoading ? (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-[52px] animate-pulse rounded-lg bg-surface-2" />
                ))}
              </div>
            ) : words.length === 0 ? (
              <p className="py-10 text-center text-[14.5px] text-fg-muted">{t('empty-body')}</p>
            ) : (
              <WordPicker
                className="mt-4"
                words={words}
                selected={selected}
                onChange={setSelected}
                restrictTo={restrictTo}
              />
            )}
            {!isLoading && words.length > 0 && !enough && (
              <p className="mt-2 text-[13px] text-warning">
                {t('err-need-words', { n: MIN_WORDS[type] })}
              </p>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          {isAuthenticated ? (
            <AiUsageMeter usage={usage} loading={usageLoading} />
          ) : (
            <div className="rounded-card border border-line bg-surface px-4 py-3.5 text-[13.5px] text-fg-muted shadow-card">
              {t('guest-ai-notice')}
            </div>
          )}
          <QuizHistoryList results={history} loading={historyLoading} />
        </aside>
      </div>

      {session && (
        <QuizRunner session={session} onClose={() => setSession(null)} onFinished={finish} />
      )}
    </>
  )
}
