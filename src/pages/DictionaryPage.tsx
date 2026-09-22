import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ExportDialog } from '@/features/data/ExportDialog'
import { ImportWordsButton } from '@/features/data/ImportWordsButton'
import { AddWordForm } from '@/features/dictionary/AddWordForm'
import { ConfirmDeleteDialog } from '@/features/dictionary/ConfirmDeleteDialog'
import { FolderSidebar } from '@/features/dictionary/FolderSidebar'
import { MoveWordDialog } from '@/features/dictionary/MoveWordDialog'
import { NewFolderDialog } from '@/features/dictionary/NewFolderDialog'
import { SearchBar } from '@/features/dictionary/SearchBar'
import { WordList } from '@/features/dictionary/WordList'
import { useToast } from '@/components/ui/Toast'
import { useAppAction } from '@/context/AppActionsContext'
import { useT } from '@/context/I18nContext'
import { useCustomFolders } from '@/hooks/useCustomFolders'
import { useDictionaryFilters } from '@/hooks/useDictionaryFilters'
import { useWordMutations, useWords } from '@/hooks/useWords'
import { collectFolders, countByFolder, DEFAULT_FOLDER } from '@/lib/folders'
import { FreeWordLimitError } from '@/lib/errors'
import { speakWord } from '@/lib/speech'
import type { NewWord, Word } from '@/types/domain'

export function DictionaryPage() {
  const t = useT()
  const toast = useToast()

  const { data: words = [], isLoading } = useWords()
  const { create, update, remove } = useWordMutations()
  const { folders: customFolders, addFolder } = useCustomFolders()

  const filters = useDictionaryFilters(words)
  const [editing, setEditing] = useState<Word | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Word | null>(null)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [movingWord, setMovingWord] = useState<Word | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const folders = useMemo(() => collectFolders(words, customFolders), [words, customFolders])
  const counts = useMemo(() => countByFolder(words), [words])
  const submitting = create.isPending || update.isPending

  const handleSubmit = async (input: NewWord & { pronunciation: boolean }) => {
    const { pronunciation, ...payload } = input

    const duplicate = words.some(
      (existing) =>
        existing.id !== editing?.id &&
        existing.word.trim().toLowerCase() === payload.word.toLowerCase() &&
        existing.partOfSpeech === payload.partOfSpeech,
    )
    if (duplicate) {
      toast.push(t('err-duplicate', { word: payload.word }), 'error')
      return false
    }

    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, patch: payload })
        toast.push(t('toast-word-updated', { word: payload.word }))
        setEditing(null)
      } else {
        await create.mutateAsync(payload)
        toast.push(t('toast-word-added', { word: payload.word }))
      }
      if (pronunciation) speakWord(payload.word)
      return true
    } catch (error) {
      toast.push(
        error instanceof FreeWordLimitError ? t('err-free-limit') : t('err-generic'),
        'error',
      )
      return false
    }
  }

  // An `add-word` directive from the chat assistant lands here.
  useAppAction('add-word', (action) => {
    void handleSubmit({
      word: action.word,
      definition: action.definition,
      partOfSpeech: action.partOfSpeech,
      example: null,
      folder: filters.folder ?? DEFAULT_FOLDER,
      pronunciation: false,
    })
  })

  const handleDelete = async (word: Word) => {
    setPendingDelete(null)
    if (editing?.id === word.id) setEditing(null)
    try {
      await remove.mutateAsync(word.id)
      toast.push(t('toast-word-deleted', { word: word.word }))
    } catch {
      toast.push(t('err-generic'), 'error')
    }
  }

  const handleMove = async (word: Word, folder: string) => {
    try {
      await update.mutateAsync({ id: word.id, patch: { folder } })
      toast.push(t('toast-word-moved', { word: word.word, folder }))
    } catch {
      toast.push(t('err-generic'), 'error')
    }
  }

  const handleCreateFolder = (name: string) => {
    addFolder(name)
    filters.setFolder(name)
    toast.push(t('toast-folder-created', { name }))
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 pt-6">
        <div className="min-w-[260px] flex-1">
          <SearchBar value={filters.query} onChange={filters.setQuery} />
        </div>
        <ImportWordsButton folder={filters.folder ?? DEFAULT_FOLDER} className="h-[52px]" />
        <Button
          variant="secondary"
          className="h-[52px]"
          disabled={words.length === 0}
          onClick={() => setExportOpen(true)}
        >
          <Download size={16} />
          {t('export-btn')}
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_384px]">
        <FolderSidebar
          folders={folders}
          counts={counts}
          total={words.length}
          active={filters.folder}
          onSelect={filters.setFolder}
          onCreate={() => setFolderDialogOpen(true)}
        />

        <WordList
          words={filters.filtered}
          totalCount={filters.folder ? (counts[filters.folder] ?? 0) : words.length}
          query={filters.query}
          sort={filters.sort}
          onSortChange={filters.setSort}
          partOfSpeech={filters.partOfSpeech}
          onPartOfSpeechChange={filters.setPartOfSpeech}
          editingId={editing?.id ?? null}
          onEdit={setEditing}
          onDelete={setPendingDelete}
          onMove={setMovingWord}
          loading={isLoading}
        />

        <div className="lg:col-span-2 xl:col-span-1">
          <AddWordForm
            folders={folders}
            activeFolder={filters.folder ?? DEFAULT_FOLDER}
            editing={editing}
            submitting={submitting}
            onCancelEdit={() => setEditing(null)}
            onSubmit={handleSubmit}
          />
        </div>
      </div>

      <NewFolderDialog
        open={folderDialogOpen}
        existing={folders}
        onClose={() => setFolderDialogOpen(false)}
        onCreate={handleCreateFolder}
      />

      <MoveWordDialog
        word={movingWord}
        folders={folders}
        onClose={() => setMovingWord(null)}
        onMove={handleMove}
      />

      <ExportDialog
        open={exportOpen}
        words={words}
        onClose={() => setExportOpen(false)}
        onExported={() => toast.push(t('toast-exported'))}
      />

      <ConfirmDeleteDialog
        word={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  )
}
