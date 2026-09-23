import type { TranslationKey } from '@/i18n'

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

/** The per-minute burst limit, as opposed to the daily quota. */
export class AiRateLimitError extends Error {
  constructor() {
    super('AI_RATE_LIMITED')
    this.name = 'AiRateLimitError'
  }
}

/**
 * The AI could not answer: offline, timeout, provider outage, or output that
 * failed validation. `code` is the server's error code, never a raw message.
 */
export class AiUnavailableError extends Error {
  constructor(public readonly code: string = 'AI_UNAVAILABLE') {
    super(code)
    this.name = 'AiUnavailableError'
  }
}

/** Browser storage refused the write (quota, private mode) — nothing was saved. */
export class StorageWriteError extends Error {
  constructor() {
    super('STORAGE_WRITE_FAILED')
    this.name = 'StorageWriteError'
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
  // Matched on the message, not just P0001 — that code is shared by every
  // `raise exception` in the database.
  return typeof e.message === 'string' && e.message.includes('FREE_WORD_LIMIT_REACHED')
}

/** Postgres 23505: the (user, lower(word), part_of_speech) unique index. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as MaybePostgrestError | null)?.code === '23505'
}

/** PostgREST reports an unknown column as 42703 (PG) or PGRST204 (schema cache). */
export function isUnknownColumn(err: unknown, column: string): boolean {
  const e = err as MaybePostgrestError | null
  if (!e) return false
  const text = `${e.message ?? ''} ${e.details ?? ''}`
  return (e.code === '42703' || e.code === 'PGRST204') && text.includes(column)
}

/**
 * The translation key for what to tell the user about `err`. Raw error
 * messages (Postgres details, network internals) are never shown.
 */
export function errorMessageKey(err: unknown): TranslationKey {
  if (err instanceof FreeWordLimitError) return 'err-free-limit'
  if (err instanceof DuplicateWordError) return 'err-duplicate'
  if (err instanceof StorageWriteError) return 'err-storage-full'
  if (err instanceof AiDailyLimitError) return 'ai-limit-reached'
  if (err instanceof AiRateLimitError) return 'ai-rate-limited'
  if (err instanceof AiUnavailableError) {
    return err.code === 'OFFLINE' ? 'err-offline' : 'ai-unavailable'
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'err-offline'
  return 'err-generic'
}
