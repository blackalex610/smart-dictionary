import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/context/I18nContext'
import { validateFolderName } from '@/lib/folders'
import type { TranslationKey } from '@/i18n'

const ERROR_KEYS: Record<string, TranslationKey> = {
  empty: 'err-folder-empty',
  'too-long': 'err-folder-long',
  duplicate: 'err-folder-duplicate',
}

interface Props {
  open: boolean
  existing: string[]
  onClose: () => void
  onCreate: (name: string) => void
}

export function NewFolderDialog({ open, existing, onClose, onCreate }: Props) {
  const t = useT()
  const [name, setName] = useState('')
  const [error, setError] = useState<TranslationKey | null>(null)

  // Clear the form on the false->true transition, during render rather than
  // in an effect — this dialog stays mounted while closed (Modal just
  // renders null), so its fields would otherwise carry over between opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName('')
      setError(null)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const problem = validateFolderName(name, existing)
    if (problem) {
      setError(ERROR_KEYS[problem])
      return
    }
    onCreate(name.trim())
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="new-folder-title">
      <h2 id="new-folder-title" className="text-[17px] font-bold text-fg">
        {t('create-new-folder')}
      </h2>

      <form onSubmit={submit} className="mt-4" noValidate>
        <label htmlFor="folder-name" className="mb-2 block text-[13.5px] font-medium text-fg">
          {t('folder-name-label')}
        </label>
        <input
          id="folder-name"
          value={name}
          maxLength={50}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          placeholder={t('folder-name-placeholder')}
          className="h-[46px] w-full rounded-[10px] border border-line bg-surface px-3.5 text-[14.5px] text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-0"
        />
        {error && (
          <p role="alert" className="mt-2 text-[13px] text-error">
            {t(error)}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="h-[42px] rounded-[10px] border border-line px-4 text-[14.5px] font-medium text-fg transition hover:bg-surface-2"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="h-[42px] rounded-[10px] bg-brand px-5 text-[14.5px] font-semibold text-white transition hover:bg-brand-hover"
          >
            {t('create')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
