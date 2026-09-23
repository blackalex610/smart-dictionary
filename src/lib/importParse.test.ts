import { describe, expect, it } from 'vitest'
import { serialise } from './export'
import {
  parseAiEntries,
  parseCsvExport,
  parseCsvRows,
  parseJsonExport,
  parseOwnExport,
  parseStructuredLines,
  parseStructuredList,
  parseTxtExport,
  planImport,
} from './importParse'
import type { Word } from '@/types/domain'

const sample: Word[] = [
  {
    id: '1',
    word: 'ябълка',
    definition: 'Плод, "кръгъл", сладък',
    partOfSpeech: 'noun',
    example: 'Ям ябълка.',
    folder: 'Храна',
    createdAt: 1,
  },
  {
    id: '2',
    word: 'run',
    definition: '=HYPERLINK("http://evil")',
    partOfSpeech: 'verb',
    example: null,
    folder: 'General',
    createdAt: 2,
  },
]

describe('parseStructuredLines', () => {
  it('splits on the first and last comma only', () => {
    const result = parseStructuredLines('bank, a place, for money, noun\nbad line\n')
    expect(result.words).toEqual([
      { word: 'bank', definition: 'a place, for money', partOfSpeech: 'noun', example: null },
    ])
    expect(result.skipped).toBe(1)
  })

  it('accepts Bulgarian part-of-speech names', () => {
    expect(parseStructuredLines('тичам,движа се бързо,глагол').words[0].partOfSpeech).toBe('verb')
  })

  it('drops entries that are too long', () => {
    expect(parseStructuredLines(`${'x'.repeat(101)},def,noun`).words).toHaveLength(0)
  })
})

describe('parseStructuredList', () => {
  it('recognises a one-entry-per-line list', () => {
    const result = parseStructuredList(
      ['run,to move fast,verb', 'bright,full of light,adjective', 'noise'].join('\n'),
    )
    expect(result?.words.map((w) => w.word)).toEqual(['run', 'bright'])
  })

  it('does not treat prose with commas as a list', () => {
    expect(
      parseStructuredList(
        ['Yesterday, I went home, noun.', 'Then I slept.', 'And ate, too.'].join('\n'),
      ),
    ).toBeNull()
  })
})

describe('own export round trips', () => {
  it.each(['json', 'csv', 'txt'] as const)('re-imports its own %s export', (format) => {
    const { content } = serialise(sample, format)
    const parsed = parseOwnExport(content)
    expect(parsed?.words.map((w) => [w.word, w.definition, w.partOfSpeech])).toEqual(
      sample.map((w) => [w.word, w.definition, w.partOfSpeech]),
    )
  })

  it('keeps examples through CSV', () => {
    const parsed = parseCsvExport(serialise(sample, 'csv').content)
    expect(parsed?.words[0].example).toBe('Ям ябълка.')
  })

  it('does not mistake arbitrary text for an export', () => {
    expect(parseJsonExport('hello')).toBeNull()
    expect(parseCsvExport('a,b,c\n1,2,3')).toBeNull()
    expect(parseTxtExport('just some notes')).toBeNull()
  })
})

describe('parseCsvRows', () => {
  it('handles quotes, escaped quotes, commas and newlines in cells', () => {
    expect(parseCsvRows('a,"b,c","d ""e""","f\ng"\r\nh,i,j,k')).toEqual([
      ['a', 'b,c', 'd "e"', 'f\ng'],
      ['h', 'i', 'j', 'k'],
    ])
  })
})

describe('parseAiEntries', () => {
  it('validates every entry the model returns', () => {
    const result = parseAiEntries([
      { word: 'ok', definition: 'fine', partOfSpeech: 'adjective' },
      { word: '', definition: 'x', partOfSpeech: 'noun' },
      { word: 'bad', definition: 'x', partOfSpeech: 'preposition' },
      null,
    ])
    expect(result.words).toHaveLength(1)
    expect(result.skipped).toBe(3)
  })

  it('tolerates a non-array', () => {
    expect(parseAiEntries('nope')).toEqual({ words: [], skipped: 0 })
  })
})

describe('planImport', () => {
  const entry = (word: string, partOfSpeech: Word['partOfSpeech'] = 'noun') => ({
    word,
    definition: 'd',
    partOfSpeech,
  })

  it('skips words already in the dictionary (case-insensitive, same part of speech)', () => {
    const plan = planImport([entry('Ябълка'), entry('run', 'noun'), entry('new')], sample, 200)
    expect(plan.toAdd.map((e) => e.word)).toEqual(['run', 'new'])
    expect(plan.existing).toBe(1)
  })

  it('skips repeats inside the file and reports the overflow', () => {
    const plan = planImport([entry('a'), entry('A'), entry('b'), entry('c')], [], 2)
    expect(plan.toAdd.map((e) => e.word)).toEqual(['a', 'b'])
    expect(plan.repeated).toBe(1)
    expect(plan.overLimit).toBe(1)
  })
})
