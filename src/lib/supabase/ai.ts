import { supabase } from './client'
import { AiDailyLimitError } from '@/lib/errors'
import type { PartOfSpeech, Word } from '@/types/domain'

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
 * One entry point for the `ai-chat` Edge Function. The function answers 429 with
 * `{error:'AI_DAILY_LIMIT_REACHED', usage}` — surfaced as a typed error so the UI
 * can show the quota message instead of a generic failure.
 */
export async function invokeAi<T>(type: AiType, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('ai-chat', {
    body: { type, payload },
  })

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
    if (context?.status === 429 || body?.error === 'AI_DAILY_LIMIT_REACHED') {
      throw new AiDailyLimitError(body?.usage)
    }
    throw new Error(body?.error ?? error.message)
  }

  if (!data) throw new Error('EMPTY_AI_RESPONSE')
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

export function aiChat(message: string, words: Word[]) {
  return invokeAi<{ response: string }>('chat', { message, words: toContext(words) })
}

export function aiWrongAnswers(word: string, definition: string, partOfSpeech: PartOfSpeech) {
  return invokeAi<{ correctAnswer: string; wrongAnswers: string[] }>('generate-wrong-answers', {
    word,
    definition,
    partOfSpeech,
  })
}

export function aiReadingComprehension(words: string[], questionCount: number) {
  return invokeAi<{ content: string }>('generate-reading-comprehension', {
    words,
    questionCount,
  })
}

export function aiOpenClause(word: string, definition: string, partOfSpeech: PartOfSpeech) {
  return invokeAi<{ question: string; answer: string }>('generate-open-clause', {
    word,
    definition,
    partOfSpeech,
  })
}

export function aiGapFill(word: string, definition: string, partOfSpeech: PartOfSpeech) {
  return invokeAi<{ sentence: string; answer: string }>('generate-gap-fill', {
    word,
    definition,
    partOfSpeech,
  })
}

export function aiGapFillVerbForm(word: string, definition: string) {
  return invokeAi<{ sentence: string; answer: string }>('generate-gap-fill-verb-form', {
    word,
    definition,
    partOfSpeech: 'verb',
  })
}

export function aiStructureWords(rawText: string) {
  return invokeAi<{ content: string }>('structure-words', { raw_text: rawText })
}
