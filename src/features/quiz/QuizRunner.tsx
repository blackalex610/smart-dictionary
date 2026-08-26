import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useT } from '@/context/I18nContext'
import { cn } from '@/lib/cn'
import { gradeQuiz, verdictFor } from './grade'
import type { QuizGrade, QuizQuestion, QuizSession } from './types'
import type { TranslationKey } from '@/i18n'

const REVEAL_STEP_MS = 200

interface Props {
  session: QuizSession
  onClose: () => void
  onFinished: (grade: QuizGrade) => void
}

const VERDICT_KEYS: Record<ReturnType<typeof verdictFor>, TranslationKey> = {
  excellent: 'quiz-verdict-excellent',
  good: 'quiz-verdict-good',
  'keep-going': 'quiz-verdict-keep-going',
}

const INSTRUCTIONS: Record<string, TranslationKey> = {
  multiple: 'quiz-instructions-multiple',
  open: 'quiz-instructions-open',
  gap: 'quiz-instructions-gap',
  'gap-verb-form': 'quiz-instructions-gap-verb',
  reading: 'quiz-instructions-reading',
}

export function QuizRunner({ session, onClose, onFinished }: Props) {
  const t = useT()
  const { questions } = session

  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [grade, setGrade] = useState<QuizGrade | null>(null)
  const [revealed, setRevealed] = useState(0)
  const finishedRef = useRef(false)

  const answeredCount = useMemo(
    () => questions.filter((question) => (answers[question.id] ?? '').trim() !== '').length,
    [answers, questions],
  )
  const progress = questions.length ? (answeredCount / questions.length) * 100 : 0
  const scoreVisible = grade !== null && revealed >= questions.length

  useEffect(() => {
    if (!grade || revealed >= questions.length) return
    const timer = window.setTimeout(() => setRevealed((prev) => prev + 1), REVEAL_STEP_MS)
    return () => window.clearTimeout(timer)
  }, [grade, revealed, questions.length])

  useEffect(() => {
    if (!scoreVisible || !grade || finishedRef.current) return
    finishedRef.current = true
    onFinished(grade)
  }, [scoreVisible, grade, onFinished])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (grade) return
    setGrade(gradeQuiz(questions, answers))
    setRevealed(0)
  }

  const setAnswer = (id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  const resultFor = (question: QuizQuestion, index: number) => {
    if (!grade || index >= revealed) return null
    return grade.answers.find((answer) => answer.questionId === question.id) ?? null
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/55 p-4 animate-fade-in">
      <div className="mx-auto my-6 w-full max-w-[760px] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-slide-up">
        <div className="h-[4px] w-full bg-surface-2">
          <div
            className="h-full bg-brand transition-[width] duration-300"
            style={{ width: `${grade ? 100 : progress}%` }}
          />
        </div>

        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <h2 className="text-[20px] font-bold tracking-[-0.01em] text-fg">
              {t(`quiz-type-${session.type}` as TranslationKey)}
            </h2>
            <p className="mt-1 text-[14px] text-fg-muted">
              {t(INSTRUCTIONS[session.type] ?? 'quiz-instructions-multiple')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="rounded-lg p-2 text-fg-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <X size={20} />
          </button>
        </div>

        {session.passage && (
          <div className="mx-6 mt-4 rounded-xl border border-line bg-surface-2 p-4">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-fg-subtle">
              {t('reading-passage')}
            </h3>
            <p className="mt-2 whitespace-pre-line text-[14.5px] leading-relaxed text-fg">
              {session.passage}
            </p>
          </div>
        )}

        <form onSubmit={submit} className="px-6 pb-6 pt-5">
          <ol className="flex flex-col gap-5">
            {questions.map((question, index) => {
              const result = resultFor(question, index)
              return (
                <li
                  key={question.id}
                  className={cn(
                    'rounded-xl border p-4 transition',
                    result === null
                      ? 'border-line'
                      : result.correct
                        ? 'border-success/50 bg-success/5'
                        : 'border-error/50 bg-error-soft',
                  )}
                >
                  <p className="text-[12.5px] font-semibold uppercase tracking-wide text-fg-subtle">
                    {t('question-n', { n: index + 1 })}
                  </p>

                  {question.kind === 'choice' ? (
                    <>
                      <p className="mt-1.5 text-[15.5px] font-medium text-fg">
                        {question.word
                          ? t('quiz-what-means', { word: question.word })
                          : question.prompt}
                      </p>
                      <div className="mt-3 flex flex-col gap-2">
                        {question.options.map((option, optionIndex) => {
                          const chosen = answers[question.id] === String(optionIndex)
                          const isRight = result && optionIndex === question.correctIndex
                          const isWrongPick =
                            result && chosen && optionIndex !== question.correctIndex
                          return (
                            <label
                              key={optionIndex}
                              className={cn(
                                'flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-2.5 text-[14.5px] transition',
                                isRight
                                  ? 'border-success/60 bg-success/10 text-fg'
                                  : isWrongPick
                                    ? 'border-error/60 bg-error/10 text-fg'
                                    : chosen
                                      ? 'border-brand bg-brand-soft text-fg'
                                      : 'border-line text-fg hover:bg-surface-2',
                              )}
                            >
                              <input
                                type="radio"
                                name={question.id}
                                value={optionIndex}
                                checked={chosen}
                                disabled={grade !== null}
                                onChange={() => setAnswer(question.id, String(optionIndex))}
                                className="mt-[3px] h-[16px] w-[16px] border-line text-brand focus:ring-brand"
                              />
                              <span className="flex-1">{option}</span>
                            </label>
                          )
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mt-1.5 whitespace-pre-line text-[15.5px] font-medium text-fg">
                        {question.prompt}
                      </p>
                      {question.hint && (
                        <p className="mt-1 text-[13px] italic text-fg-subtle">
                          {t('verb-infinitive', { word: question.hint })}
                        </p>
                      )}
                      <input
                        type="text"
                        value={answers[question.id] ?? ''}
                        disabled={grade !== null}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => setAnswer(question.id, event.target.value)}
                        placeholder={t('quiz-answer-placeholder')}
                        className="mt-3 h-[42px] w-full rounded-lg border border-line bg-surface px-3.5 text-[14.5px] text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-0 disabled:opacity-70"
                      />
                    </>
                  )}

                  {result && !result.correct && (
                    <p className="mt-2.5 text-[13.5px] font-medium text-error">
                      {t('correct-answer-is', { answer: result.expected })}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>

          <div className="mt-6 flex flex-col items-center gap-3">
            {!grade ? (
              <Button type="submit" size="lg" className="w-full sm:w-auto">
                {t('submit-quiz')}
              </Button>
            ) : scoreVisible ? (
              <>
                <p className="text-[22px] font-bold text-fg">
                  {t('quiz-score', {
                    score: grade.score,
                    total: grade.total,
                    percentage: grade.percentage,
                  })}
                </p>
                <p className="text-[15px] text-fg-muted">
                  {t(VERDICT_KEYS[verdictFor(grade.percentage)])}
                </p>
                <Button size="lg" onClick={onClose}>
                  {t('close')}
                </Button>
              </>
            ) : (
              <p className="text-[14px] text-fg-muted">{t('checking-answers')}</p>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
