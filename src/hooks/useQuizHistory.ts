import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { listGuestQuizHistory, saveGuestQuizResult } from '@/lib/guest/guestProgress'
import { listQuizHistory, saveQuizResult } from '@/lib/supabase/progress'
import type { NewQuizResult, QuizResult } from '@/types/domain'

export function useQuizHistory(limit = 10) {
  const { scope, state } = useAuth()

  return useQuery({
    queryKey: ['quiz-history', scope, limit],
    queryFn: async (): Promise<QuizResult[]> => {
      if (state.status === 'authenticated') return listQuizHistory(limit)
      return listGuestQuizHistory(limit)
    },
    enabled: state.status === 'authenticated' || state.status === 'guest',
    staleTime: 30_000,
  })
}

export function useSaveQuizResult() {
  const { scope, state } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: NewQuizResult) => {
      if (state.status === 'authenticated') {
        await saveQuizResult(input)
        return
      }
      saveGuestQuizResult(input)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['quiz-history', scope] }),
  })
}
