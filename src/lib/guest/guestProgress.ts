import { readJson, writeJson } from '@/lib/storage'
import { isQuizType, type NewQuizResult, type QuizResult } from '@/types/domain'

/** Same key the vanilla app used, so a guest keeps their history across the rewrite. */
const KEY = 'quiz_history'
const MAX_ENTRIES = 50

interface StoredResult extends Partial<QuizResult> {
  date?: string
}

function normalise(raw: StoredResult): QuizResult {
  const total = raw.totalQuestions || 1
  const score = raw.score ?? 0
  return {
    id: raw.id ?? `q_${raw.createdAt ?? Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    quizType: isQuizType(raw.quizType) ? raw.quizType : 'multiple',
    score,
    totalQuestions: raw.totalQuestions ?? 0,
    percentage: raw.percentage ?? Math.round((score * 100) / total),
    wordsCount: raw.wordsCount ?? 0,
    createdAt: raw.createdAt ?? (raw.date ? new Date(raw.date).getTime() : Date.now()),
  }
}

export function listGuestQuizHistory(limit = 10): QuizResult[] {
  const raw = readJson<StoredResult[]>(KEY, [])
  if (!Array.isArray(raw)) return []
  return raw
    .map(normalise)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

export function saveGuestQuizResult(input: NewQuizResult): void {
  const existing = readJson<StoredResult[]>(KEY, [])
  const entry = normalise({
    quizType: input.quizType,
    score: input.score,
    totalQuestions: input.totalQuestions,
    wordsCount: input.wordsCount,
    createdAt: Date.now(),
  })
  const next = [entry, ...(Array.isArray(existing) ? existing : [])].slice(0, MAX_ENTRIES)
  writeJson(KEY, next)
}
