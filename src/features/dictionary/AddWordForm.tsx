import { useState } from 'react'
import { AudioLines, ChevronDown, Plus, X } from 'lucide-react'
import { useT } from '@/context/I18nContext'
import { cn } from '@/lib/cn'
import { Spinner } from '@/components/ui/Spinner'
import { PARTS_OF_SPEECH, type NewWord, type PartOfSpeech, type Word } from '@/types/domain'
import type { TranslationKey } from '@/i18n'

const WORD_MAX = 100
const MEANING_MAX = 500
const EXAMPLE_MAX = 250

interface Props {
  folders: string[]
  activeFolder: string
  editing: Word | null
  submitting: boolean
  onCancelEdit: () => void
  onSubmit: (input: NewWord & { pronunciation: boolean }) => Promise<boolean>
}

interface FieldProps {
  label: React.ReactNode
  htmlFor: string
  children: React.ReactNode
  className?: string
}

function Field({ label, htmlFor, children, className }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-2 block text-[13.5px] font-medium text-fg">
        {label}
      </label>
      {children}
    </div>
  )
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span
      className={cn(
        'pointer-events-none text-[12px] tabular-nums',
        value > max * 0.9 ? 'text-warning' : 'text-fg-subtle',
      )}
    >
      {value}/{max}
    </span>
  )
}

