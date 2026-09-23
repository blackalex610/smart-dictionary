import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiDailyLimitError, AiRateLimitError, AiUnavailableError } from '@/lib/errors'

const invoke = vi.fn()
vi.mock('./client', () => ({ supabase: { functions: { invoke } } }))

const { invokeAi } = await import('./ai')

/** Shape of a FunctionsHttpError from supabase-js. */
function httpError(status: number, body: unknown) {
  return {
    data: null,
    error: {
      message: 'Edge Function returned a non-2xx status code',
      context: { status, clone: () => new Response(JSON.stringify(body), { status }) },
    },
  }
}

afterEach(() => {
  invoke.mockReset()
  vi.unstubAllGlobals()
})

describe('invokeAi', () => {
  it('returns data and sends a timeout', async () => {
    invoke.mockResolvedValue({ data: { response: 'hi' }, error: null })
    await expect(invokeAi('chat', { message: 'x' })).resolves.toEqual({ response: 'hi' })
    expect(invoke).toHaveBeenCalledWith(
      'ai-chat',
      expect.objectContaining({ timeout: expect.any(Number) }),
    )
  })

  it('maps the daily quota to AiDailyLimitError', async () => {
    invoke.mockResolvedValue(
      httpError(429, { error: 'AI_DAILY_LIMIT_REACHED', usage: { used: 10 } }),
    )
    await expect(invokeAi('chat', {})).rejects.toBeInstanceOf(AiDailyLimitError)
  })

  it('maps the burst limit to AiRateLimitError', async () => {
    invoke.mockResolvedValue(httpError(429, { error: 'AI_RATE_LIMITED' }))
    await expect(invokeAi('chat', {})).rejects.toBeInstanceOf(AiRateLimitError)
  })

  it('maps provider failures to AiUnavailableError with the server code only', async () => {
    invoke.mockResolvedValue(httpError(502, { error: 'AI_BAD_OUTPUT', message: 'internal detail' }))
    const error = await invokeAi('chat', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiUnavailableError)
    expect((error as AiUnavailableError).code).toBe('AI_BAD_OUTPUT')
  })

  it('maps a thrown network error to AiUnavailableError', async () => {
    invoke.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(invokeAi('chat', {})).rejects.toBeInstanceOf(AiUnavailableError)
  })

  it('does not call the network while offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const error = await invokeAi('chat', {}).catch((e: unknown) => e)
    expect((error as AiUnavailableError).code).toBe('OFFLINE')
    expect(invoke).not.toHaveBeenCalled()
  })
})
