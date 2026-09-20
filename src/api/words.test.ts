import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { bulkCreateWords, createWord, deleteWord, listWords, moveWord } from './words'

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

describe('words api', () => {
  it('listWords builds the query string from the given params', async () => {
    let url = ''
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries/d1/words`, ({ request }) => {
        url = request.url
        return HttpResponse.json({ items: [], next_cursor: null, has_more: false })
      }),
    )
    await listWords('d1', { limit: 10, q: 'cat', sort: 'alpha' })
    const parsed = new URL(url)
    expect(parsed.searchParams.get('limit')).toBe('10')
    expect(parsed.searchParams.get('q')).toBe('cat')
    expect(parsed.searchParams.get('sort')).toBe('alpha')
  })

  it('createWord posts to the dictionary-scoped endpoint', async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/dictionaries/d1/words`, () =>
        HttpResponse.json({ id: 'w1', word: 'cat' }, { status: 201 }),
      ),
    )
    const word = await createWord('d1', { word: 'cat', definition: 'an animal' })
    expect(word.id).toBe('w1')
  })

  it('bulkCreateWords posts the rows array', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE_URL}/api/v1/dictionaries/d1/words:bulk`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ results: [] })
      }),
    )
    await bulkCreateWords('d1', [{ word: 'a', definition: 'b' }])
    expect(body).toEqual({ rows: [{ word: 'a', definition: 'b' }] })
  })

  it('deleteWord DELETEs by id', async () => {
    server.use(
      http.delete(`${BASE_URL}/api/v1/words/w1`, () => new HttpResponse(null, { status: 204 })),
    )
    await expect(deleteWord('w1')).resolves.toBeUndefined()
  })

  it('moveWord posts the target dictionary_id', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE_URL}/api/v1/words/w1:move`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 'w1', dictionary_id: 'd2' })
      }),
    )
    await moveWord('w1', 'd2')
    expect(body).toEqual({ dictionary_id: 'd2' })
  })
})
