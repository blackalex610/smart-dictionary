import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { readJson, writeJson } from '@/lib/storage'

export type FontSize = 'small' | 'medium' | 'large'
export type CardDensity = 'compact' | 'comfortable'

export interface AppSettings {
  fontSize: FontSize
  cardDensity: CardDensity
}

const STORAGE_KEY = 'appSettings'

const DEFAULTS: AppSettings = {
  fontSize: 'medium',
  cardDensity: 'comfortable',
}

interface SettingsValue {
  settings: AppSettings
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  reset: () => void
}

const SettingsContext = createContext<SettingsValue | null>(null)

function isFontSize(value: unknown): value is FontSize {
  return value === 'small' || value === 'medium' || value === 'large'
}

function isCardDensity(value: unknown): value is CardDensity {
  return value === 'compact' || value === 'comfortable'
}

/**
 * The whole `appSettings` blob is shared with the language picker, so reads and
 * writes always merge instead of replacing the object.
 */
function readSettings(): AppSettings {
  const raw = readJson<Record<string, unknown>>(STORAGE_KEY, {})
  return {
    fontSize: isFontSize(raw.fontSize) ? raw.fontSize : DEFAULTS.fontSize,
    cardDensity: isCardDensity(raw.cardDensity) ? raw.cardDensity : DEFAULTS.cardDensity,
  }
}

function persist(settings: AppSettings): void {
  const raw = readJson<Record<string, unknown>>(STORAGE_KEY, {})
  writeJson(STORAGE_KEY, { ...raw, ...settings })
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(readSettings)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.fontSize = settings.fontSize
    root.dataset.density = settings.cardDensity
  }, [settings])

  const update = useCallback<SettingsValue['update']>((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      persist(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setSettings(DEFAULTS)
    persist(DEFAULTS)
  }, [])

  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>')
  return ctx
}
