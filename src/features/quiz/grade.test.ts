import { describe, expect, it } from 'vitest'
import { expectedAnswer, gradeQuiz, isCorrect, verdictFor } from './grade'
import type { ChoiceQuestion, TextQuestion } from './types'

const choice: ChoiceQuestion = {
  kind: 'choice',
  id: 'w1',
  word: 'ubiquitous',
  prompt: 'ubiquitous',
  options: ['present everywhere', 'very rare', 'loud', 'expensive'],
  correctIndex: 0,
}

const text: TextQuestion = {
  kind: 'text',
  id: 'w2',
  word: 'cat',
  prompt: 'A small domesticated feline is a ____.',
  correctAnswer: 'cat',
}

describe('isCorrect', () => {
  it('matches a choice question by index, not by label', () => {
    expect(isCorrect(choice, '0')).toBe(true)
    expect(isCorrect(choice, '1')).toBe(false)
  })

  it('treats an unanswered choice question as wrong, not as index 0', () => {
    expect(isCorrect(choice, '')).toBe(false)
  })

  it('normalises whitespace and case for text answers', () => {
    expect(isCorrect(text, 'CAT')).toBe(true)
    expect(isCorrect(text, '  cat  ')).toBe(true)
    expect(isCorrect(text, 'dog')).toBe(false)
  })
})

describe('expectedAnswer', () => {
  it('resolves a choice question to its correct option text', () => {
    expect(expectedAnswer(choice)).toBe('present everywhere')
  })

  it('resolves a text question to its correct answer', () => {
    expect(expectedAnswer(text)).toBe('cat')
  })
})

describe('gradeQuiz', () => {
  it('scores a mixed set of questions and reports per-answer detail', () => {
    const result = gradeQuiz([choice, text], { w1: '0', w2: 'cat' })
    expect(result).toEqual({
      score: 2,
      total: 2,
      percentage: 100,
      answers: [
        { questionId: 'w1', correct: true, given: '0', expected: 'present everywhere' },
        { questionId: 'w2', correct: true, given: 'cat', expected: 'cat' },
      ],
    })
  })

  it('treats a missing answer as an empty, incorrect response', () => {
    const result = gradeQuiz([choice], {})
    expect(result.score).toBe(0)
    expect(result.answers[0].given).toBe('')
  })

  it('does not divide by zero when given no questions', () => {
    expect(gradeQuiz([], {})).toEqual({ score: 0, total: 0, percentage: 0, answers: [] })
  })
})

describe('verdictFor', () => {
  it.each([
    [100, 'excellent'],
    [80, 'excellent'],
    [79, 'good'],
    [60, 'good'],
    [59, 'keep-going'],
    [0, 'keep-going'],
  ] as const)('%i%% -> %s', (percentage, expected) => {
    expect(verdictFor(percentage)).toBe(expected)
  })
})
