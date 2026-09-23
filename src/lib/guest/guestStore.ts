import { readString, writeJsonOrThrow, writeString } from '@/lib/storage'
import { DEFAULT_FOLDER, getFolderFromDate } from '@/lib/folders'
import { isPartOfSpeech, type NewWord, type Word, type WordsBackend } from '@/types/domain'

export const GUEST_WORDS_KEY = 'dictionary_guest'

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
function normalise(raw: LegacyWord): Word | null {
  const word = typeof raw?.word === 'string' ? raw.word.trim() : ''
  if (!word) return null
  const createdAt = Number.isFinite(raw.createdAt)
    ? Number(raw.createdAt)
    : Number.isFinite(raw.timestamp)
      ? Number(raw.timestamp)
      : Date.now()
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    word,
    definition: typeof raw.definition === 'string' ? raw.definition : '',
    partOfSpeech: isPartOfSpeech(raw.partOfSpeech) ? raw.partOfSpeech : 'noun',
    example: typeof raw.example === 'string' ? raw.example : null,
    folder: raw.folder || getFolderFromDate(createdAt) || DEFAULT_FOLDER,
    createdAt,
  }
}

/**
 * If the stored value cannot be parsed it is copied aside once before anything
 * overwrites it, so a corrupted dictionary can still be recovered by hand.
 */
function backUpCorrupt(raw: string): void {
  const backupKey = `${GUEST_WORDS_KEY}_corrupt_backup`
  if (readString(backupKey) === null) writeString(backupKey, raw)
}

export function readGuestWords(): Word[] {
  const raw = readString(GUEST_WORDS_KEY)
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    backUpCorrupt(raw)
    return []
  }
  if (!Array.isArray(parsed)) {
    backUpCorrupt(raw)
    return []
  }
  return parsed
    .map((entry) => normalise(entry as LegacyWord))
    .filter((word): word is Word => word !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Throws `StorageWriteError` when the browser refuses — the caller must not report success. */
function writeAll(words: Word[]): void {
  writeJsonOrThrow(GUEST_WORDS_KEY, words)
}

export const guestWords: WordsBackend = {
  async list() {
    return readGuestWords()
  },

  async create(input: NewWord) {
    const words = readGuestWords()
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
    const words = readGuestWords()
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
    writeAll(readGuestWords().filter((w) => w.id !== id))
  },

  async clear() {
    writeAll([])
  },
}
