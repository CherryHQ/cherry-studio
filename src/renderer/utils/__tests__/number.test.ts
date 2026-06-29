import { describe, expect, it } from 'vitest'

import { formatCompactNumber } from '../number'

describe('formatCompactNumber', () => {
  it('formats small values without a suffix', () => {
    expect(formatCompactNumber(999)).toBe('999')
    expect(formatCompactNumber(1.4)).toBe('1')
  })

  it('formats large values with compact suffixes', () => {
    expect(formatCompactNumber(1200)).toBe('1.2K')
    expect(formatCompactNumber(12_000)).toBe('12K')
    expect(formatCompactNumber(1_500_000)).toBe('1.5M')
    expect(formatCompactNumber(2_000_000_000)).toBe('2B')
  })

  it('handles invalid values defensively', () => {
    expect(formatCompactNumber(Number.NaN)).toBe('0')
  })
})
