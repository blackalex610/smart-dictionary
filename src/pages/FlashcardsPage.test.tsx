import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/context/I18nContext'
import { FlashcardsPage } from './FlashcardsPage'

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
// DEFAULT_LANG is 'bg'; these assertions read the English strings.
beforeEach(() => localStorage.setItem('appSettings', JSON.stringify({ language: 'en' })))
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
})
afterAll(() => server.close())

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <MemoryRouter initialEntries={['/app/flashcards']}>
          <Routes>
            <Route path="/app/flashcards" element={<FlashcardsPage />} />
            <Route path="/app/review" element={<div>REVIEW PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const DICTIONARIES = [
  {
    id: 'd1',
    name: 'IELTS',
    word_count: 10,
    due_count: 3,
    is_default: true,
    language_code: null,
    description: null,
    created_at: '',
    updated_at: '',
  },
]

describe('FlashcardsPage', () => {
  it('lists dictionaries with their due counts', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
    )
    renderPage()

    expect(await screen.findByText('IELTS')).toBeInTheDocument()
    expect(screen.getByText('3 due')).toBeInTheDocument()
  })

  it('navigates to /app/review with the dictionary_id when a dictionary card is clicked', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByText('IELTS'))
    expect(await screen.findByText('REVIEW PAGE')).toBeInTheDocument()
  })

  it('navigates to /app/review with no dictionary_id when "All words" is clicked', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByText('All words'))
    expect(await screen.findByText('REVIEW PAGE')).toBeInTheDocument()
  })
})
