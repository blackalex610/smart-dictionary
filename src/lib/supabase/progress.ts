import { supabase } from './client'
import { isQuizType, type NewQuizResult, type QuizResult } from '@/types/domain'

interface ProgressRow {
  id: string
  quiz_type: string
  score: number
  total_questions: number
  percentage: number | null
  words_count: number | null
  created_at: string
}

function toResult(row: ProgressRow): QuizResult {
  const total = row.total_questions || 1
  return {
    id: row.id,
    quizType: isQuizType(row.quiz_type) ? row.quiz_type : 'multiple',
    score: row.score,
    totalQuestions: row.total_questions,
    percentage: row.percentage ?? Math.round((row.score * 100) / total),
    wordsCount: row.words_count ?? 0,
    createdAt: new Date(row.created_at).getTime(),
  }
}

export async function saveQuizResult(input: NewQuizResult): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) throw new Error('NOT_AUTHENTICATED')

  const { error } = await supabase.from('progress').insert({
    user_id: userId,
    quiz_type: input.quizType,
    score: input.score,
    total_questions: input.totalQuestions,
    words_count: input.wordsCount,
    details: input.details ?? {},
  })
  if (error) throw error
}

export async function listQuizHistory(limit = 10): Promise<QuizResult[]> {
  const { data, error } = await supabase
    .from('progress')
    .select('id, quiz_type, score, total_questions, percentage, words_count, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as unknown as ProgressRow[]).map(toResult)
}
