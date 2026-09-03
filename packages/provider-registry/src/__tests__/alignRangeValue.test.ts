import { describe, expect, it } from 'vitest'

import { alignRangeValue } from '../utils/alignRangeValue'

describe('alignRangeValue', () => {
  it('snaps a half-image count onto the integer grid instead of keeping 2.5', () => {
    expect(alignRangeValue(2.5, 1, 4, 1)).toBe(3)
    expect(alignRangeValue(2.4, 1, 4, 1)).toBe(2)
    expect(alignRangeValue(1, 1, 4, 1)).toBe(1)
    expect(alignRangeValue(4, 1, 4, 1)).toBe(4)
  })

  it('clamps outside the window before snapping', () => {
    expect(alignRangeValue(0, 1, 4, 1)).toBe(1)
    expect(alignRangeValue(9, 1, 4, 1)).toBe(4)
  })

  it('keeps a fractional default that sits on a 0.1 guidance scale grid', () => {
    expect(alignRangeValue(4.5, 1, 20, 0.1)).toBe(4.5)
    expect(alignRangeValue(4.54, 1, 20, 0.1)).toBe(4.5)
    expect(alignRangeValue(4.56, 1, 20, 0.1)).toBe(4.6)
  })

  it('rounds exact decimal half-steps up when IEEE remainder is just below n+0.5', () => {
    expect(alignRangeValue(4.55, 1, 20, 0.1)).toBe(4.6)
    expect(alignRangeValue(0.15, 0, 1, 0.1)).toBe(0.2)
    expect(alignRangeValue(2.05, 1, 4, 0.1)).toBe(2.1)
  })

  it('keeps values below a half-step on the nearer lower grid point', () => {
    expect(alignRangeValue(1.049, 1, 4, 0.1)).toBe(1)
  })

  it('measures steps from min, not from zero', () => {
    expect(alignRangeValue(1.1, 0.5, 2, 0.25)).toBe(1)
    expect(alignRangeValue(1.2, 0.5, 2, 0.25)).toBe(1.25)
  })

  it('does not overshoot max when max is off the step grid', () => {
    expect(alignRangeValue(1, 0, 1, 0.3)).toBe(0.9)
  })
})
