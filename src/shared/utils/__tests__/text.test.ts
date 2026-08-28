import { describe, expect, it } from 'vitest'

import { clampSurrogateBoundary } from '../text'

describe('clampSurrogateBoundary', () => {
  it('steps back when the boundary cuts a surrogate pair', () => {
    // "ab😀" => a, b, high, low. Cutting at index 3 lands between the pair halves.
    const text = 'ab😀'
    expect(clampSurrogateBoundary(text, 3)).toBe(2)
  })

  it('leaves a boundary that falls between whole characters alone', () => {
    const text = 'ab😀cd'
    // Index 4 is right after the complete emoji (a,b,high,low|c) — no change.
    expect(clampSurrogateBoundary(text, 4)).toBe(4)
    expect(clampSurrogateBoundary('abcd', 2)).toBe(2)
  })

  it('returns the index unchanged at the string edges', () => {
    expect(clampSurrogateBoundary('😀', 0)).toBe(0)
    expect(clampSurrogateBoundary('😀', 2)).toBe(2)
  })
})
