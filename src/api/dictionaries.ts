import { apiFetch } from './client'

export interface DictionaryDto {
  id: string
  name: string
  language_code: string | null
  description: string | null
  is_default: boolean
  word_count: number
  due_count: number
  created_at: string
  updated_at: string
}

export interface NewDictionaryDto {
  name: string
  language_code?: string | null
  description?: string | null
}

export function listDictionaries(): Promise<{ items: DictionaryDto[] }> {
  return apiFetch('/api/v1/dictionaries')
}

export function createDictionary(input: NewDictionaryDto): Promise<DictionaryDto> {
  return apiFetch('/api/v1/dictionaries', { method: 'POST', body: JSON.stringify(input) })
}

export function updateDictionary(
  id: string,
  patch: Partial<NewDictionaryDto & { is_default: boolean }>,
): Promise<DictionaryDto> {
  return apiFetch(`/api/v1/dictionaries/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteDictionary(id: string): Promise<void> {
  return apiFetch(`/api/v1/dictionaries/${id}`, { method: 'DELETE' })
}
