import { createDictionary, listDictionaries, type DictionaryDto } from '@/api/dictionaries'
import {
  bulkCreateWords,
  createWord as apiCreateWord,
  deleteWord as apiDeleteWord,
  getWord,
  listWords,
  moveWord,
  updateWord as apiUpdateWord,
  type WordDto,
} from '@/api/words'
import { DEFAULT_FOLDER } from '@/lib/folders'
import { isPartOfSpeech, type NewWord, type Word, type WordsBackend } from '@/types/domain'

/** Bridges the frontend's folder concept onto the backend's dictionary_id --
 * mirrors the sync_word_dictionary DB trigger (migration 0002) client-side.
 * Module-level cache, cleared whenever a dictionary is created so a second
 * call in the same session sees it. */
let dictionariesCache: DictionaryDto[] | null = null

/** Test seam: the cache outlives a single test, so suites that swap out the
 * dictionary fixtures between cases must clear it. */
export function resetDictionariesCache(): void {
  dictionariesCache = null
}

async function loadDictionaries(): Promise<DictionaryDto[]> {
  if (dictionariesCache) return dictionariesCache
  const { items } = await listDictionaries()
  dictionariesCache = items
  return items
}

async function resolveDictionaryId(folder: string): Promise<string> {
  const name = folder || DEFAULT_FOLDER
  const dictionaries = await loadDictionaries()
  const match = dictionaries.find((d) => d.name.toLowerCase() === name.toLowerCase())
  if (match) return match.id

  const created = await createDictionary({ name })
  dictionariesCache = null
  return created.id
}

async function folderForDictionaryId(dictionaryId: string): Promise<string> {
  const dictionaries = await loadDictionaries()
  return dictionaries.find((d) => d.id === dictionaryId)?.name ?? DEFAULT_FOLDER
}

function toWord(dto: WordDto, folder: string): Word {
  return {
    id: dto.id,
    word: dto.word,
    definition: dto.definition,
    partOfSpeech: isPartOfSpeech(dto.part_of_speech) ? dto.part_of_speech : 'noun',
    example: dto.example,
    folder,
    createdAt: new Date(dto.created_at).getTime(),
  }
}

async function listAllWordsInDictionary(dictionary: DictionaryDto): Promise<Word[]> {
  const words: Word[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await listWords(dictionary.id, { cursor, limit: 100 })
    words.push(...page.items.map((dto) => toWord(dto, dictionary.name)))
    if (!page.has_more || !page.next_cursor) break
    cursor = page.next_cursor
  }
  return words
}

export const httpWords: WordsBackend = {
  async list() {
    const dictionaries = await loadDictionaries()
    const perDictionary = await Promise.all(dictionaries.map(listAllWordsInDictionary))
    return perDictionary.flat().sort((a, b) => b.createdAt - a.createdAt)
  },

  async create(input: NewWord) {
    const dictionaryId = await resolveDictionaryId(input.folder)
    const dto = await apiCreateWord(dictionaryId, {
      word: input.word,
      definition: input.definition,
      part_of_speech: input.partOfSpeech,
      example: input.example ?? null,
    })
    return toWord(dto, input.folder || DEFAULT_FOLDER)
  },

  async update(id, patch) {
    let dto: WordDto | undefined
    let folder = patch.folder

    if (patch.folder !== undefined) {
      const targetDictionaryId = await resolveDictionaryId(patch.folder)
      dto = await moveWord(id, targetDictionaryId)
    }

    const fieldPatch: Record<string, unknown> = {}
    if (patch.word !== undefined) fieldPatch.word = patch.word
    if (patch.definition !== undefined) fieldPatch.definition = patch.definition
    if (patch.partOfSpeech !== undefined) fieldPatch.part_of_speech = patch.partOfSpeech
    if (patch.example !== undefined) fieldPatch.example = patch.example ?? null

    if (Object.keys(fieldPatch).length > 0) {
      dto = await apiUpdateWord(id, fieldPatch)
    }
    if (!dto) {
      dto = await getWord(id)
    }
    if (folder === undefined) {
      folder = await folderForDictionaryId(dto.dictionary_id)
    }

    return toWord(dto, folder)
  },

  async remove(id) {
    await apiDeleteWord(id)
  },

  async replaceAll(words) {
    const existing = await httpWords.list()
    const keepIds = new Set(words.map((w) => w.id))
    await Promise.all(existing.filter((w) => !keepIds.has(w.id)).map((w) => apiDeleteWord(w.id)))

    const existingIds = new Set(existing.map((w) => w.id))
    const toCreate = words.filter((w) => !existingIds.has(w.id))

    const byFolder = new Map<string, NewWord[]>()
    for (const word of toCreate) {
      const folder = word.folder || DEFAULT_FOLDER
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), word])
    }
    for (const [folder, wordsForFolder] of byFolder) {
      const dictionaryId = await resolveDictionaryId(folder)
      await bulkCreateWords(
        dictionaryId,
        wordsForFolder.map((w) => ({
          word: w.word,
          definition: w.definition,
          part_of_speech: w.partOfSpeech,
          example: w.example ?? null,
        })),
      )
    }
  },
}
