import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { httpWords, resetDictionariesCache } from './words'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  },
}))

const BASE_URL = 'http://localhost:8000'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => resetDictionariesCache())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const DICTIONARIES = [
  {
    id: 'd1',
    name: 'General',
    word_count: 1,
    due_count: 0,
    is_default: true,
    language_code: null,
    description: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

function wordDto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'w1',
    dictionary_id: 'd1',
    word: 'cat',
    definition: 'an animal',
    part_of_speech: 'noun',
    example: null,
    translation: null,
    notes: null,
    difficulty: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('httpWords.list', () => {
  it('aggregates words across all dictionaries, mapping dictionary name to folder', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
      http.get(`${BASE_URL}/api/v1/dictionaries/d1/words`, () =>
        HttpResponse.json({ items: [wordDto()], next_cursor: null, has_more: false }),
      ),
    )

    const words = await httpWords.list()
    expect(words).toHaveLength(1)
    expect(words[0].folder).toBe('General')
  })

  it('follows pagination cursors until has_more is false', async () => {
    let calls = 0
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
      http.get(`${BASE_URL}/api/v1/dictionaries/d1/words`, () => {
        calls += 1
        if (calls === 1) {
          return HttpResponse.json({
            items: [wordDto({ id: 'w1' })],
            next_cursor: 'abc',
            has_more: true,
          })
        }
        return HttpResponse.json({
          items: [wordDto({ id: 'w2' })],
          next_cursor: null,
          has_more: false,
        })
      }),
    )

    const words = await httpWords.list()
    expect(words.map((w) => w.id).sort()).toEqual(['w1', 'w2'])
  })
})

describe('httpWords.create', () => {
  it('creates a new dictionary when the folder does not exist yet', async () => {
    let createdDictionaryBody: unknown
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: [] })),
      http.post(`${BASE_URL}/api/v1/dictionaries`, async ({ request }) => {
        createdDictionaryBody = await request.json()
        return HttpResponse.json(
          {
            id: 'd2',
            name: 'New Folder',
            word_count: 0,
            due_count: 0,
            is_default: false,
            language_code: null,
            description: null,
            created_at: '',
            updated_at: '',
          },
          { status: 201 },
        )
      }),
      http.post(`${BASE_URL}/api/v1/dictionaries/d2/words`, () =>
        HttpResponse.json(wordDto({ dictionary_id: 'd2' }), { status: 201 }),
      ),
    )

    const word = await httpWords.create({
      word: 'cat',
      definition: 'an animal',
      partOfSpeech: 'noun',
      folder: 'New Folder',
    })

    expect(createdDictionaryBody).toEqual({ name: 'New Folder' })
    expect(word.folder).toBe('New Folder')
  })

  it('reuses an existing dictionary with a case-insensitive name match', async () => {
    let dictionaryPostCalled = false
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
      http.post(`${BASE_URL}/api/v1/dictionaries`, () => {
        dictionaryPostCalled = true
        return HttpResponse.json({}, { status: 201 })
      }),
      http.post(`${BASE_URL}/api/v1/dictionaries/d1/words`, () =>
        HttpResponse.json(wordDto(), { status: 201 }),
      ),
    )

    await httpWords.create({
      word: 'cat',
      definition: 'an animal',
      partOfSpeech: 'noun',
      folder: 'general',
    })
    expect(dictionaryPostCalled).toBe(false)
  })
})

describe('httpWords.update', () => {
  it('moves the word when the folder changes', async () => {
    let moveBody: unknown
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () =>
        HttpResponse.json({
          items: [
            ...DICTIONARIES,
            {
              id: 'd2',
              name: 'Other',
              word_count: 0,
              due_count: 0,
              is_default: false,
              language_code: null,
              description: null,
              created_at: '',
              updated_at: '',
            },
          ],
        }),
      ),
      http.post(`${BASE_URL}/api/v1/words/w1:move`, async ({ request }) => {
        moveBody = await request.json()
        return HttpResponse.json(wordDto({ dictionary_id: 'd2' }))
      }),
    )

    const word = await httpWords.update('w1', { folder: 'Other' })

    expect(moveBody).toEqual({ dictionary_id: 'd2' })
    expect(word.folder).toBe('Other')
  })

  it('patches fields without moving when folder is unchanged', async () => {
    let patched = false
    server.use(
      http.patch(`${BASE_URL}/api/v1/words/w1`, () => {
        patched = true
        return HttpResponse.json(wordDto({ definition: 'updated' }))
      }),
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
    )

    const word = await httpWords.update('w1', { definition: 'updated' })
    expect(patched).toBe(true)
    expect(word.definition).toBe('updated')
  })
})

describe('httpWords.remove', () => {
  it('DELETEs the word', async () => {
    server.use(
      http.delete(`${BASE_URL}/api/v1/words/w1`, () => new HttpResponse(null, { status: 204 })),
    )
    await expect(httpWords.remove('w1')).resolves.toBeUndefined()
  })
})

describe('httpWords.replaceAll', () => {
  it('deletes every existing word when called with an empty array', async () => {
    const deleted: string[] = []
    server.use(
      http.get(`${BASE_URL}/api/v1/dictionaries`, () => HttpResponse.json({ items: DICTIONARIES })),
      http.get(`${BASE_URL}/api/v1/dictionaries/d1/words`, () =>
        HttpResponse.json({
          items: [wordDto({ id: 'w1' }), wordDto({ id: 'w2' })],
          next_cursor: null,
          has_more: false,
        }),
      ),
      http.delete(`${BASE_URL}/api/v1/words/:id`, ({ params }) => {
        deleted.push(params.id as string)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await httpWords.replaceAll([])
    expect(deleted.sort()).toEqual(['w1', 'w2'])
  })
})
