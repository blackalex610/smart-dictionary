import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/context/I18nContext'
import { useRefreshAiUsage } from '@/hooks/useAiUsage'
import { useWordsBackend } from '@/hooks/useWords'
import { AiDailyLimitError, FreeWordLimitError } from '@/lib/errors'
import { DEFAULT_FOLDER } from '@/lib/folders'
import { extractFileText, IMPORT_ACCEPT, UnreadableFileError } from '@/lib/importExtract'
import { DEFAULT_IMPORT_OPTIONS, prepareImportText, type ImportOptions } from '@/lib/importOptions'
import { parseJsonExport, parseStructuredLines, type ParsedImport } from '@/lib/importParse'
import { aiStructureWords } from '@/lib/supabase/ai'
import { ImportOptionsDialog } from './ImportOptionsDialog'
import type { NewWord } from '@/types/domain'

const MAX_IMPORT = 200
const MAX_AI_CHARS = 8000

interface Props {
  folder?: string
  variant?: 'primary' | 'secondary'
  className?: string
}

/**
 * Reads any of the formats the paper lists (.txt, .md, .rtf, .doc, .docx,
 * .html, .xml, plus our own .csv/.json exports), applies the pre-processing
 * options, then hands anything still unstructured to the `structure-words` AI
 * endpoint — which is what the vanilla import did for every file.
 */
export function ImportWordsButton({ folder, variant = 'secondary', className }: Props) {
  const t = useT()
  const toast = useToast()
  const { state } = useAuth()
  const backend = useWordsBackend()
  const queryClient = useQueryClient()
  const refreshUsage = useRefreshAiUsage()

  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS)

  const parse = async (text: string): Promise<ParsedImport> => {
    const asJson = parseJsonExport(text)
    if (asJson) return asJson

    const structured = parseStructuredLines(text)
    if (structured.words.length > 0) return structured

    if (state.status !== 'authenticated') throw new Error('IMPORT_NEEDS_AI')
    const { content } = await aiStructureWords(text.slice(0, MAX_AI_CHARS))
    refreshUsage()
    return parseStructuredLines(content)
  }

  const run = async (file: File, chosen: ImportOptions) => {
    setBusy(true)
    try {
      const raw = await extractFileText(file)
      // Our own JSON export must survive verbatim — line/paragraph splitting
      // would destroy it, so it is detected before any pre-processing.
      const asJson = parseJsonExport(raw)
      const prepared = asJson ? null : prepareImportText(raw, chosen)
      const parsed = asJson ?? (await parse(prepared?.text ?? raw))

      if (prepared && prepared.dropped > 0) {
        toast.push(t('toast-import-dropped', { n: prepared.dropped }), 'info')
      }

      if (parsed.words.length === 0) {
        toast.push(t('err-import-empty'), 'error')
        return
      }
      if (!backend) return

      const target = folder || DEFAULT_FOLDER
      let added = 0
      let failed = 0

      for (const entry of parsed.words.slice(0, MAX_IMPORT)) {
        const input: NewWord = { ...entry, folder: target }
        try {
          await backend.create(input)
          added++
        } catch (error) {
          failed++
          if (error instanceof FreeWordLimitError) {
            toast.push(t('err-free-limit'), 'error')
            break
          }
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['words'] })

      if (added > 0) toast.push(t('toast-imported', { n: added }))
      if (added === 0 && failed > 0) toast.push(t('err-import-failed'), 'error')
    } catch (error) {
      if (error instanceof AiDailyLimitError) toast.push(t('ai-limit-reached'), 'error')
      else if (error instanceof UnreadableFileError) {
        toast.push(
          t(error.reason === 'unsupported' ? 'err-import-unsupported' : 'err-import-unreadable'),
          'error',
        )
      } else if (error instanceof Error && error.message === 'IMPORT_NEEDS_AI') {
        toast.push(t('err-import-needs-account'), 'error')
      } else toast.push(t('err-import-failed'), 'error')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) setPendingFile(file)
        }}
      />
      <Button
        variant={variant}
        loading={busy}
        className={className}
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={16} />
        {t('import-btn')}
      </Button>

      {pendingFile && (
        <ImportOptionsDialog
          open
          fileName={pendingFile.name}
          initial={options}
          onClose={() => {
            setPendingFile(null)
            if (inputRef.current) inputRef.current.value = ''
          }}
          onConfirm={(chosen) => {
            const file = pendingFile
            setOptions(chosen)
            setPendingFile(null)
            void run(file, chosen)
          }}
        />
      )}
    </>
  )
}
