import { apiFetch } from './client'

export interface ReviewQueueItemDto {
  word_id: string
  word: string
  definition: string
  part_of_speech: string | null
  example: string | null
  state: string
  due_at: string | null
}

export interface SubmitReviewResponseDto {
  word_id: string
  state: string
  ease_factor: string
  interval_days: number
  due_at: string
}

export interface ForecastDayDto {
  date: string
  due_count: number
}

export function getReviewQueue(
  params: { dictionaryId?: string; limit?: number } = {},
): Promise<{ items: ReviewQueueItemDto[] }> {
  const query = new URLSearchParams()
  if (params.dictionaryId) query.set('dictionary_id', params.dictionaryId)
  if (params.limit) query.set('limit', String(params.limit))
  const qs = query.toString()
  return apiFetch(`/api/v1/reviews/queue${qs ? `?${qs}` : ''}`)
}

export function submitReview(input: {
  wordId: string
  rating: 1 | 2 | 3 | 4
  elapsedMs?: number
}): Promise<SubmitReviewResponseDto> {
  return apiFetch('/api/v1/reviews', {
    method: 'POST',
    body: JSON.stringify({
      word_id: input.wordId,
      rating: input.rating,
      elapsed_ms: input.elapsedMs,
      source: 'flashcard',
    }),
  })
}

export function getReviewForecast(days = 14): Promise<{ days: ForecastDayDto[] }> {
  return apiFetch(`/api/v1/reviews/forecast?days=${days}`)
}
