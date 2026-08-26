import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Settings as SettingsIcon, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { ExportDialog } from '@/features/data/ExportDialog'
import { ImportWordsButton } from '@/features/data/ImportWordsButton'
import { useAuth } from '@/context/AuthContext'
import { useI18n, useT } from '@/context/I18nContext'
import { useSettings, type CardDensity, type FontSize } from '@/context/SettingsContext'
import { useTheme } from '@/context/ThemeContext'
import { useProfile } from '@/hooks/useProfile'
import { useWords, useWordsBackend } from '@/hooks/useWords'
import { cn } from '@/lib/cn'
import { LANGS } from '@/i18n'
import type { TranslationKey } from '@/i18n'

const FONT_SIZES: { value: FontSize; key: TranslationKey }[] = [
  { value: 'small', key: 'font-small' },
  { value: 'medium', key: 'font-medium' },
  { value: 'large', key: 'font-large' },
]

const DENSITIES: { value: CardDensity; key: TranslationKey }[] = [
  { value: 'comfortable', key: 'density-comfortable' },
  { value: 'compact', key: 'density-compact' },
]

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-line p-[3px]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-[14px] font-medium transition',
            value === option.value ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsPage() {
  const t = useT()
  const toast = useToast()
  const { lang, setLang } = useI18n()
  const { theme, setTheme } = useTheme()
  const { settings, update, reset } = useSettings()
  const { state } = useAuth()
  const { data: words = [] } = useWords()
  const { data: profile } = useProfile()
  const backend = useWordsBackend()
  const queryClient = useQueryClient()

  const [exportOpen, setExportOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)

  const clearDictionary = async () => {
    if (!backend) return
    setClearing(true)
    try {
      await backend.replaceAll([])
      await queryClient.invalidateQueries({ queryKey: ['words'] })
      toast.push(t('toast-dictionary-cleared'))
      setClearOpen(false)
    } catch {
      toast.push(t('err-generic'), 'error')
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <header className="pt-8">
        <h1 className="flex items-center gap-2.5 text-[26px] font-bold tracking-[-0.01em] text-fg">
          <SettingsIcon size={24} className="text-brand" />
          {t('settings-title')}
        </h1>
        <p className="mt-1.5 text-[14.5px] text-fg-muted">{t('settings-subtitle')}</p>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={t('display-settings')}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[14px] text-fg">{t('theme-label')}</span>
              <Segmented
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'light' as const, label: t('theme-light') },
                  { value: 'dark' as const, label: t('theme-dark') },
                ]}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[14px] text-fg">{t('font-size-label')}</span>
              <Segmented
                value={settings.fontSize}
                onChange={(value) => update('fontSize', value)}
                options={FONT_SIZES.map((option) => ({
                  value: option.value,
                  label: t(option.key),
                }))}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[14px] text-fg">{t('card-density-label')}</span>
              <Segmented
                value={settings.cardDensity}
                onChange={(value) => update('cardDensity', value)}
                options={DENSITIES.map((option) => ({ value: option.value, label: t(option.key) }))}
              />
            </div>

            <Button variant="secondary" size="sm" className="self-start" onClick={reset}>
              {t('reset-display')}
            </Button>
          </div>
        </Panel>

        <Panel title={t('language-settings')}>
          <div className="grid grid-cols-2 gap-2">
            {LANGS.map((option) => (
              <button
                key={option.code}
                type="button"
                onClick={() => setLang(option.code)}
                className={cn(
                  'flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-[14px] transition',
                  lang === option.code
                    ? 'border-brand bg-brand-soft font-semibold text-brand'
                    : 'border-line text-fg hover:bg-surface-2',
                )}
              >
                {option.label}
                <span className="text-[12px] uppercase text-fg-subtle">{option.code}</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title={t('data-settings')}>
          <div className="flex flex-wrap gap-2.5">
            <Button
              variant="secondary"
              onClick={() => setExportOpen(true)}
              disabled={words.length === 0}
            >
              <Download size={16} />
              {t('export-btn')}
            </Button>
            <ImportWordsButton />
            <Button
              variant="danger"
              onClick={() => setClearOpen(true)}
              disabled={words.length === 0}
            >
              <Trash2 size={16} />
              {t('clear-dictionary')}
            </Button>
          </div>
          <p className="mt-3 text-[13px] text-fg-muted">{t('data-settings-hint')}</p>
        </Panel>

        <Panel title={t('about-settings')}>
          <dl className="flex flex-col gap-2.5 text-[14px]">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{t('about-app')}</dt>
              <dd className="font-medium text-fg">{t('app-name')} 2.0</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{t('about-account')}</dt>
              <dd className="truncate font-medium text-fg">
                {state.status === 'authenticated'
                  ? (state.user.email ?? state.user.name)
                  : t('guest')}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{t('about-plan')}</dt>
              <dd className="font-medium text-fg">
                {profile?.tier === 'premium' ? t('plan-premium') : t('plan-free')}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{t('about-words')}</dt>
              <dd className="font-medium tabular-nums text-fg">{words.length}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <ExportDialog
        open={exportOpen}
        words={words}
        onClose={() => setExportOpen(false)}
        onExported={() => toast.push(t('toast-exported'))}
      />

      <Modal open={clearOpen} onClose={() => setClearOpen(false)} labelledBy="clear-title">
        <h2 id="clear-title" className="text-[18px] font-bold text-fg">
          {t('clear-dictionary')}
        </h2>
        <p className="mt-2 text-[14.5px] text-fg-muted">
          {t('clear-dictionary-body', { n: words.length })}
        </p>
        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="secondary" onClick={() => setClearOpen(false)}>
            {t('cancel')}
          </Button>
          <Button variant="danger" loading={clearing} onClick={() => void clearDictionary()}>
            {t('delete')}
          </Button>
        </div>
      </Modal>
    </>
  )
}
