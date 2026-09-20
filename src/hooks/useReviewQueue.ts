import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getReviewQueue, submitReview, type ReviewQueueItemDto } from '@/api/reviews'
import { useAuth } from '@/context/AuthContext'

function queueKey(scope: string, dictionaryId?: string) {
  return ['review-queue', scope, dictionaryId ?? 'all']
}

export function useReviewQueue(dictionaryId?: string) {
  const { scope, state } = useAuth()

  return useQuery({
    queryKey: queueKey(scope, dictionaryId),
    queryFn: () => getReviewQueue({ dictionaryId }).then((r) => r.items),
    enabled: state.status === 'authenticated',
    staleTime: 0,
  })
}

export function useSubmitReview(dictionaryId?: string) {
  const { scope } = useAuth()
  const queryClient = useQueryClient()
  const key = queueKey(scope, dictionaryId)

  return useMutation({
    mutationFn: (input: { wordId: string; rating: 1 | 2 | 3 | 4; elapsedMs?: number }) =>
      submitReview(input),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData<ReviewQueueItemDto[]>(key, (prev) =>
        (prev ?? []).filter((item) => item.word_id !== variables.wordId),
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}
