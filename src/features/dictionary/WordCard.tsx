import { FolderInput, Pencil, Trash2, Volume2 } from 'lucide-react'
import { useT } from '@/context/I18nContext'
import { folderOf } from '@/lib/folders'
import { relativeTime } from '@/lib/time'
import { canSpeak, speakWord } from '@/lib/speech'
import { cn } from '@/lib/cn'
import type { TranslationKey } from '@/i18n'
import type { Word } from '@/types/domain'

interface Props {
  word: Word
  isEditing: boolean
  onEdit: (word: Word) => void
  onDelete: (word: Word) => void
  onMove: (word: Word) => void
}

export function WordCard({ word, isEditing, onEdit, onDelete, onMove }: Props) {
  const t = useT()

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-[10px] border bg-surface pl-[19px] pr-4 py-[var(--card-pad-y)] transition',
        isEditing ? 'border-brand/40 bg-brand-soft/40' : 'border-line hover:bg-surface-2',
      )}
    >
      <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h3 className="min-w-0 break-words text-[17px] font-bold leading-tight text-fg [overflow-wrap:anywhere]">
            {word.word}
          </h3>
          <span className="rounded-md bg-brand-soft px-2 py-[3px] text-[12.5px] font-medium text-brand">
            {t(word.partOfSpeech as TranslationKey)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canSpeak() && (
            <button
              type="button"
              onClick={() => speakWord(word.word)}
              aria-label={t('pronounce-word')}
              title={t('pronounce-word')}
              className="flex h-[30px] w-[34px] items-center justify-center rounded-lg bg-surface-2 text-fg-muted opacity-0 transition hover:text-brand focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Volume2 size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onMove(word)}
            aria-label={t('move-word')}
            title={t('move-word')}
            className="flex h-[30px] w-[34px] items-center justify-center rounded-lg bg-surface-2 text-fg-muted transition hover:bg-brand-soft hover:text-brand"
          >
            <FolderInput size={15} />
          </button>
          <button
            type="button"
            onClick={() => onEdit(word)}
            aria-label={t('edit-word')}
            title={t('edit-word')}
            className="flex h-[30px] w-[34px] items-center justify-center rounded-lg bg-surface-2 text-fg-muted transition hover:bg-brand-soft hover:text-brand"
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(word)}
            aria-label={t('delete-word')}
            title={t('delete-word')}
            className="flex h-[30px] w-[34px] items-center justify-center rounded-lg bg-error-soft text-error transition hover:bg-error hover:text-white"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <p className="mt-2 text-[14.5px] leading-relaxed text-fg-muted [overflow-wrap:anywhere]">
        {word.definition}
      </p>

      {word.example && (
        <p className="mt-1.5 border-l-2 border-line pl-2.5 text-[13.5px] italic text-fg-subtle [overflow-wrap:anywhere]">
          {word.example}
        </p>
      )}

      <p className="mt-3 text-[12.5px] text-fg-subtle">
        {t('added')} {relativeTime(word.createdAt, t)}
        <span className="px-2">•</span>
        {folderOf(word)}
      </p>
    </article>
  )
}
