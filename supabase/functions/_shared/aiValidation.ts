/**
 * Validation for everything a model returns. Model output is untrusted input:
 * it can be malformed JSON, have the wrong shape, repeat options, leak the
 * answer into the question, or carry text the size of a novel.
 *
 * Pure TypeScript with no imports so it runs unchanged in the Deno Edge
 * Function (the enforcing copy) and in the browser bundle / Vitest (defence in
 * depth and tests). Every validator returns `null` for output it rejects.
 */

export const LIMITS = {
  word: 100,
  definition: 500,
  example: 250,
  option: 300,
  prompt: 600,
  passage: 4000,
  chatReply: 4000,
  importEntries: 300,
} as const

export const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb'] as const
export type PartOfSpeechValue = (typeof PARTS_OF_SPEECH)[number]

/** English, Bulgarian and common abbreviations the import can meet. */
const POS_ALIASES: Record<string, PartOfSpeechValue> = {
  noun: 'noun',
  n: 'noun',
  'n.': 'noun',
  съществително: 'noun',
  'съществително име': 'noun',
  същ: 'noun',
  'същ.': 'noun',
  verb: 'verb',
  v: 'verb',
  'v.': 'verb',
  глагол: 'verb',
  гл: 'verb',
  'гл.': 'verb',
  adjective: 'adjective',
  adj: 'adjective',
  'adj.': 'adjective',
  прилагателно: 'adjective',
  'прилагателно име': 'adjective',
  прил: 'adjective',
  'прил.': 'adjective',
  adverb: 'adverb',
  adv: 'adverb',
  'adv.': 'adverb',
  наречие: 'adverb',
  нар: 'adverb',
  'нар.': 'adverb',
}

export function normalisePartOfSpeech(value: unknown): PartOfSpeechValue | null {
  if (typeof value !== 'string') return null
  const key = value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')
  return POS_ALIASES[key] ?? null
}

// C0/C1 control characters except tab and newline, plus zero-width and bidi
// override characters that can disguise text.
const UNSAFE_CHARS =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g

/**
 * NFC-normalises, drops control/bidi characters, collapses whitespace and
 * trims. Returns null for non-strings, empty results and anything over `max`.
 */
export function cleanText(
  value: unknown,
  max: number,
  opts: { multiline?: boolean } = {},
): string | null {
  if (typeof value !== 'string') return null
  let text = value.normalize('NFC').replace(UNSAFE_CHARS, '')
  text = opts.multiline
    ? text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : text.replace(/\s+/g, ' ').trim()
  if (!text || text.length > max) return null
  return text
}

