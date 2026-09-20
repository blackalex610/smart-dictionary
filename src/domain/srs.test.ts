import { describe, expect, it } from 'vitest'
import fixtures from './srs-fixtures.json'
import { GOOD, previewNextState, formatIntervalPreview, type ReviewState } from './srs'

const WORD_ID = 'word-1'
const NOW = new Date('2026-09-15T10:00:00Z')

interface Fixture {
  description: string
  input: { state: ReviewState['state']; step: number; ease: string; interval: number }
  rating: 1 | 2 | 3 | 4
  expectState?: ReviewState['state']
  expectStep?: number
  expectInterval?: number
  expectEase?: string
  expectDueMinutes?: number
  expectDueDays?: number
}

describe('previewNextState — shared cross-language fixture', () => {
  for (const fixture of fixtures as Fixture[]) {
    it(fixture.description, () => {
      const state: ReviewState = {
        wordId: WORD_ID,
        state: fixture.input.state,
        step: fixture.input.step,
        ease: Number(fixture.input.ease),
        interval: fixture.input.interval,
      }
      const { state: next, dueAt } = previewNextState(state, fixture.rating, NOW)

      if (fixture.expectState) expect(next.state).toBe(fixture.expectState)
      if (fixture.expectStep !== undefined) expect(next.step).toBe(fixture.expectStep)
      if (fixture.expectInterval !== undefined) expect(next.interval).toBe(fixture.expectInterval)
      if (fixture.expectEase !== undefined)
        expect(next.ease).toBeCloseTo(Number(fixture.expectEase), 2)
      if (fixture.expectDueMinutes !== undefined) {
        expect(dueAt.getTime()).toBe(NOW.getTime() + fixture.expectDueMinutes * 60_000)
      }
      if (fixture.expectDueDays !== undefined) {
        expect(dueAt.getTime()).toBe(NOW.getTime() + fixture.expectDueDays * 86_400_000)
      }
    })
  }
})

describe('previewNextState — fuzz', () => {
  it('is deterministic for the same word id', () => {
    const state: ReviewState = {
      wordId: WORD_ID,
      state: 'review',
      step: 0,
      ease: 2.5,
      interval: 10,
    }
    const first = previewNextState(state, GOOD, NOW)
    const second = previewNextState(state, GOOD, NOW)
    expect(first.state.interval).toBe(second.state.interval)
  })

  it('keeps the fuzzed interval within +/-5% of the unfuzzed value', () => {
    const state: ReviewState = {
      wordId: WORD_ID,
      state: 'review',
      step: 0,
      ease: 2.5,
      interval: 10,
    }
    const { state: next } = previewNextState(state, GOOD, NOW)
    // unfuzzed: round(10 * 2.5) == 25
    expect(next.interval).toBeGreaterThanOrEqual(24)
    expect(next.interval).toBeLessThanOrEqual(27)
  })
})

describe('formatIntervalPreview', () => {
  it('formats sub-day intervals in minutes or hours', () => {
    expect(formatIntervalPreview(new Date(NOW.getTime() + 10 * 60_000), NOW)).toBe('10m')
    expect(formatIntervalPreview(new Date(NOW.getTime() + 90 * 60_000), NOW)).toBe('2h')
  })

  it('formats multi-day intervals in days', () => {
    expect(formatIntervalPreview(new Date(NOW.getTime() + 5 * 86_400_000), NOW)).toBe('5d')
  })

  it('formats month-scale intervals in months', () => {
    expect(formatIntervalPreview(new Date(NOW.getTime() + 60 * 86_400_000), NOW)).toBe('2mo')
  })
})
