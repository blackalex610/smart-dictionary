import { readJson, writeJson } from '@/lib/storage'
import type { Word } from '@/types/domain'

export const DEFAULT_FOLDER = 'General'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Legacy naming from the vanilla app — kept so old words keep their folder. */
export function getFolderFromDate(timestamp?: number): string {
  const date = new Date(timestamp || Date.now())
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

export function folderOf(word: Word): string {
  return word.folder || getFolderFromDate(word.createdAt)
}

/**
 * All folders that exist: the default one, then the user's own folders in the
 * order they created them, then any folder only referenced by a word.
 */
export function collectFolders(words: Word[], custom: string[]): string[] {
  const ordered: string[] = [DEFAULT_FOLDER]
  const seen = new Set(ordered)

  custom.forEach((folder) => {
    if (!seen.has(folder)) {
      seen.add(folder)
      ordered.push(folder)
    }
  })

  const orphans = new Set<string>()
  words.forEach((word) => {
    const folder = folderOf(word)
    if (!seen.has(folder)) orphans.add(folder)
  })

  return [...ordered, ...Array.from(orphans).sort((a, b) => a.localeCompare(b))]
}

export function countByFolder(words: Word[]): Record<string, number> {
  const counts: Record<string, number> = {}
  words.forEach((w) => {
    const f = folderOf(w)
    counts[f] = (counts[f] ?? 0) + 1
  })
  return counts
}

const customFoldersKey = (scope: string) => `customFolders_${scope}`

export function readCustomFolders(scope: string): string[] {
  const raw = readJson<unknown>(customFoldersKey(scope), [])
  return Array.isArray(raw) ? raw.filter((f): f is string => typeof f === 'string') : []
}

export function writeCustomFolders(scope: string, folders: string[]): void {
  writeJson(customFoldersKey(scope), folders)
}

export function validateFolderName(name: string, existing: string[]): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'empty'
  if (trimmed.length > 50) return 'too-long'
  if (existing.some((f) => f.toLowerCase() === trimmed.toLowerCase())) return 'duplicate'
  return null
}
