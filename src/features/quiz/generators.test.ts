import { describe, expect, it } from 'vitest'
import { buildChoiceOptions } from './generators'

describe('buildChoiceOptions', () => {
  it('builds four distinct options when three distinct distractors exist', () => {
    const options = buildChoiceOptions('correct', ['a', 'b', 'c', 'd'])
    expect(options).toHaveLength(4)
    expect(new Set(options).size).toBe(4)
    expect(options).toContain('correct')
  })

  it('drops a distractor that repeats the correct answer', () => {
    // The `generate-wrong-answers` endpoint asks an LLM for "plausible
    // incorrect" definitions and regularly gets the correct one back. Left
    // in, `indexOf` would resolve correctIndex to the first copy and grade
    // the identical second copy as wrong.
    const options = buildChoiceOptions('correct', ['correct', 'a', 'b', 'c'])
    expect(options.filter((option) => option === 'correct')).toHaveLength(1)
    expect(new Set(options).size).toBe(options.length)
  })

  it('deduplicates distractors that repeat each other', () => {
    const options = buildChoiceOptions('correct', ['a', 'a', 'a', 'b'])
    expect([...options].sort()).toEqual(['a', 'b', 'correct'])
  })

  it('never yields an ambiguous correctIndex', () => {
    const options = buildChoiceOptions('correct', ['correct', 'a', 'correct', 'a', 'b'])
    expect(options.indexOf('correct')).toBe(options.lastIndexOf('correct'))
  })

  it('returns a shorter but still valid question when distractors run out', () => {
    const options = buildChoiceOptions('correct', ['only'])
    expect([...options].sort()).toEqual(['correct', 'only'])
  })

  it('returns nothing when no distinct distractor is available', () => {
    expect(buildChoiceOptions('correct', [])).toEqual([])
    expect(buildChoiceOptions('correct', ['correct', 'correct'])).toEqual([])
  })

  it('ignores empty and non-string candidates', () => {
    const options = buildChoiceOptions('correct', ['', 'a', null as unknown as string, 'b'])
    expect([...options].sort()).toEqual(['a', 'b', 'correct'])
  })

  it('caps the option count at four', () => {
    expect(buildChoiceOptions('correct', ['a', 'b', 'c', 'd', 'e', 'f'])).toHaveLength(4)
  })
})
