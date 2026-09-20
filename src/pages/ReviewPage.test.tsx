import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/context/I18nContext'
import { ReviewPage } from './ReviewPage'

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
// DEFAULT_LANG is 'bg'; these assertions read the English strings, so pin the
// language the same way the app does (appSettings.language in localStorage).
beforeEach(() => localStorage.setItem('appSettings', JSON.stringify({ language: 'en' })))
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
})
afterAll(() => server.close())

function queueItem(wordId: string, word: string, definition: string) {
  return {
    word_id: wordId,
    word,
    definition,
    part_of_speech: 'noun',
    example: null,
    state: 'new',
    due_at: null,
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <MemoryRouter initialEntries={['/app/review']}>
          <ReviewPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('ReviewPage', () => {
  it('shows the current word and interval previews on each rating button', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/queue`, () =>
        HttpResponse.json({ items: [queueItem('w1', 'cat', 'an animal')] }),
      ),
    )
    renderPage()

    expect(await screen.findByText('cat')).toBeInTheDocument()
    expect(screen.getByText('Again')).toBeInTheDocument()
    expect(screen.getByText('Good')).toBeInTheDocument()
    // previewNextState for a new card: again -> 1m, easy -> 4d, and both hard
    // and good advance one learning step -> 10m each.
    expect(screen.getByText('1m')).toBeInTheDocument()
    expect(screen.getAllByText('10m')).toHaveLength(2)
    expect(screen.getByText('4d')).toBeInTheDocument()
  })

  it('submits a rating when a rating button is clicked and advances the queue', async () => {
    let submittedBody: unknown
    const rated = new Set<string>()
    server.use(
      http.get(`${BASE_URL}/api/v1/reviews/queue`, () =>
        HttpResponse.json({
          items: [queueItem('w1', 'cat', 'an animal'), queueItem('w2', 'dog', 'a pet')].filter(
            (item) => !rated.has(item.word_id),
          ),
        }),
      ),
      http.post(`${BASE_URL}/api/v1/reviews`, async ({ request }) => {
        submittedBody = await request.json()
        rated.add((submittedBody as { word_id: string }).word_id)
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
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('cat')
    await user.click(screen.getByText('Good'))

    await waitFor(() => expect(submittedBody).toMatchObject({ word_id: 'w1', rating: 3 }))
    await waitFor(() => expect(screen.getByText('dog')).toBeInTheDocument())
  })

  it('shows the empty state once the queue is exhausted', async () => {
    server.use(http.get(`${BASE_URL}/api/v1/reviews/queue`, () => HttpResponse.json({ items: [] })))
    renderPage()

    expect(await screen.findByText("You're all caught up!")).toBeInTheDocument()
  })
})
