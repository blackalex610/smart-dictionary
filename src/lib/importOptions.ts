/**
 * The pre-processing the paper describes ahead of the AI pass: "based on
 * predefined options (paragraph splitting, ignoring short texts), the data is
 * extracted and imported into the dictionary".
 */

export interface ImportOptions {
  /** Treat blank-line separated blocks as one entry each instead of one per line. */
  splitParagraphs: boolean
  /** Drop segments shorter than `minLength`, which is where page noise lives. */
  ignoreShort: boolean
  minLength: number
}

export const MIN_LENGTH_BOUNDS = { min: 1, max: 50 } as const

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  splitParagraphs: true,
  ignoreShort: true,
  minLength: 3,
}

/** Blank-line separated blocks, each flattened onto a single line. */
export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n+/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
        .trim(),
    )
    .filter(Boolean)
}

function splitIntoLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Letters and digits only — bullets and rules should not count towards length. */
function significantLength(segment: string): number {
  return (segment.match(/[\p{L}\p{N}]/gu) ?? []).length
}

export interface PreparedImport {
  /** The cleaned text to hand to the AI or the local parser. */
  text: string
  segments: string[]
  /** Segments removed by the `ignoreShort` filter. */
  dropped: number
}

export function prepareImportText(raw: string, options: ImportOptions): PreparedImport {
  const all = options.splitParagraphs ? splitIntoParagraphs(raw) : splitIntoLines(raw)

  const floor = Math.max(
    MIN_LENGTH_BOUNDS.min,
    Math.min(MIN_LENGTH_BOUNDS.max, Math.round(options.minLength)),
  )
  const segments = options.ignoreShort
    ? all.filter((segment) => significantLength(segment) >= floor)
    : all

  return { text: segments.join('\n'), segments, dropped: all.length - segments.length }
}
