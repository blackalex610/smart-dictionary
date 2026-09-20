import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { httpWords } from '@/lib/http/words'
import type { NewWord, Word, WordsBackend } from '@/types/domain'

export function useWordsBackend(): WordsBackend | null {
  const { state } = useAuth()
  if (state.status === 'authenticated') return httpWords
  return null
}

export function useWords() {
  const { scope, state } = useAuth()
  const backend = useWordsBackend()

  return useQuery({
    queryKey: ['words', scope],
    queryFn: () => (backend ? backend.list() : Promise.resolve<Word[]>([])),
    enabled: state.status === 'authenticated',
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
