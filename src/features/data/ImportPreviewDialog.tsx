import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/context/I18nContext'
import type { ImportPlan } from '@/lib/importParse'
import type { TranslationKey } from '@/i18n'

/** How many entries the preview lists before summarising the rest. */
const PREVIEW_ROWS = 50

interface Props {
  plan: ImportPlan
  /** Entries dropped earlier because they were malformed. */
  invalid: number
  folder: string
  maxPerImport: number
  saving: { done: number; total: number } | null
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Nothing from a file (or from the AI that structured it) reaches the
 * dictionary until the user has seen what will be added and confirmed it.
 */
export function ImportPreviewDialog({
  plan,
  invalid,
  folder,
  maxPerImport,
  saving,
  onCancel,
  onConfirm,
}: Props) {
  const t = useT()
  const shown = plan.toAdd.slice(0, PREVIEW_ROWS)
  const notes: string[] = []
  if (plan.existing > 0) notes.push(t('import-preview-existing', { n: plan.existing }))
  if (plan.repeated > 0) notes.push(t('import-preview-repeated', { n: plan.repeated }))
  if (invalid > 0) notes.push(t('import-preview-invalid', { n: invalid }))
  if (plan.overLimit > 0) {
    notes.push(t('import-preview-over-limit', { n: plan.overLimit, max: maxPerImport }))
  }

  return (
    <Modal
      open
      onClose={saving ? () => undefined : onCancel}
      labelledBy="import-preview-title"
      className="max-w-lg"
    >
      <h2 id="import-preview-title" className="text-[18px] font-bold text-fg">
        {t('import-preview-title')}
      </h2>
      <p className="mt-1.5 text-[14px] text-fg-muted">
        {plan.toAdd.length > 0
          ? t('import-preview-summary', { n: plan.toAdd.length, folder })
          : t('import-preview-nothing')}
      </p>

      {notes.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-[13px] text-fg-muted">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {shown.length > 0 && (
        <ul className="mt-4 max-h-[320px] divide-y divide-line-soft overflow-y-auto rounded-lg border border-line scrollbar-slim">
          {shown.map((entry, index) => (
            <li key={`${entry.word}-${entry.partOfSpeech}-${index}`} className="px-3.5 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="break-words text-[14px] font-semibold text-fg">{entry.word}</span>
                <span className="shrink-0 text-[12px] text-fg-muted">
                  {t(entry.partOfSpeech as TranslationKey)}
                </span>
              </div>
              <p className="line-clamp-2 break-words text-[13px] text-fg-muted">
                {entry.definition}
              </p>
            </li>
          ))}
          {plan.toAdd.length > shown.length && (
            <li className="px-3.5 py-2 text-[13px] text-fg-subtle">
              {t('import-preview-more', { n: plan.toAdd.length - shown.length })}
            </li>
          )}
        </ul>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving !== null}>
          {t('cancel')}
        </Button>
        {plan.toAdd.length > 0 && (
          <Button onClick={onConfirm} loading={saving !== null}>
            {saving
              ? t('import-progress', { done: saving.done, total: saving.total })
              : t('import-confirm', { n: plan.toAdd.length })}
          </Button>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {saving ? t('import-progress', { done: saving.done, total: saving.total }) : ''}
      </p>
    </Modal>
  )
}
