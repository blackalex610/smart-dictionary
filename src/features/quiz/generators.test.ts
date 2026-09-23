import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Word } from '@/types/domain'
import { AiUnavailableError } from '@/lib/errors'

vi.mock('@/lib/supabase/ai', () => ({
  aiWrongAnswers: vi.fn(),
  aiOpenClause: vi.fn(),
  aiGapFill: vi.fn(),
  aiGapFillVerbForm: vi.fn(),
  aiReadingComprehension: vi.fn(),
}))

const ai = await import('@/lib/supabase/ai')
const {
  generateQuiz,
  localChoiceQuestion,
  parseReadingResponse,
  readingFromAi,
  ReadingParseError,
} = await import('./generators')

let nextId = 0
function word(text: string, definition: string, partOfSpeech: Word['partOfSpeech'] = 'noun'): Word {
  nextId++
  return {
    id: `w${nextId}`,
    word: text,
    definition,
    partOfSpeech,
    example: null,
    folder: 'General',
    createdAt: nextId,
  }
}

beforeEach(() => {
  vi.mocked(ai.aiWrongAnswers).mockReset()
  vi.mocked(ai.aiOpenClause).mockReset()
  vi.mocked(ai.aiReadingComprehension).mockReset()
})

describe('localChoiceQuestion', () => {
  it('never offers two options that read the same', () => {
    const target = word('cat', 'a small pet')
    const pool = [
      target,
      word('kitten', 'A small pet.'),
      word('dog', 'a loyal pet'),
      word('hound', 'a loyal pet'),
      word('fish', 'lives in water'),
    ]
    for (let i = 0; i < 20; i++) {
      const question = localChoiceQuestion(target, pool)
      expect(question.kind).toBe('choice')
      if (question.kind !== 'choice') return
      const keys = question.options.map((o) => o.toLowerCase().replace(/\.$/, ''))
      expect(new Set(keys).size).toBe(keys.length)
      expect(question.options[question.correctIndex]).toBe('a small pet')
    }
  })

  it('does not pad with variants of the correct answer', () => {
    const target = word('a', 'first')
    const question = localChoiceQuestion(target, [target, word('b', 'second')])
    expect(question.kind).toBe('choice')
    if (question.kind === 'choice') {
      expect(question.options).toHaveLength(2)
      expect(question.options.join('|')).not.toMatch(/\(\d\)/)
    }
  })

  it('falls back to a typed answer when every definition is identical', () => {
    const target = word('big', 'large')
    const question = localChoiceQuestion(target, [
      target,
      word('huge', 'Large'),
      word('vast', 'large'),
    ])
    expect(question.kind).toBe('text')
  })
})

describe('parseReadingResponse', () => {
  const content = `Passage:
The cat sat on the mat.
Questions:
1. Where did the cat sit?
A) On the mat
B) On the roof
C) In a box
D) Under the bed
2. What colour was the cat?
A) Black
B) White
C) Grey
D) Orange
Answers:
1. A`

  it('drops a question that has no answer key instead of marking A correct', () => {
    const { questions } = parseReadingResponse(content)
    expect(questions).toHaveLength(1)
    expect(questions[0].correctIndex).toBe(0)
  })

  it('matches answers by question number', () => {
    const { questions } = parseReadingResponse(`${content.replace('1. A', '2) d\n1. B')}`)
    expect(questions.map((q) => q.correctIndex)).toEqual([1, 3])
  })

  it('throws when nothing is usable', () => {
    expect(() => parseReadingResponse('garbage')).toThrow(ReadingParseError)
  })
})

describe('readingFromAi', () => {
  it('prefers the structured contract', () => {
    const result = readingFromAi(
      {
        passage: 'P',
        questions: [{ question: 'Q', options: ['a', 'b', 'c', 'd'], answerIndex: 2 }],
      },
      5,
    )
    expect(result?.questions[0]).toMatchObject({ prompt: 'Q', correctIndex: 2 })
  })

  it('returns null for unusable output', () => {
    expect(readingFromAi({ passage: 'P', questions: [] }, 5)).toBeNull()
    expect(readingFromAi({ content: 'nonsense' }, 5)).toBeNull()
  })
})

describe('generateQuiz', () => {
  const pool = () => [
    word('cat', 'a pet that meows'),
    word('dog', 'a pet that barks'),
    word('cow', 'a farm animal'),
    word('owl', 'a night bird'),
    word('bee', 'makes honey'),
  ]

  it('uses validated AI distractors', async () => {
    vi.mocked(ai.aiWrongAnswers).mockResolvedValue({
      correctAnswer: 'right',
      wrongAnswers: ['w1', 'w2', 'w3'],
    })
    const session = await generateQuiz({
      type: 'multiple',
      words: pool(),
      questionCount: 3,
      difficulty: 'medium',
      useAi: true,
    })
    expect(session.fallbackCount).toBe(0)
    for (const question of session.questions) {
      expect(question.kind).toBe('choice')
      if (question.kind === 'choice') expect(question.options[question.correctIndex]).toBe('right')
    }
  })

  it('falls back locally when the AI returns duplicate options', async () => {
    vi.mocked(ai.aiWrongAnswers).mockResolvedValue({
      correctAnswer: 'right',
      wrongAnswers: ['right', 'w1', 'w1'],
    })
    const session = await generateQuiz({
      type: 'multiple',
      words: pool(),
      questionCount: 2,
      difficulty: 'medium',
      useAi: true,
    })
    expect(session.fallbackCount).toBe(2)
  })

  it('stops calling the AI after it is unavailable once', async () => {
    vi.mocked(ai.aiOpenClause).mockRejectedValue(new AiUnavailableError('AI_UNAVAILABLE'))
    const session = await generateQuiz({
      type: 'open',
      words: pool(),
      questionCount: 5,
      difficulty: 'medium',
      useAi: true,
    })
    expect(session.questions).toHaveLength(5)
    expect(session.fallbackCount).toBe(5)
    // Concurrency is 3, so at most the first wave reaches the network.
    expect(vi.mocked(ai.aiOpenClause).mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('never calls the AI for guests', async () => {
    const session = await generateQuiz({
      type: 'multiple',
      words: pool(),
      questionCount: 4,
      difficulty: 'easy',
      useAi: false,
    })
    expect(ai.aiWrongAnswers).not.toHaveBeenCalled()
    expect(session.questions).toHaveLength(4)
  })

  it('handles a pool smaller than the requested count', async () => {
    const session = await generateQuiz({
      type: 'gap',
      words: pool().slice(0, 2),
      questionCount: 10,
      difficulty: 'hard',
      useAi: false,
    })
    expect(session.questions).toHaveLength(2)
  })
})
