import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createDictionary, listDictionaries } from '@/api/dictionaries'
import { bulkCreateWords } from '@/api/words'
import type { NewWord } from '@/types/domain'

/** Imports pre-cutover guest words into the user's default dictionary.
 * Lives in hooks/ because components reach the API through a hook, never
 * through api/ directly (docs/architecture/v2-plan.md §G). */
export function useImportLegacyWords() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (words: NewWord[]) => {
      const { items } = await listDictionaries()
      const target =
        items.find((d) => d.is_default) ?? (await createDictionary({ name: 'Imported' }))
      await bulkCreateWords(
        target.id,
        words.map((w) => ({
          word: w.word,
          definition: w.definition,
          part_of_speech: w.partOfSpeech,
          example: w.example ?? null,
        })),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['words'] })
      await queryClient.invalidateQueries({ queryKey: ['dictionaries'] })
    },
  })
}
