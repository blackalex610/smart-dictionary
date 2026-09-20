/** Mirrors backend/app/services/srs.py's state/ease transitions exactly.
 * Fuzz is NOT shared cross-language -- this is a preview shown before the
 * user rates; the server's write on submit is the source of truth. */

export const AGAIN = 1
export const HARD = 2
export const GOOD = 3
export const EASY = 4

export type Rating = typeof AGAIN | typeof HARD | typeof GOOD | typeof EASY

export interface ReviewState {
  wordId: string
  state: 'new' | 'learning' | 'relearning' | 'review'
  step: number
  ease: number
  interval: number
}

const LEARNING_STEPS_MIN = [1, 10]
const GRADUATING_INTERVAL_DAYS = 1
const EASY_INTERVAL_DAYS = 4
const MIN_EASE = 1.3
const EASE_FLOOR_STEP = 0.2
const DAY_MS = 86_400_000
const MINUTE_MS = 60_000

function fuzz(wordId: string): number {
  let hash = 0
  for (let i = 0; i < wordId.length; i++) {
    hash = (hash * 31 + wordId.charCodeAt(i)) >>> 0
  }
  return 0.95 + (hash / 0xffffffff) * 0.1
}

export function previewNextState(
  state: ReviewState,
  rating: Rating,
  now: Date,
): { state: ReviewState; dueAt: Date } {
  if (state.state !== 'review') {
    if (rating === AGAIN) {
      return {
        state: { ...state, state: 'learning', step: 0 },
        dueAt: new Date(now.getTime() + LEARNING_STEPS_MIN[0] * MINUTE_MS),
      }
    }
    if (rating === EASY) {
      return {
        state: { ...state, state: 'review', step: 0, interval: EASY_INTERVAL_DAYS },
        dueAt: new Date(now.getTime() + EASY_INTERVAL_DAYS * DAY_MS),
      }
    }
    const nextStep = state.step + 1
    if (nextStep >= LEARNING_STEPS_MIN.length) {
      return {
        state: { ...state, state: 'review', step: 0, interval: GRADUATING_INTERVAL_DAYS },
        dueAt: new Date(now.getTime() + GRADUATING_INTERVAL_DAYS * DAY_MS),
      }
    }
    return {
      state: { ...state, state: 'learning', step: nextStep },
      dueAt: new Date(now.getTime() + LEARNING_STEPS_MIN[nextStep] * MINUTE_MS),
    }
  }

  if (rating === AGAIN) {
    const ease = Math.max(MIN_EASE, state.ease - EASE_FLOOR_STEP)
    return {
      state: { ...state, state: 'relearning', step: 0, ease, interval: 1 },
      dueAt: new Date(now.getTime() + DAY_MS),
    }
  }

  const easeDelta = { [HARD]: -0.15, [GOOD]: 0, [EASY]: 0.1 }[rating]
  const ease = Math.max(MIN_EASE, state.ease + easeDelta)
  const multiplier = { [HARD]: 1.2, [GOOD]: ease, [EASY]: ease * 1.3 }[rating]
  const interval = Math.max(1, Math.round(state.interval * multiplier * fuzz(state.wordId)))
  return {
    state: { ...state, state: 'review', step: 0, ease, interval },
    dueAt: new Date(now.getTime() + interval * DAY_MS),
  }
}

export function formatIntervalPreview(dueAt: Date, now: Date): string {
  const totalMinutes = Math.round((dueAt.getTime() - now.getTime()) / MINUTE_MS)
  if (totalMinutes < 60) return `${totalMinutes}m`

  const totalDays = Math.round((dueAt.getTime() - now.getTime()) / DAY_MS)
  if (totalDays < 1) return `${Math.round(totalMinutes / 60)}h`
  if (totalDays < 30) return `${totalDays}d`
  if (totalDays < 365) return `${Math.round(totalDays / 30)}mo`
  return `${Math.round(totalDays / 365)}y`
}
