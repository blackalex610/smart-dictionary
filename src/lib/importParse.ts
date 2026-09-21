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

/**
 * Splits a CSV document into rows of cells per RFC 4180: a quoted cell may
 * contain commas, newlines, and `""` as an escaped literal quote. A naive
 * `line.split(',')` (what `parseStructuredLines` does for AI output) breaks
 * on exactly the cells `csvCell` in lib/export.ts quotes for -- a definition
 * containing a comma -- so exported CSV needs its own tokenizer rather than
 * reusing that line-oriented parser.
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
        } else {
          inQuotes = false
          i++
        }
      } else {
        cell += char
        i++
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
      i++
    } else if (char === ',') {
      row.push(cell)
      cell = ''
      i++
    } else if (char === '\r') {
      i++
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else {
      cell += char
      i++
    }
  }
  // A file without a trailing newline still has one unflushed row.
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

const CSV_COLUMNS = ['word', 'definition', 'part of speech', 'example', 'folder']

/**
 * Round-trips a CSV file produced by our own export (`serialise` in
 * lib/export.ts). Returns null when the header doesn't match, so a generic
 * spreadsheet CSV still falls through to the AI endpoint instead of being
 * silently misread by this exact-header parser.
 */
export function parseCsvExport(text: string): ParsedImport | null {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return null

  const header = rows[0].map((cell) => cell.trim().toLowerCase())
  const matchesHeader =
    header.length >= 3 && CSV_COLUMNS.slice(0, header.length).every((name, i) => header[i] === name)
  if (!matchesHeader) return null

  const wordIdx = header.indexOf('word')
  const definitionIdx = header.indexOf('definition')
  const posIdx = header.indexOf('part of speech')
  const exampleIdx = header.indexOf('example')

  const words: Omit<NewWord, 'folder'>[] = []
  let skipped = 0

  rows.slice(1).forEach((cells) => {
    if (cells.length === 1 && cells[0].trim() === '') return // blank trailing line

    const word = (cells[wordIdx] ?? '').trim()
    const definition = (cells[definitionIdx] ?? '').trim()
    const partOfSpeech = (cells[posIdx] ?? '').trim().toLowerCase()
    if (!word || !definition || !isPartOfSpeech(partOfSpeech)) {
      skipped++
      return
    }
    const example = exampleIdx >= 0 ? (cells[exampleIdx] ?? '').trim() : ''
    words.push({ word, definition, partOfSpeech, example: example || null })
  })

  return words.length > 0 || skipped > 0 ? { words, skipped } : null
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
