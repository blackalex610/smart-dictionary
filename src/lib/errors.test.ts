import { describe, expect, it } from 'vitest'
import { isFreeWordLimit, isUnknownColumn } from './errors'

describe('isFreeWordLimit', () => {
  it('recognises the trigger that enforces the free-tier word cap', () => {
    expect(
      isFreeWordLimit({
        code: 'P0001',
        message: 'FREE_WORD_LIMIT_REACHED: Free users can store up to 300 words.',
      }),
    ).toBe(true)
  })

  it('ignores other P0001 errors', () => {
    // P0001 is Postgres' generic raise_exception. `protect_profile_tier_update`
    // raises it with no errcode of its own, so matching the bare code told the
    // user their dictionary was full when it was not.
    expect(
      isFreeWordLimit({ code: 'P0001', message: 'tier can only be updated by service role' }),
    ).toBe(false)
  })

  it('handles missing and malformed errors', () => {
    expect(isFreeWordLimit(null)).toBe(false)
    expect(isFreeWordLimit(undefined)).toBe(false)
    expect(isFreeWordLimit({})).toBe(false)
  })

  it('also matches when the marker only appears in details', () => {
    expect(isFreeWordLimit({ details: 'FREE_WORD_LIMIT_REACHED' })).toBe(true)
  })
})

describe('isUnknownColumn', () => {
  it('matches both the Postgres and the schema-cache code', () => {
    expect(
      isUnknownColumn({ code: '42703', message: 'column "example" does not exist' }, 'example'),
    ).toBe(true)
    expect(
      isUnknownColumn({ code: 'PGRST204', message: "'example' column not found" }, 'example'),
    ).toBe(true)
  })

  it('does not match a different column or a different code', () => {
    expect(
      isUnknownColumn({ code: '42703', message: 'column "folder" does not exist' }, 'example'),
    ).toBe(false)
    expect(isUnknownColumn({ code: '23505', message: 'example' }, 'example')).toBe(false)
  })
})
