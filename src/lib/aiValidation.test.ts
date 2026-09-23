import { describe, expect, it } from 'vitest'
import {
  answerKey,
  cleanText,
  containsWord,
  normalisePartOfSpeech,
  parseJsonObject,
  validateEntry,
  validateGapFill,
  validateOpenClause,
  validateReading,
  validateStructuredEntries,
  validateWrongAnswers,
} from '@shared/aiValidation'

describe('cleanText', () => {
  it('trims, collapses whitespace and NFC-normalises', () => {
    expect(cleanText('  cafe\u0301   au  lait ', 50)).toBe('caf\u00e9 au lait')
  })

  it('removes control and bidi-override characters', () => {
    expect(cleanText('a\u0000b\u202Ec\u200Bd', 50)).toBe('abcd')
  })

  it('rejects non-strings, empty results and over-long text', () => {
    expect(cleanText(42, 10)).toBeNull()
    expect(cleanText('   ', 10)).toBeNull()
    expect(cleanText('x'.repeat(11), 10)).toBeNull()
  })

  it('keeps line breaks in multiline mode', () => {
    expect(cleanText('one\r\n\r\n\r\ntwo  three', 50, { multiline: true })).toBe('one\n\ntwo three')
  })
})

describe('answerKey / containsWord', () => {
  it('ignores case, spacing and trailing punctuation', () => {
    expect(answerKey('  To Run!  ')).toBe(answerKey('to run'))
  })

  it('matches whole words only, including Cyrillic', () => {
    expect(containsWord('I like to go home', 'go')).toBe(true)
    expect(containsWord('That is good news', 'go')).toBe(false)
    expect(containsWord('Котката спи на дивана', 'котката')).toBe(true)
    expect(containsWord('Котката спи', 'кот')).toBe(false)
  })

  it('treats regex characters in the answer literally', () => {
    expect(containsWord('What is C++ used for?', 'C++')).toBe(true)
    expect(containsWord('a.b', 'a*b')).toBe(false)
  })
})

