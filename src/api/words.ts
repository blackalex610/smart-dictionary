import { apiFetch } from './client'

export interface WordDto {
  id: string
  dictionary_id: string
  word: string
  definition: string
  part_of_speech: string | null
  example: string | null
  translation: string | null
  notes: string | null
  difficulty: number | null
  created_at: string
  updated_at: string
}

export interface NewWordDto {
  word: string
  definition: string
  part_of_speech?: string | null
  example?: string | null
  translation?: string | null
  notes?: string | null
  difficulty?: number | null
}

export interface WordListResponse {
  items: WordDto[]
  next_cursor: string | null
  has_more: boolean
}

export interface ListWordsParams {
  cursor?: string
  limit?: number
  q?: string
  pos?: string
  state?: string
  sort?: 'created' | 'alpha'
}

// Generic over the params object: an interface like ListWordsParams has no
// index signature, so it is not assignable to Record<string, ...>.
function toQueryString<T extends object>(params: T): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params) as [string, string | number | undefined][]) {
    if (value !== undefined) query.set(key, String(value))
  }
  const qs = query.toString()
  return qs ? `?${qs}` : ''
}

export function listWords(
  dictionaryId: string,
  params: ListWordsParams = {},
): Promise<WordListResponse> {
  return apiFetch(`/api/v1/dictionaries/${dictionaryId}/words${toQueryString(params)}`)
}

export function createWord(dictionaryId: string, input: NewWordDto): Promise<WordDto> {
  return apiFetch(`/api/v1/dictionaries/${dictionaryId}/words`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function bulkCreateWords(
  dictionaryId: string,
  rows: NewWordDto[],
): Promise<{ results: { word: WordDto | null; error: string | null }[] }> {
  return apiFetch(`/api/v1/dictionaries/${dictionaryId}/words:bulk`, {
    method: 'POST',
    body: JSON.stringify({ rows }),
  })
}

export function getWord(id: string): Promise<WordDto> {
  return apiFetch(`/api/v1/words/${id}`)
}

export function updateWord(id: string, patch: Partial<NewWordDto>): Promise<WordDto> {
  return apiFetch(`/api/v1/words/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteWord(id: string): Promise<void> {
  return apiFetch(`/api/v1/words/${id}`, { method: 'DELETE' })
}

export function moveWord(id: string, dictionaryId: string): Promise<WordDto> {
  return apiFetch(`/api/v1/words/${id}:move`, {
    method: 'POST',
    body: JSON.stringify({ dictionary_id: dictionaryId }),
  })
}
