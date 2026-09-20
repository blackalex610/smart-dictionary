import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createDictionary,
  deleteDictionary,
  listDictionaries,
  updateDictionary,
} from './dictionaries'

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

describe('dictionaries api', () => {
  it('listDictionaries returns items', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () =>
        HttpResponse.json({ items: [{ id: '1', name: 'A' }] }),
      ),
    )
    const result = await listDictionaries()
    expect(result.items).toHaveLength(1)
  })

  it('createDictionary posts the name', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE_URL}/api/v1/dictionaries`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: '1', name: 'New' }, { status: 201 })
      }),
    )
    await createDictionary({ name: 'New' })
    expect(body).toEqual({ name: 'New' })
  })

  it('updateDictionary PATCHes only the given fields', async () => {
    let method = ''
    server.use(
      http.patch(`${BASE_URL}/api/v1/dictionaries/1`, ({ request }) => {
        method = request.method
        return HttpResponse.json({ id: '1', name: 'Renamed' })
      }),
    )
    await updateDictionary('1', { name: 'Renamed' })
    expect(method).toBe('PATCH')
  })

  it('deleteDictionary DELETEs the resource', async () => {
    server.use(
      http.delete(
        `${BASE_URL}/api/v1/dictionaries/1`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    )
    await expect(deleteDictionary('1')).resolves.toBeUndefined()
  })
})
