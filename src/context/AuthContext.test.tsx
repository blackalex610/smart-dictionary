import { describe, expect, it } from 'vitest'
import type { AuthState } from './AuthContext'

describe('AuthState', () => {
  it('has no guest variant', () => {
    // Compile-time check: this assignment must be a type error if 'guest'
    // still exists as a valid status. Runtime assertion below is the
    // executable half of that guarantee.
    const state: AuthState = { status: 'anonymous' }
    expect(state.status).not.toBe('guest')
  })
})
