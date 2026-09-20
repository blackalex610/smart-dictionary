import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useT } from '@/context/I18nContext'
import { useImportLegacyWords } from '@/hooks/useImportLegacyWords'
import { clearLegacyGuestWords, readLegacyGuestWords } from './legacyGuestWords'

export function GuestImportPrompt() {
  const t = useT()
  const toast = useToast()
  const importLegacyWords = useImportLegacyWords()
  const [pending, setPending] = useState(() => readLegacyGuestWords())
  const [importing, setImporting] = useState(false)

  if (pending.length === 0) return null

  const dismiss = () => {
    clearLegacyGuestWords()
    setPending([])
  }

  const importWords = async () => {
    setImporting(true)
    try {
      await importLegacyWords.mutateAsync(pending)
      clearLegacyGuestWords()
      const count = pending.length
      setPending([])
      toast.push(t('guest-import-success', { n: count }))
    } catch {
      toast.push(t('err-generic'), 'error')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-pop">
        <p className="text-[15px] font-semibold text-fg">{t('guest-import-title')}</p>
        <p className="mt-2 text-[13.5px] text-fg-muted">
          {t('guest-import-body', { n: pending.length })}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={dismiss} disabled={importing}>
            {t('guest-import-dismiss')}
          </Button>
          <Button onClick={() => void importWords()} loading={importing}>
            {t('guest-import-confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
