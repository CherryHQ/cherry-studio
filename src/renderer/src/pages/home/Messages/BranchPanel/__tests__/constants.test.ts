import { describe, expect, it } from 'vitest'

import { BRANCH_HL_COLOR_KEYS, BRANCH_HL_COLOR_VALUES, pickNextColor } from '../constants'

/**
 * P1-S2b-1: palette + color-cycling helper unit tests. Pure; no DOM.
 *
 * The pickNextColor contract drives every new branch's color assignment in
 * Chat.tsx, so its correctness directly determines whether two concurrent
 * branches get distinct visible colors.
 */
describe('BRANCH_HL_COLOR_VALUES — palette completeness', () => {
  it('defines a value for every palette key', () => {
    for (const key of BRANCH_HL_COLOR_KEYS) {
      expect(BRANCH_HL_COLOR_VALUES[key]).toMatch(/^rgb\([\d\s./]+\)$/)
    }
  })

  it('all six values are distinct strings (defends visual distinguishability — bypassing this would silently regress two branches to the same color)', () => {
    const values = BRANCH_HL_COLOR_KEYS.map((k) => BRANCH_HL_COLOR_VALUES[k])
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('pickNextColor', () => {
  it('returns c1 (palette head) when nothing is used', () => {
    expect(pickNextColor([])).toBe('c1')
  })

  it('returns c2 when only c1 is used', () => {
    expect(pickNextColor(['c1'])).toBe('c2')
  })

  it('skips used keys to find the first available in palette order', () => {
    // c1 used, c2 used → next is c3 even though usedKeys length is 2
    expect(pickNextColor(['c1', 'c2'])).toBe('c3')
    // c1 used (out of order in usedKeys) → still returns c2 (first unused in palette order)
    expect(pickNextColor(['c1'])).toBe('c2')
    // c2 used but c1 free → returns c1 (palette head still unused)
    expect(pickNextColor(['c2'])).toBe('c1')
  })

  it('returns the first unused even when usedKeys is sparse / out of order', () => {
    expect(pickNextColor(['c3', 'c5'])).toBe('c1')
    expect(pickNextColor(['c1', 'c3', 'c5'])).toBe('c2')
  })

  it('cycles back through the palette by count when all six keys are used (fallback — collisions accepted past 6)', () => {
    expect(pickNextColor(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'])).toBe('c1') // 6 % 6 === 0 → c1
    // 7 used (one duplicate, hypothetically) → 7 % 6 === 1 → c2
    expect(pickNextColor(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c1'])).toBe('c2')
  })
})
