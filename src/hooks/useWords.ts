import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { GUEST_WORDS_KEY, guestWords } from '@/lib/guest/guestStore'
import { supabaseWords } from '@/lib/supabase/words'
import type { NewWord, Word, WordsBackend } from '@/types/domain'

export function useWordsBackend(): WordsBackend | null {
  const { state } = useAuth()
  if (state.status === 'authenticated') return supabaseWords
  if (state.status === 'guest') return guestWords
  return null
}

export function useWords() {
  const { scope, state } = useAuth()
  const backend = useWordsBackend()
  const queryClient = useQueryClient()

  // A guest's dictionary lives in localStorage; another tab changing it fires
  // a `storage` event here, so this tab re-reads instead of overwriting it
  // with a stale copy on the next edit.
  useEffect(() => {
    if (state.status !== 'guest') return
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === GUEST_WORDS_KEY) {
        void queryClient.invalidateQueries({ queryKey: ['words', 'guest'] })
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [state.status, queryClient])

  return useQuery({
    queryKey: ['words', scope],
    queryFn: () => (backend ? backend.list() : Promise.resolve<Word[]>([])),
    enabled: state.status === 'authenticated' || state.status === 'guest',
    staleTime: 30_000,
  })
}

export function useWordMutations() {
  const { scope } = useAuth()
  const backend = useWordsBackend()
  const queryClient = useQueryClient()
  const key = ['words', scope]

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key })

  const create = useMutation({
    mutationFn: (input: NewWord) => {
      if (!backend) throw new Error('NO_BACKEND')
      return backend.create(input)
    },
    onSuccess: (word) => {
      queryClient.setQueryData<Word[]>(key, (prev) => [word, ...(prev ?? [])])
    },
    onSettled: invalidate,
  })

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<NewWord> }) => {
      if (!backend) throw new Error('NO_BACKEND')
      return backend.update(id, patch)
    },
    onSuccess: (word) => {
      queryClient.setQueryData<Word[]>(key, (prev) =>
        (prev ?? []).map((w) => (w.id === word.id ? word : w)),
      )
    },
    onSettled: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: string) => {
      if (!backend) throw new Error('NO_BACKEND')
      return backend.remove(id)
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Word[]>(key)
      queryClient.setQueryData<Word[]>(key, (prev) => (prev ?? []).filter((w) => w.id !== id))
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: invalidate,
  })

  return { create, update, remove }
}
