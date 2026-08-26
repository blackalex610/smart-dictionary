import { isPartOfSpeech, type NewWord } from '@/types/domain'

export interface ParsedImport {
  words: Omit<NewWord, 'folder'>[]
  /** Lines that were dropped because they were malformed. */
  skipped: number
}

/**
 * Parses the `word,definition,pos` lines the `structure-words` AI endpoint
 * returns. Definitions may themselves contain commas, so only the first and the
 * last separator are treated as field boundaries.
 */
export function parseStructuredLines(text: string): ParsedImport {
  const words: Omit<NewWord, 'folder'>[] = []
  let skipped = 0

  text.split('\n').forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) return

    const first = line.indexOf(',')
    const last = line.lastIndexOf(',')
    if (first === -1 || first === last) {
      skipped++
      return
    }

    const word = line.slice(0, first).trim()
    const definition = line.slice(first + 1, last).trim()
    const partOfSpeech = line
      .slice(last + 1)
      .trim()
      .toLowerCase()

    if (!word || !definition || !isPartOfSpeech(partOfSpeech)) {
      skipped++
      return
    }
    words.push({ word, definition, partOfSpeech })
  })

  return { words, skipped }
}

interface JsonWord {
  word?: unknown
  definition?: unknown
  partOfSpeech?: unknown
  example?: unknown
}

/** Round-trips a JSON file produced by our own export. Returns null if it is not one. */
export function parseJsonExport(text: string): ParsedImport | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(data)) return null

  const words: Omit<NewWord, 'folder'>[] = []
  let skipped = 0

  data.forEach((entry: JsonWord) => {
    const word = typeof entry?.word === 'string' ? entry.word.trim() : ''
    const definition = typeof entry?.definition === 'string' ? entry.definition.trim() : ''
    const partOfSpeech = entry?.partOfSpeech
    if (!word || !definition || !isPartOfSpeech(partOfSpeech)) {
      skipped++
      return
    }
    words.push({
      word,
      definition,
      partOfSpeech,
      example: typeof entry.example === 'string' ? entry.example : null,
    })
  })

  return words.length > 0 || skipped > 0 ? { words, skipped } : null
}
