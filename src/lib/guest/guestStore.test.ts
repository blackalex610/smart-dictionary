import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageWriteError } from '@/lib/errors'
import { GUEST_WORDS_KEY, guestWords, readGuestWords } from './guestStore'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const input = {
  word: 'hello',
  definition: 'a greeting',
  partOfSpeech: 'noun' as const,
  folder: 'General',
}

describe('guestWords', () => {
  it('persists across reads', async () => {
    await guestWords.create(input)
    expect((await guestWords.list()).map((w) => w.word)).toEqual(['hello'])
  })

  it('throws instead of reporting success when storage is full', async () => {
    // The test setup may install a plain-object polyfill, so spy on the instance.
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    await expect(guestWords.create(input)).rejects.toBeInstanceOf(StorageWriteError)
  })

  it('backs up corrupted data before it can be overwritten', async () => {
    localStorage.setItem(GUEST_WORDS_KEY, '{not json')
    expect(readGuestWords()).toEqual([])
    await guestWords.create(input)
    expect(localStorage.getItem(`${GUEST_WORDS_KEY}_corrupt_backup`)).toBe('{not json')
  })

  it('drops legacy entries without a word and fills missing fields', () => {
    localStorage.setItem(
      GUEST_WORDS_KEY,
      JSON.stringify([{ word: '' }, { word: 'old', timestamp: 5, partOfSpeech: 'bogus' }]),
    )
    const [word, ...rest] = readGuestWords()
    expect(rest).toHaveLength(0)
    expect(word).toMatchObject({ word: 'old', partOfSpeech: 'noun', createdAt: 5 })
    expect(word.id).toBeTruthy()
  })

  it('clears everything', async () => {
    await guestWords.create(input)
    await guestWords.clear()
    expect(await guestWords.list()).toEqual([])
  })
})
