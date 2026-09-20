/** Reads the localStorage key the now-deleted src/lib/guest/guestStore.ts
 * used, so a pre-cutover guest's words survive the guest-mode removal
 * (Task 21) as a one-time import instead of silently disappearing. */

import { readJson, removeKey } from '@/lib/storage'
import { isPartOfSpeech, type NewWord } from '@/types/domain'

const KEY = 'dictionary_guest'
const IMPORT_TARGET_FOLDER = 'Imported'

interface LegacyWord {
  word?: string
  definition?: string
  partOfSpeech?: string
  example?: string | null
}

export function readLegacyGuestWords(): NewWord[] {
  const raw = readJson<LegacyWord[]>(KEY, [])
  if (!Array.isArray(raw)) return []

  return raw
    .filter((entry): entry is Required<Pick<LegacyWord, 'word' | 'definition'>> & LegacyWord =>
      Boolean(entry.word && entry.definition),
    )
    .map((entry) => ({
      word: entry.word,
      definition: entry.definition,
      partOfSpeech: isPartOfSpeech(entry.partOfSpeech) ? entry.partOfSpeech : 'noun',
      example: entry.example ?? null,
      folder: IMPORT_TARGET_FOLDER,
    }))
}

export function clearLegacyGuestWords(): void {
  removeKey(KEY)
}
