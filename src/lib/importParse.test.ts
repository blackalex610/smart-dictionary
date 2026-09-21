import { describe, expect, it } from 'vitest'
import { serialise } from './export'
import { parseCsvExport, parseJsonExport, parseStructuredLines } from './importParse'
import type { Word } from '@/types/domain'

const WORDS: Word[] = [
  {
    id: '1',
    word: 'ubiquitous',
    definition: 'present, appearing, or found everywhere; a, b, c',
    partOfSpeech: 'adjective',
    example: 'Smartphones are now ubiquitous.',
    folder: 'General',
    createdAt: 1,
  },
  {
    id: '2',
    word: 'quote"quote',
    definition: 'a word containing a literal "quote" character',
    partOfSpeech: 'noun',
    example: null,
    folder: 'Advanced',
    createdAt: 2,
  },
  {
    id: '3',
    word: 'multiline',
    definition: 'a definition\nspanning two lines',
    partOfSpeech: 'verb',
    example: 'Line one.\nLine two.',
    folder: 'General',
    createdAt: 3,
  },
]

describe('CSV export/import round-trip', () => {
  it('recovers every word from our own CSV export, including a comma inside a definition', () => {
    const { content } = serialise(WORDS, 'csv')
    const parsed = parseCsvExport(content)

    expect(parsed).not.toBeNull()
    expect(parsed!.skipped).toBe(0)
    expect(parsed!.words).toEqual([
      {
        word: 'ubiquitous',
        definition: 'present, appearing, or found everywhere; a, b, c',
        partOfSpeech: 'adjective',
        example: 'Smartphones are now ubiquitous.',
      },
      {
        word: 'quote"quote',
        definition: 'a word containing a literal "quote" character',
        partOfSpeech: 'noun',
        example: null,
      },
      {
        word: 'multiline',
        definition: 'a definition\nspanning two lines',
        partOfSpeech: 'verb',
        example: 'Line one.\nLine two.',
      },
    ])
  })

  it('is what a naive comma split on the same export would get wrong', () => {
    // Documents the bug: parseStructuredLines only understands unquoted
    // `word,definition,pos` lines, so it drops every row of a real CSV
    // export whose definitions contain commas.
    const { content } = serialise(WORDS, 'csv')
    const naive = parseStructuredLines(content)
    expect(naive.words.length).toBeLessThan(WORDS.length)
  })

  it('returns null for a CSV whose header does not match our export', () => {
    expect(parseCsvExport('Name,Age\n"Alice",30')).toBeNull()
  })

  it('returns null for plain text', () => {
    expect(parseCsvExport('just a word, its definition, noun')).toBeNull()
  })

  it('counts a row with an invalid part of speech as skipped', () => {
    const csv = 'Word,Definition,Part of Speech,Example,Folder\n"x","y","preposition","",General'
    const parsed = parseCsvExport(csv)
    expect(parsed).toEqual({ words: [], skipped: 1 })
  })

  it('handles a file with no trailing newline', () => {
    const csv = 'Word,Definition,Part of Speech,Example,Folder\n"cat","an animal","noun","",General'
    const parsed = parseCsvExport(csv)
    expect(parsed?.words).toHaveLength(1)
  })
})

describe('JSON export/import round-trip', () => {
  it('recovers every word from our own JSON export', () => {
    const { content } = serialise(WORDS, 'json')
    const parsed = parseJsonExport(content)

    expect(parsed).not.toBeNull()
    expect(parsed!.skipped).toBe(0)
    expect(parsed!.words).toHaveLength(WORDS.length)
  })
})
