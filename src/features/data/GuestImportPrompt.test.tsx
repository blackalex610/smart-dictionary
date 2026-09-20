import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { I18nProvider } from '@/context/I18nContext'
import { GuestImportPrompt } from './GuestImportPrompt'

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

const KEY = 'dictionary_guest'

beforeEach(() => {
  localStorage.clear()
  // DEFAULT_LANG is 'bg'; these assertions match the English button names.
  localStorage.setItem('appSettings', JSON.stringify({ language: 'en' }))
  localStorage.setItem(KEY, JSON.stringify([{ word: 'cat', definition: 'an animal' }]))
})

function renderPrompt() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <GuestImportPrompt />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('GuestImportPrompt', () => {
  it('renders nothing when there are no legacy words', () => {
    localStorage.removeItem(KEY)
    renderPrompt()
    expect(screen.queryByText('Import your words?')).not.toBeInTheDocument()
  })

  it('imports into the default dictionary and clears the key on confirm', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'd1',
              name: 'General',
              is_default: true,
              word_count: 0,
              due_count: 0,
              language_code: null,
              description: null,
              created_at: '',
              updated_at: '',
            },
          ],
        }),
      ),
      http.post(`${BASE_URL}/api/v1/dictionaries/d1/words:bulk`, () =>
        HttpResponse.json({ results: [] }),
      ),
    )
    const user = userEvent.setup()
    renderPrompt()

    await user.click(await screen.findByRole('button', { name: /import/i }))

    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull())
  })

  it('clears the key without importing when dismissed', async () => {
    const user = userEvent.setup()
    renderPrompt()

    await user.click(await screen.findByRole('button', { name: /not now|dismiss/i }))
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
