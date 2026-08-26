import { Modal } from '@/components/ui/Modal'
import { useT } from '@/context/I18nContext'
import type { Word } from '@/types/domain'

interface Props {
  word: Word | null
  onClose: () => void
  onConfirm: (word: Word) => void
}

export function ConfirmDeleteDialog({ word, onClose, onConfirm }: Props) {
  const t = useT()

  return (
    <Modal open={word !== null} onClose={onClose} labelledBy="confirm-delete-title">
      {word && (
        <>
          <h2 id="confirm-delete-title" className="text-[17px] font-bold text-fg">
            {t('confirm-delete-title')}
          </h2>
          <p className="mt-2 text-[14.5px] text-fg-muted">
            {t('confirm-delete-body', { word: word.word })}
          </p>
          <div className="mt-5 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="h-[42px] rounded-[10px] border border-line px-4 text-[14.5px] font-medium text-fg transition hover:bg-surface-2"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => onConfirm(word)}
              className="h-[42px] rounded-[10px] bg-error px-5 text-[14.5px] font-semibold text-white transition hover:brightness-95"
            >
              {t('delete')}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