export function AddWordForm({
  folders,
  activeFolder,
  editing,
  submitting,
  onCancelEdit,
  onSubmit,
}: Props) {
  const t = useT()
  const [word, setWord] = useState(editing?.word ?? '')
  const [meaning, setMeaning] = useState(editing?.definition ?? '')
  const [partOfSpeech, setPartOfSpeech] = useState<PartOfSpeech | ''>(editing?.partOfSpeech ?? '')
  const [folder, setFolder] = useState(editing?.folder ?? activeFolder)
  const [example, setExample] = useState(editing?.example ?? '')
  const [pronunciation, setPronunciation] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Adjust form state during render when the edit target or active folder
  // changes, rather than in an effect — avoids the extra render an effect
  // would cause and the flash of stale values it would produce on the first
  // paint after `editing` changes. See https://react.dev/learn/you-might-not-need-an-effect
  const [snapshot, setSnapshot] = useState({ editingId: editing?.id ?? null, activeFolder })
  const changed =
    snapshot.editingId !== (editing?.id ?? null) || snapshot.activeFolder !== activeFolder
  if (changed) {
    const wasEditing = snapshot.editingId !== null
    setSnapshot({ editingId: editing?.id ?? null, activeFolder })
    if (editing) {
      setWord(editing.word)
      setMeaning(editing.definition)
      setPartOfSpeech(editing.partOfSpeech)
      setFolder(editing.folder)
      setExample(editing.example ?? '')
      setError(null)
    } else {
      // Leaving edit mode (Cancel, or a successful save) has to clear the
      // fields: otherwise the edited word's text stays in what is now the
      // "add new word" form, and the next submit re-adds it -- which the
      // duplicate check then rejects with a confusing error. Only the
      // active folder changing keeps whatever the user has typed.
      if (wasEditing) {
        setWord('')
        setMeaning('')
        setPartOfSpeech('')
        setExample('')
        setPronunciation(false)
        setError(null)
      }
      setFolder(activeFolder)
    }
  }

  const reset = () => {
    setWord('')
    setMeaning('')
    setPartOfSpeech('')
    setExample('')
    setPronunciation(false)
    setError(null)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return

    const trimmedWord = word.trim()
    const trimmedMeaning = meaning.trim()

    if (!trimmedWord) return setError(t('err-word-required'))
    if (!trimmedMeaning) return setError(t('err-meaning-required'))
    if (!partOfSpeech) return setError(t('err-pos-required'))

    setError(null)
    const ok = await onSubmit({
      word: trimmedWord,
      definition: trimmedMeaning,
      partOfSpeech,
      example: example.trim() || null,
      folder: folder || activeFolder,
      pronunciation,
    })
    if (ok) reset()
  }

  const selectClass =
    'h-[46px] w-full appearance-none truncate rounded-[10px] border border-line bg-surface pl-3 pr-6 text-[13.5px] text-fg transition focus:border-brand focus:outline-none focus:ring-0'

  return (
    <aside className="flex h-full flex-col rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3.5">
        <button
          type="submit"
          form="add-word-form"
          disabled={submitting}
          aria-label={editing ? t('save-changes') : t('add-word-btn')}
          title={editing ? t('save-changes') : t('add-word-btn')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-brand text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <Spinner /> : <Plus size={20} strokeWidth={2.5} />}
        </button>
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold leading-tight text-fg">
            {editing ? t('edit-word') : t('add-new-word')}
          </h2>
          <p className="mt-1 text-[13.5px] text-fg-muted">{t('add-word-subtitle')}</p>
        </div>
        {editing && (
          <button
            type="button"
            onClick={onCancelEdit}
            aria-label={t('cancel-edit')}
            className="ml-auto rounded-lg p-1.5 text-fg-subtle transition hover:bg-surface-2 hover:text-fg"
          >
            <X size={17} />
          </button>
        )}
      </div>

      <form
        id="add-word-form"
        onSubmit={handleSubmit}
        className="mt-5 flex flex-1 flex-col"
        noValidate
      >
        <Field label={t('add-word-label')} htmlFor="field-word">
          <div className="flex h-[46px] items-center gap-2 rounded-[10px] border border-line bg-surface pl-3.5 pr-3 transition focus-within:border-brand">
            <input
              id="field-word"
              value={word}
              maxLength={WORD_MAX}
              onChange={(event) => setWord(event.target.value)}
              placeholder={t('word-placeholder')}
              className="h-full flex-1 border-0 bg-transparent p-0 text-[14.5px] text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-0"
            />
            <Counter value={word.length} max={WORD_MAX} />
          </div>
        </Field>

        <Field label={t('meaning-label')} htmlFor="field-meaning" className="mt-4">
          <div className="rounded-[10px] border border-line bg-surface px-3.5 py-3 transition focus-within:border-brand">
            <textarea
              id="field-meaning"
              value={meaning}
              maxLength={MEANING_MAX}
              onChange={(event) => setMeaning(event.target.value)}
              placeholder={t('meaning-placeholder')}
              rows={4}
              className="w-full resize-none border-0 bg-transparent p-0 text-[14.5px] leading-relaxed text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-0"
            />
            <div className="flex justify-end">
              <Counter value={meaning.length} max={MEANING_MAX} />
            </div>
          </div>
        </Field>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label={t('part-of-speech-label')} htmlFor="field-pos">
            <div className="relative">
              <select
                id="field-pos"
                value={partOfSpeech}
                onChange={(event) => setPartOfSpeech(event.target.value as PartOfSpeech | '')}
                className={cn(selectClass, !partOfSpeech && 'text-fg-subtle')}
              >
                <option value="">{t('part-of-speech-select')}</option>
                {PARTS_OF_SPEECH.map((pos) => (
                  <option key={pos} value={pos}>
                    {t(pos as TranslationKey)}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted"
              />
            </div>
          </Field>

          <Field label={t('folder-label')} htmlFor="field-folder">
            <div className="relative">
              <select
                id="field-folder"
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                className={selectClass}
              >
                {folders.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted"
              />
            </div>
          </Field>
        </div>

        <Field
          className="mt-4"
          htmlFor="field-example"
          label={
            <>
              {t('example-label')}{' '}
              <span className="font-normal text-fg-subtle">{t('optional')}</span>
            </>
          }
        >
          <div className="rounded-[10px] border border-line bg-surface px-3.5 py-3 transition focus-within:border-brand">
            <textarea
              id="field-example"
              value={example}
              maxLength={EXAMPLE_MAX}
              onChange={(event) => setExample(event.target.value)}
              placeholder={t('example-placeholder')}
              rows={2}
              className="w-full resize-none border-0 bg-transparent p-0 text-[14.5px] leading-relaxed text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-0"
            />
            <div className="flex justify-end">
              <Counter value={example.length} max={EXAMPLE_MAX} />
            </div>
          </div>
        </Field>

        <div className="mt-5 flex items-center gap-2.5">
          <AudioLines size={17} className="text-fg-muted" />
          <span className="text-[14px] text-fg">{t('add-pronunciation')}</span>
          <span className="rounded-md bg-brand-soft px-1.5 py-[2px] text-[11.5px] font-medium text-brand">
            {t('beta')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={pronunciation}
            aria-label={t('add-pronunciation')}
            onClick={() => setPronunciation((prev) => !prev)}
            className={cn(
              'ml-auto flex h-[26px] w-[46px] shrink-0 items-center rounded-full p-[3px] transition',
              pronunciation ? 'bg-brand' : 'bg-[#E3E6EB] dark:bg-line',
            )}
          >
            <span
              className={cn(
                'h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                pronunciation ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-error-soft px-3 py-2 text-[13.5px] text-error"
          >
            {error}
          </p>
        )}
      </form>
    </aside>
  )
}