describe('parseJsonObject', () => {
  it('parses plain and fenced JSON objects', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('returns null for arrays, prose and malformed JSON', () => {
    expect(parseJsonObject('[1,2]')).toBeNull()
    expect(parseJsonObject('Sure! Here it is')).toBeNull()
    expect(parseJsonObject('{"a":')).toBeNull()
    expect(parseJsonObject(undefined)).toBeNull()
  })
})

describe('validateWrongAnswers', () => {
  it('accepts one correct answer and three distinct distractors', () => {
    expect(
      validateWrongAnswers({ correctAnswer: 'A cat', wrongAnswers: ['A dog', 'A bird', 'A fish'] }),
    ).toEqual({ correctAnswer: 'A cat', wrongAnswers: ['A dog', 'A bird', 'A fish'] })
  })

  it('drops distractors that repeat the answer or each other', () => {
    const result = validateWrongAnswers({
      correctAnswer: 'A cat',
      wrongAnswers: ['a cat.', 'A dog', 'a  DOG', '', 'A bird', 'A fish', 'A frog'],
    })
    expect(result?.wrongAnswers).toEqual(['A dog', 'A bird', 'A fish'])
  })

  it('rejects output with fewer than three usable distractors', () => {
    expect(
      validateWrongAnswers({ correctAnswer: 'A cat', wrongAnswers: ['A cat', 'A dog', 'A dog'] }),
    ).toBeNull()
    expect(validateWrongAnswers({ correctAnswer: '', wrongAnswers: ['a', 'b', 'c'] })).toBeNull()
    expect(validateWrongAnswers({ correctAnswer: 'x', wrongAnswers: 'a,b,c' })).toBeNull()
    expect(validateWrongAnswers(null)).toBeNull()
  })

  it('rejects over-long options', () => {
    expect(
      validateWrongAnswers({ correctAnswer: 'x'.repeat(301), wrongAnswers: ['a', 'b', 'c'] }),
    ).toBeNull()
  })
})

describe('validateOpenClause', () => {
  it('accepts a question that does not reveal the answer', () => {
    expect(
      validateOpenClause({ question: 'What do you call a young dog?', answer: 'puppy' }),
    ).toEqual({ question: 'What do you call a young dog?', answer: 'puppy' })
  })

  it('rejects a question that contains the answer', () => {
    expect(validateOpenClause({ question: 'Is a puppy a young dog?', answer: 'puppy' })).toBeNull()
  })

  it('rejects missing fields', () => {
    expect(validateOpenClause({ question: 'What?' })).toBeNull()
  })
})

describe('validateGapFill', () => {
  it('normalises the blank and keeps the answer', () => {
    expect(validateGapFill({ sentence: 'She ______ to school.', answer: 'walks' })).toEqual({
      sentence: 'She ____ to school.',
      answer: 'walks',
    })
  })

  it('rejects sentences with no blank, two blanks, or the answer visible', () => {
    expect(validateGapFill({ sentence: 'She walks to school.', answer: 'walks' })).toBeNull()
    expect(validateGapFill({ sentence: '____ and ____', answer: 'x' })).toBeNull()
    expect(validateGapFill({ sentence: 'She walks ____ school.', answer: 'walks' })).toBeNull()
  })
})

describe('validateReading', () => {
  const question = (overrides: Record<string, unknown> = {}) => ({
    question: 'Where is the cat?',
    options: ['On the mat', 'In the box', 'Under the bed', 'On the roof'],
    answerIndex: 0,
    ...overrides,
  })

  it('accepts a passage with valid questions', () => {
    const result = validateReading({ passage: 'The cat sat on the mat.', questions: [question()] })
    expect(result?.questions).toHaveLength(1)
  })

  it('drops questions with a bad answer index or duplicate options', () => {
    const result = validateReading({
      passage: 'Text',
      questions: [
        question({ answerIndex: 4 }),
        question({ answerIndex: '0' }),
        question({ options: ['A', 'a', 'B', 'C'] }),
        question(),
      ],
    })
    expect(result?.questions).toHaveLength(1)
  })

  it('rejects a set with no usable question or no passage', () => {
    expect(
      validateReading({ passage: 'Text', questions: [question({ answerIndex: -1 })] }),
    ).toBeNull()
    expect(validateReading({ passage: '', questions: [question()] })).toBeNull()
  })

  it('honours the requested question count', () => {
    const result = validateReading(
      { passage: 'T', questions: [question(), question(), question()] },
      2,
    )
    expect(result?.questions).toHaveLength(2)
  })
})

describe('entries', () => {
  it('maps Bulgarian and abbreviated parts of speech', () => {
    expect(normalisePartOfSpeech('Съществително')).toBe('noun')
    expect(normalisePartOfSpeech('гл.')).toBe('verb')
    expect(normalisePartOfSpeech('Adj')).toBe('adjective')
    expect(normalisePartOfSpeech('preposition')).toBeNull()
  })

  it('validates a single entry', () => {
    expect(validateEntry({ word: ' ябълка ', definition: 'плод', partOfSpeech: 'същ.' })).toEqual({
      word: 'ябълка',
      definition: 'плод',
      partOfSpeech: 'noun',
    })
    expect(
      validateEntry({ word: 'x'.repeat(101), definition: 'd', partOfSpeech: 'noun' }),
    ).toBeNull()
  })

  it('counts invalid entries and caps the list size', () => {
    const entries = [
      { word: 'run', definition: 'move fast', partOfSpeech: 'verb' },
      { word: 'run' },
      'not an object',
      ...Array.from({ length: 305 }, (_, i) => ({
        word: `w${i}`,
        definition: 'd',
        partOfSpeech: 'noun',
      })),
    ]
    const result = validateStructuredEntries({ entries })
    expect(result.entries).toHaveLength(298)
    expect(result.skipped).toBe(2 + 8)
  })
})
