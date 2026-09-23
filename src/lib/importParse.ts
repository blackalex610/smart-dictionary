import { answerKey, cleanText, LIMITS, validateEntry } from '@shared/aiValidation'
import type { NewWord, Word } from '@/types/domain'

export type ImportEntry = Omit<NewWord, 'folder'>

export interface ParsedImport {
  words: ImportEntry[]
  /** Entries that were dropped because they were malformed or out of bounds. */
  skipped: number
}

/**
 * Every source (file, our own exports, the AI) goes through the same gate:
 * trimmed, NFC-normalised, control characters removed, length-limited, and a
 * part of speech we recognise (English or Bulgarian names).
 */
function toEntry(raw: {
  word?: unknown
  definition?: unknown
  partOfSpeech?: unknown
  example?: unknown
}): ImportEntry | null {
  const entry = validateEntry(raw)
  if (!entry) return null
  return { ...entry, example: cleanText(raw.example, LIMITS.example) }
}

function collect(items: Iterable<Parameters<typeof toEntry>[0]>): ParsedImport {
  const words: ImportEntry[] = []
  let skipped = 0
  for (const item of items) {
    const entry = toEntry(item)
    if (entry) words.push(entry)
    else skipped++
  }
  return { words, skipped }
}

/**
 * Parses `word,definition,pos` lines (the legacy `structure-words` reply, and
 * hand-written lists). Definitions may themselves contain commas, so only the
 * first and the last separator are treated as field boundaries.
 */
export function parseStructuredLines(text: string): ParsedImport {
  const items: Parameters<typeof toEntry>[0][] = []
  let malformed = 0

  text.split('\n').forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) return

    const first = line.indexOf(',')
    const last = line.lastIndexOf(',')
    if (first === -1 || first === last) {
      malformed++
      return
    }
    items.push({
      word: line.slice(0, first),
      definition: line.slice(first + 1, last),
      partOfSpeech: line.slice(last + 1),
    })
  })

  const result = collect(items)
  return { words: result.words, skipped: result.skipped + malformed }
}

/**
 * A file that is already a `word,definition,pos` list, one entry per line.
 * Paragraph splitting would glue such a list into one giant "entry", so it is
 * recognised on the raw text first. Returns null unless at least half of the
 * non-empty lines parse — prose with the odd comma is not a list.
 */
export function parseStructuredList(text: string): ParsedImport | null {
  const result = parseStructuredLines(text)
  return result.words.length > 0 && result.words.length >= result.skipped ? result : null
}

/** Entries returned by the `structure-words` endpoint — untrusted like any other. */
export function parseAiEntries(entries: unknown): ParsedImport {
  const list = Array.isArray(entries) ? entries.slice(0, LIMITS.importEntries) : []
  return collect(
    list.map((entry) =>
      entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {},
    ),
  )
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
  const result = collect(
    data.map((entry) =>
      entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {},
    ),
  )
  return result.words.length > 0 || result.skipped > 0 ? result : null
}

/** RFC 4180 fields: quoted cells may hold commas, quotes (`""`) and newlines. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') quoted = false
      else cell += char
      continue
    }
    if (char === '"' && cell === '') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Our export neutralises spreadsheet formulas with a leading `'`; undo it. */
function unescapeFormula(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value
}

/** Round-trips our CSV export (`Word,Definition,Part of Speech,Example,Folder`). */
export function parseCsvExport(text: string): ParsedImport | null {
  const rows = parseCsvRows(text)
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase())
  if (!header || header[0] !== 'word' || header[1] !== 'definition') return null
  const posColumn = header.findIndex((cell) => cell === 'part of speech' || cell === 'pos')
  const exampleColumn = header.indexOf('example')
  if (posColumn === -1) return null

  return collect(
    rows.slice(1).map((cells) => ({
      word: unescapeFormula(cells[0] ?? ''),
      definition: unescapeFormula(cells[1] ?? ''),
      partOfSpeech: cells[posColumn],
      example: exampleColumn === -1 ? null : unescapeFormula(cells[exampleColumn] ?? ''),
    })),
  )
}

/**
 * Round-trips our TXT export: blocks separated by `---`, each holding the word,
 * the definition, `Part of speech: <pos>` and an optional example line.
 */
export function parseTxtExport(text: string): ParsedImport | null {
  if (!/^Part of speech:/im.test(text)) return null
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n-{3,}\n/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .filter((lines) => lines.length > 0)

  const result = collect(
    blocks.map((lines) => {
      const posIndex = lines.findIndex((line) => /^Part of speech:/i.test(line))
      return {
        word: lines[0],
        definition: posIndex > 1 ? lines.slice(1, posIndex).join(' ') : '',
        partOfSpeech: posIndex === -1 ? '' : lines[posIndex].replace(/^Part of speech:\s*/i, ''),
        example: posIndex === -1 ? null : (lines[posIndex + 1] ?? null),
      }
    }),
  )
  return result.words.length > 0 ? result : null
}

/** Parses one of our own export formats, if `text` is one. */
export function parseOwnExport(text: string): ParsedImport | null {
  return parseJsonExport(text) ?? parseCsvExport(text) ?? parseTxtExport(text)
}

export interface ImportPlan {
  /** New entries, in file order, capped at `limit`. */
  toAdd: ImportEntry[]
  /** Already in the dictionary (same word and part of speech). */
  existing: number
  /** Repeated inside the file itself. */
  repeated: number
  /** Valid, new, but beyond `limit`. */
  overLimit: number
}

const dedupeKey = (word: string, partOfSpeech: string) => `${answerKey(word)}|${partOfSpeech}`

/**
 * Removes entries the dictionary already has and repeats within the file, the
 * same rule the database's unique index applies (case-insensitive word + part
 * of speech), so a re-import is a no-op instead of a wall of errors.
 */
export function planImport(entries: ImportEntry[], dictionary: Word[], limit: number): ImportPlan {
  const known = new Set(dictionary.map((w) => dedupeKey(w.word, w.partOfSpeech)))
  const inFile = new Set<string>()
  const fresh: ImportEntry[] = []
  let existing = 0
  let repeated = 0

  for (const entry of entries) {
    const key = dedupeKey(entry.word, entry.partOfSpeech)
    if (known.has(key)) existing++
    else if (inFile.has(key)) repeated++
    else {
      inFile.add(key)
      fresh.push(entry)
    }
  }

  return {
    toAdd: fresh.slice(0, limit),
    existing,
    repeated,
    overLimit: Math.max(0, fresh.length - limit),
  }
}
