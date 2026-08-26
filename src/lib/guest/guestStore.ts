import { readJson, writeJson } from '@/lib/storage'
import { DEFAULT_FOLDER, getFolderFromDate } from '@/lib/folders'
import { isPartOfSpeech, type NewWord, type Word, type WordsBackend } from '@/types/domain'

const KEY = 'dictionary_guest'

interface LegacyWord {
  id?: string
  word?: string
  definition?: string
  partOfSpeech?: string
  example?: string | null
  folder?: string
  timestamp?: number
  createdAt?: number
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Tolerates the vanilla app's shape (`timestamp`, missing id/folder). */
function normalise(raw: LegacyWord): Word {
  const createdAt = raw.createdAt ?? raw.timestamp ?? Date.now()
  return {
    id: raw.id ?? newId(),
    word: raw.word ?? '',
    definition: raw.definition ?? '',
    partOfSpeech: isPartOfSpeech(raw.partOfSpeech) ? raw.partOfSpeech : 'noun',
    example: raw.example ?? null,
    folder: raw.folder || getFolderFromDate(createdAt) || DEFAULT_FOLDER,
    createdAt,
  }
}

function readAll(): Word[] {
  const raw = readJson<LegacyWord[]>(KEY, [])
  if (!Array.isArray(raw)) return []
  return raw.map(normalise).sort((a, b) => b.createdAt - a.createdAt)
}

function writeAll(words: Word[]): void {
  writeJson(KEY, words)
}

export const guestWords: WordsBackend = {
  async list() {
    return readAll()
  },

  async create(input: NewWord) {
    const words = readAll()
    const word: Word = {
      id: newId(),
      word: input.word,
      definition: input.definition,
      partOfSpeech: input.partOfSpeech,
      example: input.example ?? null,
      folder: input.folder || DEFAULT_FOLDER,
      createdAt: Date.now(),
    }
    writeAll([word, ...words])
    return word
  },

  async update(id, patch) {
    const words = readAll()
    const index = words.findIndex((w) => w.id === id)
    if (index === -1) throw new Error('WORD_NOT_FOUND')
    const next: Word = {
      ...words[index],
      ...(patch.word !== undefined ? { word: patch.word } : {}),
      ...(patch.definition !== undefined ? { definition: patch.definition } : {}),
      ...(patch.partOfSpeech !== undefined ? { partOfSpeech: patch.partOfSpeech } : {}),
      ...(patch.folder !== undefined ? { folder: patch.folder } : {}),
      ...(patch.example !== undefined ? { example: patch.example ?? null } : {}),
    }
    words[index] = next
    writeAll(words)
    return next
  },

  async remove(id) {
    writeAll(readAll().filter((w) => w.id !== id))
  },

  async replaceAll(words) {
    writeAll(words)
  },
}
