import { supabase } from './client'
import { AiDailyLimitError, AiRateLimitError, AiUnavailableError } from '@/lib/errors'
import type { ChoiceSet, Reading, StructuredEntry } from '@shared/aiValidation'
import type { Difficulty, PartOfSpeech, Word } from '@/types/domain'

/**
 * Longer than the Edge Function's own worst case (one primary attempt plus one
 * fallback attempt), so the server gets to answer with a proper error first.
 */
const AI_TIMEOUT_MS = 100_000

export type AiType =
  | 'chat'
  | 'generate-wrong-answers'
  | 'generate-reading-comprehension'
  | 'generate-open-clause'
  | 'generate-gap-fill'
  | 'generate-gap-fill-verb-form'
  | 'structure-words'

interface FunctionsErrorContext {
  context?: { status?: number; clone?: () => Response }
}

/**
 * One entry point for the `ai-chat` Edge Function. Every failure becomes one of
 * three typed errors so the UI can say something useful — the daily quota, the
 * per-minute burst limit, or "the AI is unavailable" — and never shows a raw
 * server or network message.
 */
export async function invokeAi<T>(type: AiType, payload: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new AiUnavailableError('OFFLINE')
  }

  let result: Awaited<ReturnType<typeof supabase.functions.invoke<T>>>
  try {
    result = await supabase.functions.invoke<T>('ai-chat', {
      body: { type, payload },
      timeout: AI_TIMEOUT_MS,
    })
  } catch {
    throw new AiUnavailableError('NETWORK_ERROR')
  }
  const { data, error } = result

  if (error) {
    const context = (error as unknown as FunctionsErrorContext).context
    let body: { error?: string; usage?: unknown } | null = null
    if (context?.clone) {
      try {
        body = (await context.clone().json()) as { error?: string; usage?: unknown }
      } catch {
        /* non-JSON error body */
      }
    }
    if (body?.error === 'AI_RATE_LIMITED') throw new AiRateLimitError()
    if (context?.status === 429 || body?.error === 'AI_DAILY_LIMIT_REACHED') {
      throw new AiDailyLimitError(body?.usage)
    }
    throw new AiUnavailableError(body?.error ?? 'AI_REQUEST_FAILED')
  }

  if (!data) throw new AiUnavailableError('EMPTY_AI_RESPONSE')
  return data
}

/** The chat endpoint only needs the vocabulary, not our internal row shape. */
function toContext(words: Word[]) {
  return words.slice(0, 200).map((w) => ({
    word: w.word,
    definition: w.definition,
    partOfSpeech: w.partOfSpeech,
  }))
}

/** Prior turns the assistant should stay aware of, oldest first. */
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Enough context to stay coherent without blowing up the prompt. */
const MAX_HISTORY_TURNS = 12

export function aiChat(message: string, words: Word[], history: ChatTurn[] = []) {
  return invokeAi<{ response: string }>('chat', {
    message,
    words: toContext(words),
    history: history.slice(-MAX_HISTORY_TURNS),
  })
}

export function aiWrongAnswers(
  word: string,
  definition: string,
  partOfSpeech: PartOfSpeech,
  difficulty: Difficulty,
) {
  // Untrusted until it passes validateWrongAnswers() in the quiz generator.
  return invokeAi<Partial<ChoiceSet>>('generate-wrong-answers', {
    word,
    definition,
    partOfSpeech,
    difficulty,
  })
}

export function aiReadingComprehension(
  words: string[],
  questionCount: number,
  difficulty: Difficulty,
) {
  // `content` is the legacy free-text format from before the JSON contract.
  return invokeAi<Partial<Reading> & { content?: string }>('generate-reading-comprehension', {
    words,
    questionCount,
    difficulty,
  })
}

export function aiOpenClause(
  word: string,
  definition: string,
  partOfSpeech: PartOfSpeech,
  difficulty: Difficulty,
) {
  return invokeAi<Record<string, unknown>>('generate-open-clause', {
    word,
    definition,
    partOfSpeech,
    difficulty,
  })
}

export function aiGapFill(
  word: string,
  definition: string,
  partOfSpeech: PartOfSpeech,
  difficulty: Difficulty,
) {
  return invokeAi<Record<string, unknown>>('generate-gap-fill', {
    word,
    definition,
    partOfSpeech,
    difficulty,
  })
}

export function aiGapFillVerbForm(word: string, definition: string, difficulty: Difficulty) {
  return invokeAi<Record<string, unknown>>('generate-gap-fill-verb-form', {
    word,
    definition,
    partOfSpeech: 'verb',
    difficulty,
  })
}

export function aiStructureWords(rawText: string) {
  // `content` is the legacy `word,definition,pos` line format.
  return invokeAi<{ entries?: StructuredEntry[]; content?: string }>('structure-words', {
    raw_text: rawText,
  })
}
