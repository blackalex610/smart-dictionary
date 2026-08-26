import { FileJson, FileSpreadsheet, FileText } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/context/I18nContext'
import { exportWords, type ExportFormat } from '@/lib/export'
import type { TranslationKey } from '@/i18n'
import type { Word } from '@/types/domain'

interface Props {
  open: boolean
  words: Word[]
  onClose: () => void
  onExported?: (format: ExportFormat) => void
}

const FORMATS: { format: ExportFormat; icon: typeof FileText; key: TranslationKey }[] = [
  { format: 'txt', icon: FileText, key: 'export-txt' },
  { format: 'csv', icon: FileSpreadsheet, key: 'export-csv' },
  { format: 'json', icon: FileJson, key: 'export-json' },
]

export function ExportDialog({ open, words, onClose, onExported }: Props) {
  const t = useT()

  return (
    <Modal open={open} onClose={onClose} labelledBy="export-title">
      <h2 id="export-title" className="text-[18px] font-bold text-fg">
        {t('export-title')}
      </h2>
      <p className="mt-1.5 text-[14px] text-fg-muted">
        {t('export-subtitle', { n: words.length })}
      </p>

      <div className="mt-5 flex flex-col gap-2">
        {FORMATS.map(({ format, icon: Icon, key }) => (
          <button
            key={format}
            type="button"
            onClick={() => {
              exportWords(words, format)
              onExported?.(format)
              onClose()
            }}
            className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-left text-[14.5px] font-medium text-fg transition hover:bg-surface-2"
          >
            <Icon size={18} className="text-brand" />
            {t(key)}
          </button>
        ))}
      </div>
    </Modal>
  )
}
