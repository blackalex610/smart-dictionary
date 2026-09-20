import { describe, expect, it } from 'vitest'
import { AppError } from './client'
import { errorMessageKey } from './errors'

describe('errorMessageKey', () => {
  it('maps known codes to their translation key', () => {
    expect(errorMessageKey(new AppError('NOT_FOUND', 404, 'x'))).toBe('err-not-found')
    expect(errorMessageKey(new AppError('DUPLICATE_WORD', 409, 'x'))).toBe('err-duplicate-word')
    expect(errorMessageKey(new AppError('WORD_LIMIT_REACHED', 409, 'x'))).toBe(
      'err-word-limit-reached',
    )
  })

  it('falls back to a generic key for an unknown code', () => {
    expect(errorMessageKey(new AppError('SOMETHING_NEW', 500, 'x'))).toBe('err-generic')
  })
})
