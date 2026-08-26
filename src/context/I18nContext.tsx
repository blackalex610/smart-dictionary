import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getInitialLang, translate, type Lang, type TranslationKey, type TVars } from '@/i18n'
import { readJson, writeJson } from '@/lib/storage'

export type TFunction = (key: TranslationKey, vars?: TVars) => string

interface I18nValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: TFunction
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    const settings = readJson<Record<string, unknown>>('appSettings', {})
    writeJson('appSettings', { ...settings, language: next })
    document.documentElement.lang = next
  }, [])

  const t = useCallback<TFunction>((key, vars) => translate(lang, key, vars), [lang])

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}

export function useT(): TFunction {
  return useI18n().t
}
