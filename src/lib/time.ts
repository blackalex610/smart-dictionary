import type { TFunction } from '@/context/I18nContext'
import type { TranslationKey } from '@/i18n'

function unit(t: TFunction, base: string, n: number): string {
  const key = (n === 1 ? base : `${base}-plural`) as TranslationKey
  return t(key, { n })
}

/** "just now" / "2 min ago" / "1 hour ago" / "3 days ago" — matches the design. */
export function relativeTime(timestamp: number, t: TFunction, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 45) return t('time-just-now')

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return unit(t, 'time-minutes', Math.max(1, minutes))

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return unit(t, 'time-hours', hours)

  const days = Math.floor(hours / 24)
  if (days < 30) return unit(t, 'time-days', days)

  const months = Math.floor(days / 30)
  if (months < 12) return unit(t, 'time-months', months)

  return unit(t, 'time-years', Math.floor(months / 12))
}
