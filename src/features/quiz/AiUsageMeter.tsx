import { Sparkles } from 'lucide-react'
import { useT } from '@/context/I18nContext'
import { cn } from '@/lib/cn'
import type { UsageInfo } from '@/types/domain'

interface Props {
  usage: UsageInfo | undefined
  loading?: boolean
}

export function AiUsageMeter({ usage, loading = false }: Props) {
  const t = useT()

  if (loading || !usage) {
    return <div className="h-[74px] animate-pulse rounded-card border border-line bg-surface-2" />
  }

  if (usage.isUnlimited || usage.limit == null) {
    return (
      <div className="flex items-center gap-2.5 rounded-card border border-line bg-surface px-4 py-3.5 shadow-card">
        <Sparkles size={17} className="text-brand" />
        <span className="text-[14px] font-medium text-fg">{t('ai-unlimited')}</span>
      </div>
    )
  }

  const ratio = usage.limit > 0 ? Math.min(1, usage.used / usage.limit) : 1
  const exhausted = usage.used >= usage.limit

  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3.5 shadow-card">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[14px] font-medium text-fg">
          <Sparkles size={16} className="text-brand" />
          {t('ai-requests-today')}
        </span>
        <span
          className={cn(
            'text-[14px] font-semibold tabular-nums',
            exhausted ? 'text-error' : ratio >= 0.8 ? 'text-warning' : 'text-fg-muted',
          )}
        >
          {usage.used} / {usage.limit}
        </span>
      </div>

      <div className="mt-2.5 h-[6px] w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300',
            exhausted ? 'bg-error' : ratio >= 0.8 ? 'bg-warning' : 'bg-brand',
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>

      {exhausted && <p className="mt-2 text-[13px] text-error">{t('ai-limit-reached')}</p>}
    </div>
  )
}
