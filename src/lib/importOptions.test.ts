import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMPORT_OPTIONS,
  prepareImportText,
  splitIntoParagraphs,
  type ImportOptions,
} from './importOptions'

const options = (patch: Partial<ImportOptions> = {}): ImportOptions => ({
  ...DEFAULT_IMPORT_OPTIONS,
  ...patch,
})

describe('splitIntoParagraphs', () => {
  it('flattens each blank-line block onto one line', () => {
    expect(splitIntoParagraphs('word\nmeaning\n\nsecond\nentry')).toEqual([
      'word meaning',
      'second entry',
    ])
  })

  it('ignores blocks that are only whitespace', () => {
    expect(splitIntoParagraphs('a\n\n   \n\nb')).toEqual(['a', 'b'])
  })
})

describe('prepareImportText', () => {
  it('splits per line when paragraph splitting is off', () => {
    const result = prepareImportText('one\ntwo\n\nthree', options({ splitParagraphs: false }))
    expect(result.segments).toEqual(['one', 'two', 'three'])
  })

  it('drops short fragments and reports how many', () => {
    const result = prepareImportText(
      'a\n\nlonger entry\n\n7\n\nanother entry',
      options({ splitParagraphs: true, ignoreShort: true, minLength: 3 }),
    )
    expect(result.segments).toEqual(['longer entry', 'another entry'])
    expect(result.dropped).toBe(2)
  })

  it('keeps everything when the short filter is off', () => {
    const result = prepareImportText('a\n\nb', options({ ignoreShort: false }))
    expect(result.segments).toEqual(['a', 'b'])
    expect(result.dropped).toBe(0)
  })

  it('counts only letters and digits towards the minimum', () => {
    // Four bullets and spaces, but one letter — below a minimum of 2.
    const result = prepareImportText('- - - a', options({ minLength: 2 }))
    expect(result.segments).toEqual([])
  })

  it('clamps an out-of-range minimum to the allowed bounds', () => {
    const short = 'word, meaning, noun'
    const long = `${short} with a good deal of extra explanatory text after it`
    // 9999 behaves as the 50-character ceiling, not as "drop everything".
    const result = prepareImportText(`${short}\n\n${long}`, options({ minLength: 9999 }))
    expect(result.segments).toEqual([long])

    // ...and a zero or negative minimum behaves as the floor of 1.
    expect(prepareImportText(short, options({ minLength: 0 })).segments).toEqual([short])
  })

  it('rejoins the kept segments as the text handed on', () => {
    const result = prepareImportText('one\n\ntwo', options({ ignoreShort: false }))
    expect(result.text).toBe('one\ntwo')
  })
})
