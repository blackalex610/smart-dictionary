import {
  aiGapFill,
  aiGapFillVerbForm,
  aiOpenClause,
  aiReadingComprehension,
  aiWrongAnswers,
} from '@/lib/supabase/ai'
import { AiDailyLimitError } from '@/lib/errors'
import { sample, shuffle } from '@/lib/shuffle'
import type { QuizType, Word } from '@/types/domain'
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
 * A multiple-choice question is only answerable if exactly one option is the
 * right one. `correctIndex` is resolved with `indexOf`, which returns the
 * first match -- so a distractor equal to the correct answer makes the
 * visually identical second copy grade as wrong. Two words sharing a
 * definition is enough to trigger that locally, and an AI asked for
 * "plausible incorrect" definitions returns the correct one often enough to
 * matter. Deduplicate first, and take up to three distractors: a question
 * with two or three distinct options is a worse question than one with four,
 * but it is still a correct one.
 *
 * Returns an empty array when not even one distinct distractor exists, which
 * the callers treat as "this question cannot be built".
 */
export function buildChoiceOptions(correct: string, candidates: readonly string[]): string[] {
  const seen = new Set([correct])
  const distractors: string[] = []
  for (const candidate of candidates) {
    if (distractors.length === 3) break
    if (typeof candidate !== 'string' || !candidate || seen.has(candidate)) continue
    seen.add(candidate)
    distractors.push(candidate)
  }
  return distractors.length === 0 ? [] : shuffle([correct, ...distractors])
}

function localChoiceQuestion(word: Word, pool: Word[]): ChoiceQuestion {
  const candidates = shuffle(
    pool.filter((candidate) => candidate.id !== word.id).map((candidate) => candidate.definition),
  )
  const options = buildChoiceOptions(word.definition, candidates)
  return {
    kind: 'choice',
    id: word.id,
    word: word.word,
    prompt: word.word,
    options: options.length > 0 ? options : [word.definition],
    correctIndex: options.length > 0 ? options.indexOf(word.definition) : 0,
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

  const correctIndices = answersBlock
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const letter = line.split(/[.)]/)[1]?.trim().toUpperCase().charAt(0) ?? ''
      return ['A', 'B', 'C', 'D'].indexOf(letter)
    })

  const questionRegex =
    /(\d+)\.\s*([^\n]+)\n\s*A\)\s*([^\n]+)\n\s*B\)\s*([^\n]+)\n\s*C\)\s*([^\n]+)(?:\n\s*D\)\s*([^\n]+))?/g

  const questions: ChoiceQuestion[] = []
  let match: RegExpExecArray | null
  while ((match = questionRegex.exec(questionsBlock)) !== null) {
    const options = [match[3], match[4], match[5], match[6]]
      .filter((option): option is string => Boolean(option))
      .map((option) => option.trim())
    const index = questions.length
    const correctIndex = correctIndices[index]
    questions.push({
      kind: 'choice',
      id: `reading-${index}`,
      prompt: match[2].trim(),
      options,
      correctIndex: correctIndex >= 0 && correctIndex < options.length ? correctIndex : 0,
    })
  }

  if (!passage || questions.length === 0) throw new ReadingParseError()
  return { passage, questions }
}

export interface GenerateOptions {
  type: QuizType
  words: Word[]
  questionCount: number
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
  useAi,
}: GenerateOptions): Promise<QuizSession> {
  let quotaReached = false
  let fallbackCount = 0

  const callAi = async <T>(run: () => Promise<T>): Promise<T | null> => {
    if (!useAi || quotaReached) return null
    try {
      return await run()
    } catch (error) {
      if (error instanceof AiDailyLimitError) quotaReached = true
      return null
    }
  }

  if (type === 'reading') {
    const chosen = sample(words, Math.min(words.length, 12))
    const data = await callAi(() =>
      aiReadingComprehension(
        chosen.map((word) => word.word),
        questionCount,
      ),
    )
    if (!data?.content) throw quotaReached ? new AiDailyLimitError() : new ReadingParseError()
    const parsed = parseReadingResponse(data.content)
    return {
      type,
      questions: parsed.questions,
      passage: parsed.passage,
      words: chosen,
      quotaReached,
      fallbackCount: 0,
    }
  }

  const pool = type === 'gap-verb-form' ? words.filter((w) => w.partOfSpeech === 'verb') : words
  const chosen = sample(pool, questionCount)

  const questions = await mapLimited<Word, QuizQuestion>(chosen, CONCURRENCY, async (word) => {
    switch (type) {
      case 'multiple': {
        const data = await callAi(() =>
          aiWrongAnswers(word.word, word.definition, word.partOfSpeech),
        )
        const correctAnswer = data?.correctAnswer
        const options =
          correctAnswer && Array.isArray(data?.wrongAnswers)
            ? buildChoiceOptions(correctAnswer, data.wrongAnswers)
            : []
        if (!correctAnswer || options.length === 0) {
          fallbackCount++
          return localChoiceQuestion(word, pool)
        }
        return {
          kind: 'choice',
          id: word.id,
          word: word.word,
          prompt: word.word,
          options,
          correctIndex: options.indexOf(correctAnswer),
        }
      }

      case 'open': {
        const data = await callAi(() => aiOpenClause(word.word, word.definition, word.partOfSpeech))
        if (!data?.question || !data.answer) {
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
        const data = await callAi(() => aiGapFill(word.word, word.definition, word.partOfSpeech))
        if (!data?.sentence || !data.answer) {
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
        const data = await callAi(() => aiGapFillVerbForm(word.word, word.definition))
        if (!data?.sentence || !data.answer) {
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

  return { type, questions, words: chosen, quotaReached, fallbackCount }
}
