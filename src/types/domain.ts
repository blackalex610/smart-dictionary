export const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb'] as const
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number]

export function isPartOfSpeech(v: unknown): v is PartOfSpeech {
  return typeof v === 'string' && (PARTS_OF_SPEECH as readonly string[]).includes(v)
}

export interface Word {
  id: string
  word: string
  definition: string
  partOfSpeech: PartOfSpeech
  example: string | null
  folder: string
  /** epoch ms */
  createdAt: number
}

export interface NewWord {
  word: string
  definition: string
  partOfSpeech: PartOfSpeech
  example?: string | null
  folder: string
}

export interface WordsBackend {
  list(): Promise<Word[]>
  create(input: NewWord): Promise<Word>
  update(id: string, patch: Partial<NewWord>): Promise<Word>
  remove(id: string): Promise<void>
  /** Deletes every word the current user owns. */
  clear(): Promise<void>
}

export type SortOrder = 'newest' | 'oldest' | 'az' | 'za'
export type ViewMode = 'list' | 'grid'

export interface UsageInfo {
  used: number
  limit: number | null
  isUnlimited: boolean
}

export type Tier = 'free' | 'premium'

export interface AppUser {
  id: string
  email: string | null
  name: string | null
  avatarUrl: string | null
}

export const QUIZ_TYPES = ['multiple', 'open', 'reading', 'gap', 'gap-verb-form'] as const
export type QuizType = (typeof QUIZ_TYPES)[number]

export function isQuizType(v: unknown): v is QuizType {
  return typeof v === 'string' && (QUIZ_TYPES as readonly string[]).includes(v)
}

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === 'string' && (DIFFICULTIES as readonly string[]).includes(v)
}

export const DEFAULT_DIFFICULTY: Difficulty = 'medium'

export interface QuizResult {
  id: string
  quizType: QuizType
  score: number
  totalQuestions: number
  percentage: number
  wordsCount: number
  /** epoch ms */
  createdAt: number
}

export interface NewQuizResult {
  quizType: QuizType
  score: number
  totalQuestions: number
  wordsCount: number
  details?: Record<string, unknown>
}
