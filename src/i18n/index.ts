import bg from './locales/bg'
import en from './locales/en'
import es from './locales/es'
import zh from './locales/zh'
import fr from './locales/fr'
import de from './locales/de'
import type { Dict, TranslationKey } from './types'
import { readJson } from '@/lib/storage'

export type Lang = 'bg' | 'en' | 'es' | 'zh' | 'fr' | 'de'

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: 'bg', label: 'Български', flag: 'bg' },
  { code: 'en', label: 'English', flag: 'gb' },
  { code: 'es', label: 'Español', flag: 'es' },
  { code: 'zh', label: '中文', flag: 'cn' },
  { code: 'fr', label: 'Français', flag: 'fr' },
  { code: 'de', label: 'Deutsch', flag: 'de' },
]

const DICTS: Record<Lang, Partial<Dict>> = { bg, en, es, zh, fr, de }

export const DEFAULT_LANG: Lang = 'bg'

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && value in DICTS
}

export function getInitialLang(): Lang {
  const settings = readJson<{ language?: unknown }>('appSettings', {})
  if (isLang(settings.language)) return settings.language
  return DEFAULT_LANG
}

export type TVars = Record<string, string | number>

function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  )
}

export function translate(lang: Lang, key: TranslationKey, vars?: TVars): string {
  const value = DICTS[lang][key] ?? en[key] ?? key
  return interpolate(value, vars)
}

export type { Dict, TranslationKey }
