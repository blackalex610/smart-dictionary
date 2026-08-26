import { supabase } from './client'
import { FreeWordLimitError, isFreeWordLimit, isUnknownColumn } from '@/lib/errors'
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

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const id = data.user?.id
  if (!id) throw new Error('NOT_AUTHENTICATED')
  return id
}

export const supabaseWords: WordsBackend = {
  async list() {
    const run = (columns: string) =>
      supabase.from('words').select(columns).order('created_at', { ascending: false })

    let { data, error } = await run(hasExampleColumn ? SELECT_WITH_EXAMPLE : SELECT_BASE)
    if (error && isUnknownColumn(error, 'example')) {
      hasExampleColumn = false
      ;({ data, error } = await run(SELECT_BASE))
    }
    if (error) throw error
    return ((data ?? []) as unknown as WordRow[]).map(toWord)
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
    if (error) throw error
    return toWord(data as unknown as WordRow)
  },

  async remove(id) {
    const { error } = await supabase.from('words').delete().eq('id', id)
    if (error) throw error
  },

  async replaceAll(words) {
    const userId = await currentUserId()
    const existing = await supabaseWords.list()
    const keep = new Set(words.map((w) => w.id))
    const toDelete = existing.filter((w) => !keep.has(w.id)).map((w) => w.id)

    if (toDelete.length) {
      const { error } = await supabase.from('words').delete().in('id', toDelete)
      if (error) throw error
    }
    if (words.length) {
      const rows = words.map((w) => ({
        id: w.id,
        user_id: userId,
        ...toRow({
          word: w.word,
          definition: w.definition,
          partOfSpeech: w.partOfSpeech,
          folder: w.folder,
          example: w.example,
        }),
      }))
      const { error } = await supabase.from('words').upsert(rows, { onConflict: 'id' })
      if (error) {
        if (isFreeWordLimit(error)) throw new FreeWordLimitError()
        throw error
      }
    }
  },
}

export async function countWords(): Promise<number> {
  const { count, error } = await supabase.from('words').select('id', { count: 'exact', head: true })
  if (error) return 0
  return count ?? 0
}
