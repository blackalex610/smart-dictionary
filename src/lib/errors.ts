export class FreeWordLimitError extends Error {
  constructor() {
    super('FREE_WORD_LIMIT_REACHED')
    this.name = 'FreeWordLimitError'
  }
}

export class AiDailyLimitError extends Error {
  usage: unknown
  constructor(usage?: unknown) {
    super('AI_DAILY_LIMIT_REACHED')
    this.name = 'AiDailyLimitError'
    this.usage = usage
  }
}

export class DuplicateWordError extends Error {
  constructor(public word: string) {
    super('DUPLICATE_WORD')
    this.name = 'DuplicateWordError'
  }
}

interface MaybePostgrestError {
  code?: string
  message?: string
  details?: string
}

/**
 * P0001 is Postgres' generic `raise_exception`, so the code alone identifies
 * nothing: the `protect_profile_tier_update` trigger raises it too, and any
 * future `raise exception` without an explicit errcode will as well. The
 * `enforce_words_limit` trigger prefixes its message with this marker
 * precisely so the client can tell them apart, so match on the marker.
 */
export function isFreeWordLimit(err: unknown): boolean {
  const e = err as MaybePostgrestError | null
  if (!e) return false
  const text = `${e.message ?? ''} ${e.details ?? ''}`
  return text.includes('FREE_WORD_LIMIT_REACHED')
}

/** PostgREST reports an unknown column as 42703 (PG) or PGRST204 (schema cache). */
export function isUnknownColumn(err: unknown, column: string): boolean {
  const e = err as MaybePostgrestError | null
  if (!e) return false
  const text = `${e.message ?? ''} ${e.details ?? ''}`
  return (e.code === '42703' || e.code === 'PGRST204') && text.includes(column)
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'Unknown error'
}
