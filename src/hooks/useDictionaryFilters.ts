import { useMemo, useState } from 'react'
import { folderOf } from '@/lib/folders'
import type { PartOfSpeech, SortOrder, Word } from '@/types/domain'

export interface DictionaryFilters {
  query: string
  setQuery: (value: string) => void
  folder: string | null
  setFolder: (value: string | null) => void
  partOfSpeech: PartOfSpeech | 'all'
  setPartOfSpeech: (value: PartOfSpeech | 'all') => void
  sort: SortOrder
  setSort: (value: SortOrder) => void
  filtered: Word[]
}

export function useDictionaryFilters(words: Word[]): DictionaryFilters {
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [partOfSpeech, setPartOfSpeech] = useState<PartOfSpeech | 'all'>('all')
  const [sort, setSort] = useState<SortOrder>('newest')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const result = words.filter((word) => {
      if (folder && folderOf(word) !== folder) return false
      if (partOfSpeech !== 'all' && word.partOfSpeech !== partOfSpeech) return false
      if (!needle) return true
      return (
        word.word.toLowerCase().includes(needle) ||
        word.definition.toLowerCase().includes(needle) ||
        (word.example ?? '').toLowerCase().includes(needle)
      )
    })

    return result.sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return a.createdAt - b.createdAt
        case 'az':
          return a.word.localeCompare(b.word)
        case 'za':
          return b.word.localeCompare(a.word)
        case 'newest':
        default:
          return b.createdAt - a.createdAt
      }
    })
  }, [words, query, folder, partOfSpeech, sort])

  return {
    query,
    setQuery,
    folder,
    setFolder,
    partOfSpeech,
    setPartOfSpeech,
    sort,
    setSort,
    filtered,
  }
}
