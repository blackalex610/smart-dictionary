import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type React from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useReviewQueue, useSubmitReview } from './useReviewQueue'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ state: { status: 'authenticated' }, scope: 'user-1' }),
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useReviewQueue', () => {
  it('loads the queue for the current user', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/queue`, () =>
        HttpResponse.json({
          items: [
            {
              word_id: 'w1',
              word: 'cat',
              definition: 'an animal',
              part_of_speech: 'noun',
              example: null,
              state: 'new',
              due_at: null,
            },
          ],
        }),
      ),
    )

    const { result } = renderHook(() => useReviewQueue(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.[0].word).toBe('cat')
  })
})

describe('useSubmitReview', () => {
  it('removes the rated word from the cached queue on success', async () => {
    // The queue endpoint is stateful here, the way the real one is: once a
    // word has been rated it is no longer due, so it drops out of the queue.
    // A static handler would have the onSettled refetch resurrect the word
    // that onSuccess optimistically removed.
    const rated = new Set<string>()
    const queueItem = (wordId: string, word: string) => ({
      word_id: wordId,
      word,
      definition: 'x',
      part_of_speech: null,
      example: null,
      state: 'new',
      due_at: null,
    })

    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/queue`, () =>
        HttpResponse.json({
          items: [queueItem('w1', 'cat'), queueItem('w2', 'dog')].filter(
            (item) => !rated.has(item.word_id),
          ),
        }),
      ),
      http.post(`${BASE_URL}/api/v1/reviews`, async ({ request }) => {
        const body = (await request.json()) as { word_id: string }
        rated.add(body.word_id)
        return HttpResponse.json(
          {
            word_id: body.word_id,
            state: 'learning',
            ease_factor: '2.50',
            interval_days: 0,
            due_at: '2026-09-16T00:00:00Z',
          },
          { status: 201 },
        )
      }),
    )

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function localWrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }

    const { result: queueResult } = renderHook(() => useReviewQueue(), { wrapper: localWrapper })
    await waitFor(() => expect(queueResult.current.isSuccess).toBe(true))

    const { result: submitResult } = renderHook(() => useSubmitReview(), { wrapper: localWrapper })
    await submitResult.current.mutateAsync({ wordId: 'w1', rating: 3 })

    expect(rated.has('w1')).toBe(true)

    await waitFor(() => {
      const cached = queryClient.getQueryData<{ word_id: string }[]>([
        'review-queue',
        'user-1',
        'all',
      ])
      expect(cached?.map((i) => i.word_id)).toEqual(['w2'])
    })
  })
})