/** Comparison key: case-, whitespace- and trailing-punctuation-insensitive. */
export function answerKey(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:!?…"'«»„“”‘’()-]+$/u, '')
    .replace(/^[\s"'«»„“”‘’(-]+/u, '')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when `needle` appears in `haystack` as a whole word (Unicode-aware). */
export function containsWord(haystack: string, needle: string): boolean {
  const key = answerKey(needle)
  if (!key) return false
  // No lookbehind: it is a SyntaxError on Safari before 16.4.
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(key)}(?![\\p{L}\\p{N}])`, 'u')
  return pattern.test(haystack.normalize('NFC').toLocaleLowerCase())
}

/**
 * Parses a JSON object out of a model reply, tolerating the ```json fences some
 * models add even in JSON mode. Returns null when there is no object.
 */
export function parseJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string') return null
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    const value: unknown = JSON.parse(unfenced)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/* ─────────────────────────────────────────────── multiple choice ──── */

export interface ChoiceSet {
  correctAnswer: string
  wrongAnswers: string[]
}

/** Exactly one correct answer plus three distinct, non-empty distractors. */
export function validateWrongAnswers(raw: unknown): ChoiceSet | null {
  const data = asRecord(raw)
  if (!data) return null
  const correctAnswer = cleanText(data.correctAnswer, LIMITS.option)
  if (!correctAnswer || !Array.isArray(data.wrongAnswers)) return null

  const seen = new Set([answerKey(correctAnswer)])
  const wrongAnswers: string[] = []
  for (const candidate of data.wrongAnswers) {
    const text = cleanText(candidate, LIMITS.option)
    if (!text) continue
    const key = answerKey(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    wrongAnswers.push(text)
    if (wrongAnswers.length === 3) break
  }
  return wrongAnswers.length === 3 ? { correctAnswer, wrongAnswers } : null
}

/* ───────────────────────────────────────────────────── open / gap ──── */

export interface OpenClause {
  question: string
  answer: string
}

/** The question must not give the answer away. */
export function validateOpenClause(raw: unknown): OpenClause | null {
  const data = asRecord(raw)
  if (!data) return null
  const question = cleanText(data.question, LIMITS.prompt)
  const answer = cleanText(data.answer, LIMITS.word)
  if (!question || !answer) return null
  if (containsWord(question, answer)) return null
  return { question, answer }
}

export interface GapFill {
  sentence: string
  answer: string
}

/** One blank (normalised to `____`), and the answer is not already visible. */
export function validateGapFill(raw: unknown): GapFill | null {
  const data = asRecord(raw)
  if (!data) return null
  const rawSentence = cleanText(data.sentence, LIMITS.prompt)
  const answer = cleanText(data.answer, LIMITS.word)
  if (!rawSentence || !answer) return null
  const blanks = rawSentence.match(/_{2,}/g) ?? []
  if (blanks.length !== 1) return null
  const sentence = rawSentence.replace(/_{2,}/, '____')
  if (containsWord(sentence, answer)) return null
  return { sentence, answer }
}

/* ────────────────────────────────────────────────────────── reading ──── */

export interface ReadingQuestion {
  question: string
  options: string[]
  answerIndex: number
}

export interface Reading {
  passage: string
  questions: ReadingQuestion[]
}

/**
 * Drops individual malformed questions (missing key, duplicate options) rather
 * than failing the whole set; rejects the set only when nothing usable is left.
 */
export function validateReading(raw: unknown, maxQuestions = 20): Reading | null {
  const data = asRecord(raw)
  if (!data) return null
  const passage = cleanText(data.passage, LIMITS.passage, { multiline: true })
  if (!passage || !Array.isArray(data.questions)) return null

  const questions: ReadingQuestion[] = []
  for (const entry of data.questions) {
    const item = asRecord(entry)
    if (!item) continue
    const question = cleanText(item.question, LIMITS.prompt)
    if (!question || !Array.isArray(item.options)) continue

    const options = item.options.map((option) => cleanText(option, LIMITS.option))
    if (options.length < 2 || options.length > 4 || options.some((o) => o === null)) continue
    const keys = new Set((options as string[]).map(answerKey))
    if (keys.size !== options.length) continue

    const answerIndex = item.answerIndex
    if (
      typeof answerIndex !== 'number' ||
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex >= options.length
    ) {
      continue
    }
    questions.push({ question, options: options as string[], answerIndex })
    if (questions.length === maxQuestions) break
  }
  return questions.length > 0 ? { passage, questions } : null
}

/* ─────────────────────────────────────────────────────────── import ──── */

export interface StructuredEntry {
  word: string
  definition: string
  partOfSpeech: PartOfSpeechValue
}

/** Validates one dictionary entry from any source (AI, file, chat action). */
export function validateEntry(raw: unknown): StructuredEntry | null {
  const data = asRecord(raw)
  if (!data) return null
  const word = cleanText(data.word, LIMITS.word)
  const definition = cleanText(data.definition, LIMITS.definition)
  const partOfSpeech = normalisePartOfSpeech(data.partOfSpeech ?? data.pos ?? data.part_of_speech)
  if (!word || !definition || !partOfSpeech) return null
  return { word, definition, partOfSpeech }
}

export function validateStructuredEntries(raw: unknown): {
  entries: StructuredEntry[]
  skipped: number
} {
  const data = asRecord(raw)
  const list = Array.isArray(data?.entries) ? (data.entries as unknown[]) : []
  const entries: StructuredEntry[] = []
  let skipped = 0
  for (const item of list.slice(0, LIMITS.importEntries)) {
    const entry = validateEntry(item)
    if (entry) entries.push(entry)
    else skipped++
  }
  skipped += Math.max(0, list.length - LIMITS.importEntries)
  return { entries, skipped }
}
