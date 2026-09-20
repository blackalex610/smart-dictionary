import type { TranslationKey } from '@/i18n'
import type { AppError } from './client'

const CODE_TO_KEY: Partial<Record<string, TranslationKey>> = {
  UNAUTHENTICATED: 'err-unauthenticated',
  NOT_FOUND: 'err-not-found',
  VALIDATION_FAILED: 'err-validation-failed',
  DUPLICATE_WORD: 'err-duplicate-word',
  WORD_LIMIT_REACHED: 'err-word-limit-reached',
  RATE_LIMITED: 'err-rate-limited',
  TIMEOUT: 'err-timeout',
  NETWORK_ERROR: 'err-network',
}

export function errorMessageKey(error: AppError): TranslationKey {
  return CODE_TO_KEY[error.code] ?? 'err-generic'
}
