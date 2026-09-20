import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppError, apiFetch } from './client'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('apiFetch', () => {
  it('attaches the bearer token and returns the parsed body', async () => {
    let seenAuth: string | null = null
    server.use(
      http.get(`${BASE_URL}/api/v1/me`, ({ request }) => {
        seenAuth = request.headers.get('authorization')
        return HttpResponse.json({ user_id: '1', email: 'a@b.com' })
      }),
    )

    const result = await apiFetch<{ user_id: string }>('/api/v1/me')

    expect(seenAuth).toBe('Bearer test-token')
    expect(result.user_id).toBe('1')
  })

  it('attaches a unique X-Request-ID header per call', async () => {
    const seen: string[] = []
    server.use(
      http.get(`${BASE_URL}/api/v1/me`, ({ request }) => {
        seen.push(request.headers.get('x-request-id') ?? '')
        return HttpResponse.json({})
      }),
    )

    await apiFetch('/api/v1/me')
    await apiFetch('/api/v1/me')

    expect(seen[0]).not.toBe('')
    expect(seen[0]).not.toBe(seen[1])
  })

  it('throws AppError with the problem+json fields on a non-2xx response', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/words/123`, () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', status: 404, detail: 'Word not found' },
          { status: 404 },
        ),
      ),
    )

    await expect(apiFetch('/api/v1/words/123')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      detail: 'Word not found',
    })
  })

  it('returns undefined for a 204 response', async () => {
    server.use(
      http.delete(`${BASE_URL}/api/v1/words/1`, () => new HttpResponse(null, { status: 204 })),
    )
    await expect(apiFetch('/api/v1/words/1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('wraps a network failure in an AppError', async () => {
    server.use(http.get(`${BASE_URL}/api/v1/me`, () => HttpResponse.error()))
    await expect(apiFetch('/api/v1/me')).rejects.toBeInstanceOf(AppError)
  })
})
