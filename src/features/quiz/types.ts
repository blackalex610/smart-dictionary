import type { QuizType, Word } from '@/types/domain'

export interface ChoiceQuestion {
  kind: 'choice'
  id: string
  /** The word being asked about, when the question is word-based. */
  word?: string
  prompt: string
  options: string[]
  correctIndex: number
}

export interface TextQuestion {
  kind: 'text'
  id: string
  word: string
  prompt: string
  correctAnswer: string
  /** Shown under the prompt — e.g. the infinitive for the verb-form quiz. */
  hint?: string
}

export type QuizQuestion = ChoiceQuestion | TextQuestion

export interface QuizSession {
  type: QuizType
  questions: QuizQuestion[]
  /** Reading comprehension only. */
  passage?: string
  words: Word[]
  /** True when the daily AI quota ran out mid-generation. */
  quotaReached: boolean
  /** Questions that fell back to locally generated content. */
  fallbackCount: number
}

export interface GradedAnswer {
  questionId: string
  correct: boolean
  given: string
  expected: string
}

export interface QuizGrade {
  score: number
  total: number
  percentage: number
  answers: GradedAnswer[]
}
