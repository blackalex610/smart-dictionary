import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/context/I18nContext'
import { cn } from '@/lib/cn'
import { MIN_LENGTH_BOUNDS, type ImportOptions } from '@/lib/importOptions'

interface Props {
  open: boolean
  fileName: string
  initial: ImportOptions
  onClose: () => void
  onConfirm: (options: ImportOptions) => void
}

interface ToggleProps {
  id: string
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint: string
}

function Toggle({ id, checked, onChange, label, hint }: ToggleProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border px-3.5 py-3 transition',
        checked ? 'border-brand bg-brand-soft' : 'border-line hover:bg-surface-2',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-[3px] h-[16px] w-[16px] rounded border-line text-brand focus:ring-brand"
      />
      <span>
        <label htmlFor={id} className="block cursor-pointer text-[14.5px] font-medium text-fg">
          {label}
        </label>
        <span className="block text-[12.5px] text-fg-muted">{hint}</span>
      </span>
    </div>
  )
}

/** Collects the pre-processing options before a file is read. */
export function ImportOptionsDialog({ open, fileName, initial, onClose, onConfirm }: Props) {
  const t = useT()
  const [options, setOptions] = useState<ImportOptions>(initial)

  const patch = (next: Partial<ImportOptions>) => setOptions((prev) => ({ ...prev, ...next }))

  return (
    <Modal open={open} onClose={onClose} labelledBy="import-options-title">
      <h2 id="import-options-title" className="text-[18px] font-bold text-fg">
        {t('import-options-title')}
      </h2>
      <p className="mt-1.5 truncate text-[14px] text-fg-muted" title={fileName}>
        {fileName}
      </p>

      <div className="mt-5 flex flex-col gap-2">
        <Toggle
          id="import-split-paragraphs"
          checked={options.splitParagraphs}
          onChange={(splitParagraphs) => patch({ splitParagraphs })}
          label={t('import-split-paragraphs')}
          hint={t('import-split-paragraphs-hint')}
        />
        <Toggle
          id="import-ignore-short"
          checked={options.ignoreShort}
          onChange={(ignoreShort) => patch({ ignoreShort })}
          label={t('import-ignore-short')}
          hint={t('import-ignore-short-hint')}
        />
      </div>

      {options.ignoreShort && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label htmlFor="import-min-length" className="text-[14px] font-medium text-fg">
            {t('import-min-length')}
          </label>
          <input
            id="import-min-length"
            type="number"
            min={MIN_LENGTH_BOUNDS.min}
            max={MIN_LENGTH_BOUNDS.max}
            value={options.minLength}
            onChange={(event) =>
              patch({ minLength: Number(event.target.value) || MIN_LENGTH_BOUNDS.min })
            }
            className="h-[38px] w-[90px] rounded-lg border border-line bg-surface px-3 text-[14px] text-fg focus:border-brand focus:outline-none focus:ring-0"
          />
          <span className="text-[13px] text-fg-subtle">{t('import-min-length-hint')}</span>
        </div>
      )}

      <p className="mt-5 text-[13px] text-fg-subtle">{t('import-formats-hint')}</p>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button onClick={() => onConfirm(options)}>{t('import-btn')}</Button>
      </div>
    </Modal>
  )
}
