import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { listQuizHistory, saveQuizResult } from '@/lib/supabase/progress'
import type { NewQuizResult, QuizResult } from '@/types/domain'

export function useQuizHistory(limit = 10) {
  const { scope, state } = useAuth()

  return useQuery({
    queryKey: ['quiz-history', scope, limit],
    queryFn: (): Promise<QuizResult[]> => listQuizHistory(limit),
    enabled: state.status === 'authenticated',
    staleTime: 30_000,
  })
}

export function useSaveQuizResult() {
  const { scope } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: NewQuizResult) => saveQuizResult(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['quiz-history', scope] }),
  })
}
