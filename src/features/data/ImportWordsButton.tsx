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
import { parseJsonExport, parseStructuredLines, type ParsedImport } from '@/lib/importParse'
import { aiStructureWords } from '@/lib/supabase/ai'
import type { NewWord } from '@/types/domain'

const MAX_IMPORT = 200

interface Props {
  folder?: string
  variant?: 'primary' | 'secondary'
  className?: string
}

/**
 * Reads a `.txt`/`.csv`/`.json` file. Already-structured files are parsed
 * locally; anything else is handed to the `structure-words` AI endpoint, which
 * is what the vanilla import did for every file.
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

  const parse = async (text: string): Promise<ParsedImport> => {
    const asJson = parseJsonExport(text)
    if (asJson) return asJson

    const structured = parseStructuredLines(text)
    if (structured.words.length > 0) return structured

    if (state.status !== 'authenticated') throw new Error('IMPORT_NEEDS_AI')
    const { content } = await aiStructureWords(text.slice(0, 8000))
    refreshUsage()
    return parseStructuredLines(content)
  }

  const handleFile = async (file: File) => {
    setBusy(true)
    try {
      const text = await file.text()
      const parsed = await parse(text)

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
      else if (error instanceof Error && error.message === 'IMPORT_NEEDS_AI') {
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
        accept=".txt,.csv,.json,text/plain,text/csv,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFile(file)
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
    </>
  )
}
