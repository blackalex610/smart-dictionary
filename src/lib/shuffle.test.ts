import { describe, expect, it, vi } from 'vitest'
import { sample, shuffle } from './shuffle'

describe('shuffle', () => {
  it('returns every input item exactly once', () => {
    const input = [1, 2, 3, 4, 5]
    const result = shuffle(input)
    expect(result).toHaveLength(input.length)
    expect([...result].sort()).toEqual(input)
  })

  it('does not mutate the input array', () => {
    const input = [1, 2, 3]
    const copy = [...input]
    shuffle(input)
    expect(input).toEqual(copy)
  })

  it('handles empty and single-element arrays', () => {
    expect(shuffle([])).toEqual([])
    expect(shuffle([1])).toEqual([1])
  })

  it('is not visibly biased toward the identity permutation', () => {
    // Fisher-Yates over 6 items has 720 equally likely permutations; the
    // vanilla `sort(() => Math.random() - 0.5)` this replaced was biased
    // toward leaving early elements in place. Assert we see real movement.
    const input = [0, 1, 2, 3, 4, 5]
    let unchanged = 0
    for (let i = 0; i < 200; i++) {
      if (shuffle(input).every((v, idx) => v === input[idx])) unchanged++
    }
    expect(unchanged).toBeLessThan(5)
  })
})

describe('sample', () => {
  it('returns the requested count of distinct items', () => {
    const result = sample([1, 2, 3, 4, 5], 3)
    expect(result).toHaveLength(3)
    expect(new Set(result).size).toBe(3)
  })

  it('caps at the pool size when count exceeds it', () => {
    expect(sample([1, 2], 10)).toHaveLength(2)
  })

  it('returns an empty array for a non-positive count', () => {
    expect(sample([1, 2, 3], 0)).toEqual([])
    expect(sample([1, 2, 3], -1)).toEqual([])
  })
})

describe('shuffle randomness source', () => {
  it('uses Math.random, so a mocked generator produces a deterministic order', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      // Math.random -> 0 at every step means Fisher-Yates always swaps
      // index i with index 0, producing this exact deterministic order.
      expect(shuffle([1, 2, 3, 4])).toEqual([2, 3, 4, 1])
    } finally {
      spy.mockRestore()
    }
  })
})
