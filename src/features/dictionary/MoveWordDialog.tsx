import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/context/I18nContext'
import { folderOf } from '@/lib/folders'
import type { Word } from '@/types/domain'

interface Props {
  word: Word | null
  folders: string[]
  onClose: () => void
  onMove: (word: Word, folder: string) => void
}

export function MoveWordDialog({ word, folders, onClose, onMove }: Props) {
  const t = useT()
  const [folder, setFolder] = useState(word ? folderOf(word) : '')

  // Re-derive during render when a different word is passed in, rather than
  // in an effect — this component never unmounts between opens (it always
  // renders, just returns null while closed), so state must be reset here.
  const [openedFor, setOpenedFor] = useState(word?.id ?? null)
  if ((word?.id ?? null) !== openedFor) {
    setOpenedFor(word?.id ?? null)
    if (word) setFolder(folderOf(word))
  }

  if (!word) return null

  return (
    <Modal open onClose={onClose} labelledBy="move-title">
      <h2 id="move-title" className="text-[18px] font-bold text-fg">
        {t('move-word-title')}
      </h2>
      <p className="mt-1.5 text-[14px] text-fg-muted">{t('move-word-body', { word: word.word })}</p>

      <label htmlFor="move-folder" className="mt-5 block text-[13.5px] font-medium text-fg">
        {t('folder-label')}
      </label>
      <select
        id="move-folder"
        value={folder}
        onChange={(event) => setFolder(event.target.value)}
        className="mt-2 h-[42px] w-full rounded-lg border border-line bg-surface px-3 text-[14.5px] text-fg focus:border-brand focus:outline-none focus:ring-0"
      >
        {folders.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <div className="mt-6 flex justify-end gap-2.5">
        <Button variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          disabled={folder === folderOf(word)}
          onClick={() => {
            onMove(word, folder)
            onClose()
          }}
        >
          {t('move')}
        </Button>
      </div>
    </Modal>
  )
}
