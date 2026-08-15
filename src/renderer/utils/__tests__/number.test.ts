import i18n from '@renderer/i18n/resolver'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { formatCompactNumber } from '../number'

// The preference mock defaults to zh-CN; switch explicitly for English assertions.
let previousLanguage: string

beforeAll(async () => {
  // Capture here, not at import time: i18n is initialized by the global setup hook.
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage)
})

describe('formatCompactNumber', () => {
  it('formats small values without a suffix', () => {
    expect(formatCompactNumber(0)).toBe('0')
    expect(formatCompactNumber(999)).toBe('999')
    expect(formatCompactNumber(999.6)).toBe('999.6')
    expect(formatCompactNumber(1.4)).toBe('1.4')
  })

  it('formats large values with compact suffixes', () => {
    expect(formatCompactNumber(1200)).toBe('1.2K')
    expect(formatCompactNumber(12_000)).toBe('12K')
    expect(formatCompactNumber(1_500_000)).toBe('1.5M')
    expect(formatCompactNumber(2_000_000_000)).toBe('2B')
  })

  it('rounds before picking the unit at unit boundaries', () => {
    expect(formatCompactNumber(999_999)).toBe('1M')
    expect(formatCompactNumber(999_999_999)).toBe('1B')
  })

  it('formats negative values', () => {
    expect(formatCompactNumber(-1200)).toBe('-1.2K')
    expect(formatCompactNumber(-999_999)).toBe('-1M')
  })

  it('follows the active language', async () => {
    await i18n.changeLanguage('zh-CN')
    expect(formatCompactNumber(12_000)).toBe('1.2万')
    await i18n.changeLanguage('en-US')
  })

  it('handles invalid values defensively', () => {
    expect(formatCompactNumber(Number.NaN)).toBe('0')
  })
})
