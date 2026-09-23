import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/context/I18nContext'
import { useRefreshAiUsage } from '@/hooks/useAiUsage'
import { useWords, useWordsBackend } from '@/hooks/useWords'
import {
  AiDailyLimitError,
  AiRateLimitError,
  AiUnavailableError,
  FreeWordLimitError,
  StorageWriteError,
} from '@/lib/errors'
import { DEFAULT_FOLDER } from '@/lib/folders'
import { extractFileText, IMPORT_ACCEPT, UnreadableFileError } from '@/lib/importExtract'
import { DEFAULT_IMPORT_OPTIONS, prepareImportText, type ImportOptions } from '@/lib/importOptions'
import {
  parseAiEntries,
  parseOwnExport,
  parseStructuredLines,
  parseStructuredList,
  planImport,
  type ImportPlan,
  type ParsedImport,
} from '@/lib/importParse'
import { aiStructureWords } from '@/lib/supabase/ai'
import { ImportOptionsDialog } from './ImportOptionsDialog'
import { ImportPreviewDialog } from './ImportPreviewDialog'
import type { TranslationKey } from '@/i18n'

const MAX_IMPORT = 200
const MAX_AI_CHARS = 8000
/** Stop saving after this many failures in a row (offline, backend down). */
const MAX_CONSECUTIVE_FAILURES = 3

interface Props {
  folder?: string
  variant?: 'primary' | 'secondary'
  className?: string
}

interface Preview {
  plan: ImportPlan
  invalid: number
  folder: string
}

const UNREADABLE_KEYS: Record<UnreadableFileError['reason'], TranslationKey> = {
  empty: 'err-import-empty',
  unsupported: 'err-import-unsupported',
  corrupt: 'err-import-unreadable',
  'too-large': 'err-import-too-large',
}

/**
 * Reads any of the formats the paper lists (.txt, .md, .rtf, .doc, .docx,
 * .html, .xml, plus our own .csv/.json/.txt exports), applies the
 * pre-processing options, hands anything still unstructured to the
 * `structure-words` AI endpoint, then shows a preview. Nothing is written until
 * the user confirms it.
 */
export function ImportWordsButton({ folder, variant = 'secondary', className }: Props) {
  const t = useT()
  const toast = useToast()
  const { state } = useAuth()
  const backend = useWordsBackend()
  const { data: dictionary = [] } = useWords()
  const queryClient = useQueryClient()
  const refreshUsage = useRefreshAiUsage()

  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null)

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = ''
  }

  const parse = async (raw: string, chosen: ImportOptions): Promise<ParsedImport> => {
    // Our own exports must survive verbatim — line/paragraph splitting would
    // destroy them, so they are detected before any pre-processing.
    const own = parseOwnExport(raw)
    if (own) return own
    const list = parseStructuredList(raw)
    if (list) return list

    const prepared = prepareImportText(raw, chosen)
    if (prepared.dropped > 0) {
      toast.push(t('toast-import-dropped', { n: prepared.dropped }), 'info')
    }

    const structured = parseStructuredLines(prepared.text)
    if (structured.words.length > 0) return structured

    if (state.status !== 'authenticated') throw new Error('IMPORT_NEEDS_AI')
    if (prepared.text.length > MAX_AI_CHARS) toast.push(t('toast-import-truncated'), 'info')

    try {
      const result = await aiStructureWords(prepared.text.slice(0, MAX_AI_CHARS))
      return Array.isArray(result.entries)
        ? parseAiEntries(result.entries)
        : parseStructuredLines(result.content ?? '')
    } finally {
      refreshUsage()
    }
  }

  const read = async (file: File, chosen: ImportOptions) => {
    setBusy(true)
    try {
      const raw = await extractFileText(file)
      const parsed = await parse(raw, chosen)

      if (parsed.words.length === 0) {
        toast.push(t('err-import-empty'), 'error')
        return
      }
      setPreview({
        plan: planImport(parsed.words, dictionary, MAX_IMPORT),
        invalid: parsed.skipped,
        folder: folder || DEFAULT_FOLDER,
      })
    } catch (error) {
      if (error instanceof AiDailyLimitError) toast.push(t('ai-limit-reached'), 'error')
      else if (error instanceof AiRateLimitError) toast.push(t('ai-rate-limited'), 'error')
      else if (error instanceof AiUnavailableError) {
        toast.push(t(error.code === 'OFFLINE' ? 'err-offline' : 'ai-unavailable'), 'error')
      } else if (error instanceof UnreadableFileError) {
        toast.push(t(UNREADABLE_KEYS[error.reason]), 'error')
      } else if (error instanceof Error && error.message === 'IMPORT_NEEDS_AI') {
        toast.push(t('err-import-needs-account'), 'error')
      } else toast.push(t('err-import-failed'), 'error')
    } finally {
      setBusy(false)
      resetInput()
    }
  }

  const commit = async () => {
    if (!preview || !backend || saving) return
    const { plan, folder: target } = preview
    const total = plan.toAdd.length
    let added = 0
    let failed = 0
    let consecutive = 0
    let stopReason: TranslationKey | null = null

    setSaving({ done: 0, total })
    for (const entry of plan.toAdd) {
      try {
        await backend.create({ ...entry, folder: target })
        added++
        consecutive = 0
      } catch (error) {
        failed++
        consecutive++
        if (error instanceof FreeWordLimitError) stopReason = 'err-free-limit'
        else if (error instanceof StorageWriteError) stopReason = 'err-storage-full'
        else if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
          stopReason = navigator.onLine === false ? 'err-offline' : 'err-import-failed'
        }
        if (stopReason) break
      }
      setSaving({ done: added + failed, total })
    }

    await queryClient.invalidateQueries({ queryKey: ['words'] })
    setSaving(null)
    setPreview(null)

    const notSaved = total - added
    if (added > 0 && notSaved === 0) toast.push(t('toast-imported', { n: added }))
    else if (added > 0) toast.push(t('toast-import-partial', { added, failed: notSaved }), 'info')
    if (stopReason) toast.push(t(stopReason), 'error')
    else if (added === 0) toast.push(t('err-import-failed'), 'error')
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
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
            resetInput()
          }}
          onConfirm={(chosen) => {
            const file = pendingFile
            setOptions(chosen)
            setPendingFile(null)
            void read(file, chosen)
          }}
        />
      )}

      {preview && (
        <ImportPreviewDialog
          plan={preview.plan}
          invalid={preview.invalid}
          folder={preview.folder}
          maxPerImport={MAX_IMPORT}
          saving={saving}
          onCancel={() => setPreview(null)}
          onConfirm={() => void commit()}
        />
      )}
    </>
  )
}
