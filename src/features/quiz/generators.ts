import {
  aiGapFill,
  aiGapFillVerbForm,
  aiOpenClause,
  aiReadingComprehension,
  aiWrongAnswers,
} from '@/lib/supabase/ai'
import {
  answerKey,
  validateGapFill,
  validateOpenClause,
  validateReading,
  validateWrongAnswers,
} from '@shared/aiValidation'
import { AiDailyLimitError, AiRateLimitError, AiUnavailableError } from '@/lib/errors'
import { sample, shuffle } from '@/lib/shuffle'
import type { Difficulty, QuizType, Word } from '@/types/domain'
import type { ChoiceQuestion, QuizQuestion, QuizSession, TextQuestion } from './types'

/** One AI request per question is expensive; keep three in flight at most. */
const CONCURRENCY = 3

export class ReadingParseError extends Error {
  constructor() {
    super('READING_PARSE_FAILED')
    this.name = 'ReadingParseError'
  }
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })

  await Promise.all(runners)
  return results
}

/**
 * Distractors are other words' definitions. Definitions that read the same as
 * the answer (or as each other) are skipped: two identical options would make
 * the question unanswerable. With no usable distractor at all the word is asked
 * as a typed-answer question instead of padding with fake options.
 */
export function localChoiceQuestion(word: Word, pool: Word[]): QuizQuestion {
  const seen = new Set([answerKey(word.definition)])
  const distractors: string[] = []
  for (const candidate of shuffle(pool)) {
    if (candidate.id === word.id) continue
    const key = answerKey(candidate.definition)
    if (!key || seen.has(key)) continue
    seen.add(key)
    distractors.push(candidate.definition)
    if (distractors.length === 3) break
  }

  if (distractors.length === 0) return localTextQuestion(word, word.definition)

  const options = shuffle([word.definition, ...distractors])
  return {
    kind: 'choice',
    id: word.id,
    word: word.word,
    prompt: word.word,
    options,
    correctIndex: options.indexOf(word.definition),
  }
}

function localTextQuestion(word: Word, prompt: string, hint?: string): TextQuestion {
  return { kind: 'text', id: word.id, word: word.word, prompt, correctAnswer: word.word, hint }
}

/**
 * Parses the free-text reading response
 * (`Passage:` / `Questions:` / `Answers:` blocks) the Edge Function asks for.
 */
export function parseReadingResponse(content: string): {
  passage: string
  questions: ChoiceQuestion[]
} {
  const passage = content.match(/Passage:\s*([\s\S]*?)\n\s*Questions:/i)?.[1]?.trim() ?? ''
  const questionsBlock = content.match(/Questions:\s*([\s\S]*?)\n\s*Answers:/i)?.[1]?.trim() ?? ''
  const answersBlock = content.match(/Answers:\s*([\s\S]*)$/i)?.[1]?.trim() ?? ''

  // `1. A` / `2) c` — keyed by question number so a skipped line cannot shift
  // every later answer onto the wrong question.
  const correctIndices = new Map<number, number>()
  answersBlock.split('\n').forEach((line) => {
    const match = /^\s*(\d+)\s*[.):-]\s*([A-D])\b/i.exec(line)
    if (match) correctIndices.set(Number(match[1]), 'ABCD'.indexOf(match[2].toUpperCase()))
  })

  const questionRegex =
    /(\d+)\.\s*([^\n]+)\n\s*A\)\s*([^\n]+)\n\s*B\)\s*([^\n]+)\n\s*C\)\s*([^\n]+)(?:\n\s*D\)\s*([^\n]+))?/g

  const questions: ChoiceQuestion[] = []
  let match: RegExpExecArray | null
  while ((match = questionRegex.exec(questionsBlock)) !== null) {
    const options = [match[3], match[4], match[5], match[6]]
      .filter((option): option is string => Boolean(option))
      .map((option) => option.trim())
    const correctIndex = correctIndices.get(Number(match[1])) ?? -1
    // A question without a usable answer key cannot be graded — drop it
    // rather than silently marking option A as correct.
    if (correctIndex < 0 || correctIndex >= options.length) continue
    if (new Set(options.map(answerKey)).size !== options.length) continue
    questions.push({
      kind: 'choice',
      id: `reading-${questions.length}`,
      prompt: match[2].trim(),
      options,
      correctIndex,
    })
  }

  if (!passage || questions.length === 0) throw new ReadingParseError()
  return { passage, questions }
}

/**
 * Accepts the validated JSON contract and, for an older deployed function, the
 * legacy free-text format. Returns null when neither yields a usable quiz.
 */
