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

export function isFreeWordLimit(err: unknown): boolean {
  const e = err as MaybePostgrestError | null
  if (!e) return false
  return (
    e.code === 'P0001' ||
    (typeof e.message === 'string' && e.message.includes('FREE_WORD_LIMIT_REACHED'))
  )
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
