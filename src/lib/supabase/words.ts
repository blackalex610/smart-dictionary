import { supabase } from './client'
import {
  DuplicateWordError,
  FreeWordLimitError,
  isFreeWordLimit,
  isUniqueViolation,
  isUnknownColumn,
} from '@/lib/errors'
import { DEFAULT_FOLDER } from '@/lib/folders'
import { isPartOfSpeech, type NewWord, type Word, type WordsBackend } from '@/types/domain'

interface WordRow {
  id: string
  word: string
  definition: string | null
  part_of_speech: string | null
  example?: string | null
  folder: string | null
  created_at: string
}

/**
 * `example` is an additive column (supabase/migrations/…0007). If the migration
 * has not been applied yet the client silently degrades instead of breaking.
 */
let hasExampleColumn = true

const SELECT_WITH_EXAMPLE = 'id, word, definition, part_of_speech, example, folder, created_at'
const SELECT_BASE = 'id, word, definition, part_of_speech, folder, created_at'
const LIST_PAGE_SIZE = 1000

function toWord(row: WordRow): Word {
  const pos = row.part_of_speech
  return {
    id: row.id,
    word: row.word,
    definition: row.definition ?? '',
    partOfSpeech: isPartOfSpeech(pos) ? pos : 'noun',
    example: row.example ?? null,
    folder: row.folder || DEFAULT_FOLDER,
    createdAt: new Date(row.created_at).getTime(),
  }
}

function toRow(input: Partial<NewWord>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (input.word !== undefined) row.word = input.word
  if (input.definition !== undefined) row.definition = input.definition
  if (input.partOfSpeech !== undefined) row.part_of_speech = input.partOfSpeech
  if (input.folder !== undefined) row.folder = input.folder
  if (input.example !== undefined && hasExampleColumn) row.example = input.example || null
  return row
}

/**
 * From the local session: `getUser()` would add an auth-server round trip to
 * every insert (200 of them for one import). RLS re-checks the JWT anyway.
 */
async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('NOT_AUTHENTICATED')
  return id
}

export const supabaseWords: WordsBackend = {
  async list() {
    // PostgREST caps a response at `max-rows` (1000 on Supabase), so a large
    // dictionary has to be read page by page or words silently go missing.
    const run = (columns: string, from: number) =>
      supabase
        .from('words')
        .select(columns)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + LIST_PAGE_SIZE - 1)

    const rows: WordRow[] = []
    for (let from = 0; ; from += LIST_PAGE_SIZE) {
      let { data, error } = await run(hasExampleColumn ? SELECT_WITH_EXAMPLE : SELECT_BASE, from)
      if (error && isUnknownColumn(error, 'example')) {
        hasExampleColumn = false
        ;({ data, error } = await run(SELECT_BASE, from))
      }
      if (error) throw error
      const page = (data ?? []) as unknown as WordRow[]
      rows.push(...page)
      if (page.length < LIST_PAGE_SIZE) break
    }
    return rows.map(toWord)
  },

  async create(input) {
    const userId = await currentUserId()
    const insert = async () =>
      supabase
        .from('words')
        .insert({ user_id: userId, ...toRow(input) })
        .select(hasExampleColumn ? SELECT_WITH_EXAMPLE : SELECT_BASE)
        .single()

    let { data, error } = await insert()
    if (error && isUnknownColumn(error, 'example')) {
      hasExampleColumn = false
      ;({ data, error } = await insert())
    }
    if (error) {
      if (isFreeWordLimit(error)) throw new FreeWordLimitError()
      if (isUniqueViolation(error)) throw new DuplicateWordError(input.word)
      throw error
    }
    return toWord(data as unknown as WordRow)
  },

  async update(id, patch) {
    const run = async () =>
      supabase
        .from('words')
        .update(toRow(patch))
        .eq('id', id)
        .select(hasExampleColumn ? SELECT_WITH_EXAMPLE : SELECT_BASE)
        .single()

    let { data, error } = await run()
    if (error && isUnknownColumn(error, 'example')) {
      hasExampleColumn = false
      ;({ data, error } = await run())
    }
    if (error) {
      if (isUniqueViolation(error)) throw new DuplicateWordError(patch.word ?? '')
      throw error
    }
    return toWord(data as unknown as WordRow)
  },

  async remove(id) {
    const { error } = await supabase.from('words').delete().eq('id', id)
    if (error) throw error
  },

  async clear() {
    // One statement scoped to the owner (RLS enforces the same), instead of
    // listing ids client-side and sending them back in a giant `in (...)`.
    const userId = await currentUserId()
    const { error } = await supabase.from('words').delete().eq('user_id', userId)
    if (error) throw error
  },
}

export async function countWords(): Promise<number> {
  const { count, error } = await supabase.from('words').select('id', { count: 'exact', head: true })
  if (error) return 0
  return count ?? 0
}
