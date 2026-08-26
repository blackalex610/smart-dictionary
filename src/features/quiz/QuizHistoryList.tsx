import { useI18n, useT } from '@/context/I18nContext'
import { cn } from '@/lib/cn'
import type { TranslationKey } from '@/i18n'
import type { QuizResult } from '@/types/domain'

interface Props {
  results: QuizResult[]
  loading?: boolean
}

function toneFor(percentage: number): string {
  if (percentage >= 80) return 'bg-success/15 text-success'
  if (percentage >= 60) return 'bg-warning/15 text-warning'
  return 'bg-error/15 text-error'
}

export function QuizHistoryList({ results, loading = false }: Props) {
  const t = useT()
  const { lang } = useI18n()

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="text-[15px] font-semibold text-fg">{t('quiz-history')}</h2>

      {loading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-[56px] animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <p className="py-8 text-center text-[14px] text-fg-muted">{t('quiz-history-empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line-soft">
          {results.map((result) => (
            <li key={result.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-fg">
                  {t(`quiz-type-${result.quizType}` as TranslationKey)}
                </p>
                <p className="text-[12.5px] text-fg-subtle">
                  {new Date(result.createdAt).toLocaleDateString(lang, {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-md px-2.5 py-1 text-[13px] font-semibold tabular-nums',
                  toneFor(result.percentage),
                )}
              >
                {result.score}/{result.totalQuestions}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
