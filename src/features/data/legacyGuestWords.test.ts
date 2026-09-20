import { afterEach, describe, expect, it } from 'vitest'
import { clearLegacyGuestWords, readLegacyGuestWords } from './legacyGuestWords'

const KEY = 'dictionary_guest'

afterEach(() => localStorage.clear())

describe('readLegacyGuestWords', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(readLegacyGuestWords()).toEqual([])
  })

  it('reads and normalises stored legacy words', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { word: 'cat', definition: 'an animal', partOfSpeech: 'noun', example: 'A cat sat.' },
      ]),
    )
    const words = readLegacyGuestWords()
    expect(words).toEqual([
      {
        word: 'cat',
        definition: 'an animal',
        partOfSpeech: 'noun',
        example: 'A cat sat.',
        folder: 'Imported',
      },
    ])
  })

  it('skips entries missing a word or definition', () => {
    localStorage.setItem(KEY, JSON.stringify([{ word: 'onlyword' }, { definition: 'onlydef' }]))
    expect(readLegacyGuestWords()).toEqual([])
  })

  it('falls back to noun for an invalid part of speech', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ word: 'x', definition: 'y', partOfSpeech: 'nonsense' }]),
    )
    expect(readLegacyGuestWords()[0].partOfSpeech).toBe('noun')
  })
})

describe('clearLegacyGuestWords', () => {
  it('removes the storage key', () => {
    localStorage.setItem(KEY, JSON.stringify([{ word: 'x', definition: 'y' }]))
    clearLegacyGuestWords()
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