export function readingFromAi(
  data: Record<string, unknown>,
  maxQuestions: number,
): { passage: string; questions: ChoiceQuestion[] } | null {
  const structured = validateReading(data, maxQuestions)
  if (structured) {
    return {
      passage: structured.passage,
      questions: structured.questions.map((question, index) => ({
        kind: 'choice',
        id: `reading-${index}`,
        prompt: question.question,
        options: question.options,
        correctIndex: question.answerIndex,
      })),
    }
  }
  if (typeof data.content === 'string') {
    try {
      return parseReadingResponse(data.content)
    } catch {
      return null
    }
  }
  return null
}

export interface GenerateOptions {
  type: QuizType
  words: Word[]
  questionCount: number
  /** Passed to the model so it can tune how close the distractors sit. */
  difficulty: Difficulty
  /** Guests have no Edge Function access — they get locally built questions. */
  useAi: boolean
}

/**
 * Builds a quiz. Every AI failure degrades to a locally generated question so a
 * flaky model or an exhausted quota never blocks practice.
 */
export async function generateQuiz({
  type,
  words,
  questionCount,
  difficulty,
  useAi,
}: GenerateOptions): Promise<QuizSession> {
  let quotaReached = false
  // Circuit breaker: once the AI is unavailable or rate limited, the remaining
  // questions go local instead of each waiting for their own timeout.
  let aiStopped = false
  let fallbackCount = 0

  const callAi = async <T>(run: () => Promise<T>): Promise<T | null> => {
    if (!useAi || quotaReached || aiStopped) return null
    try {
      return await run()
    } catch (error) {
      if (error instanceof AiDailyLimitError) quotaReached = true
      else if (error instanceof AiRateLimitError || error instanceof AiUnavailableError) {
        aiStopped = true
      }
      return null
    }
  }

  if (type === 'reading') {
    const chosen = sample(words, Math.min(words.length, 12))
    const data = await callAi(() =>
      aiReadingComprehension(
        chosen.map((word) => word.word),
        questionCount,
        difficulty,
      ),
    )
    const parsed = data ? readingFromAi(data, questionCount) : null
    if (!parsed) throw quotaReached ? new AiDailyLimitError() : new ReadingParseError()
    return {
      type,
      questions: parsed.questions,
      passage: parsed.passage,
      words: chosen,
      difficulty,
      quotaReached,
      fallbackCount: 0,
    }
  }

  const pool = type === 'gap-verb-form' ? words.filter((w) => w.partOfSpeech === 'verb') : words
  const chosen = sample(pool, questionCount)

  const questions = await mapLimited<Word, QuizQuestion>(chosen, CONCURRENCY, async (word) => {
    switch (type) {
      case 'multiple': {
        const data = validateWrongAnswers(
          await callAi(() =>
            aiWrongAnswers(word.word, word.definition, word.partOfSpeech, difficulty),
          ),
        )
        if (!data) {
          fallbackCount++
          return localChoiceQuestion(word, pool)
        }
        const options = shuffle([data.correctAnswer, ...data.wrongAnswers])
        return {
          kind: 'choice',
          id: word.id,
          word: word.word,
          prompt: word.word,
          options,
          correctIndex: options.indexOf(data.correctAnswer),
        }
      }

      case 'open': {
        const data = validateOpenClause(
          await callAi(() =>
            aiOpenClause(word.word, word.definition, word.partOfSpeech, difficulty),
          ),
        )
        if (!data) {
          fallbackCount++
          return localTextQuestion(word, word.definition)
        }
        return {
          kind: 'text',
          id: word.id,
          word: word.word,
          prompt: data.question,
          correctAnswer: data.answer,
        }
      }

      case 'gap': {
        const data = validateGapFill(
          await callAi(() => aiGapFill(word.word, word.definition, word.partOfSpeech, difficulty)),
        )
        if (!data) {
          fallbackCount++
          return localTextQuestion(word, `____ — ${word.definition}`)
        }
        return {
          kind: 'text',
          id: word.id,
          word: word.word,
          prompt: data.sentence,
          correctAnswer: data.answer,
        }
      }

      case 'gap-verb-form': {
        const data = validateGapFill(
          await callAi(() => aiGapFillVerbForm(word.word, word.definition, difficulty)),
        )
        if (!data) {
          fallbackCount++
          return localTextQuestion(word, `____ — ${word.definition}`, word.word)
        }
        return {
          kind: 'text',
          id: word.id,
          word: word.word,
          prompt: data.sentence,
          correctAnswer: data.answer,
          hint: word.word,
        }
      }

      default: {
        fallbackCount++
        return localChoiceQuestion(word, pool)
      }
    }
  })

  return { type, questions, words: chosen, difficulty, quotaReached, fallbackCount }
}
