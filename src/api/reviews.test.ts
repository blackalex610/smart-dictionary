import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getReviewForecast, getReviewQueue, submitReview } from './reviews'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('reviews api', () => {
  it('getReviewQueue includes dictionary_id when given', async () => {
    let url = ''
    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/queue`, ({ request }) => {
        url = request.url
        return HttpResponse.json({ items: [] })
      }),
    )
    await getReviewQueue({ dictionaryId: 'd1' })
    expect(new URL(url).searchParams.get('dictionary_id')).toBe('d1')
  })

  it('submitReview sends rating and source=flashcard', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE_URL}/api/v1/reviews`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(
          {
            word_id: 'w1',
            state: 'learning',
            ease_factor: '2.50',
            interval_days: 0,
            due_at: '2026-09-16T00:00:00Z',
          },
          { status: 201 },
        )
      }),
    )
    await submitReview({ wordId: 'w1', rating: 3, elapsedMs: 1200 })
    expect(body).toEqual({ word_id: 'w1', rating: 3, elapsed_ms: 1200, source: 'flashcard' })
  })

  it('getReviewForecast requests the given number of days', async () => {
    let url = ''
    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/forecast`, ({ request }) => {
        url = request.url
        return HttpResponse.json({ days: [] })
      }),
    )
    await getReviewForecast(7)
    expect(new URL(url).searchParams.get('days')).toBe('7')
  })
})
