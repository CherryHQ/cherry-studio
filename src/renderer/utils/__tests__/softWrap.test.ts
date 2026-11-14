import { describe, expect, it } from 'vitest'

import { hasUnwrappableLine, SOFT_WRAP_MAX_LINE_LENGTH } from '../softWrap'

describe('hasUnwrappableLine', () => {
  it('flags a single line just over the limit, wherever it sits', () => {
    const long = 'x'.repeat(SOFT_WRAP_MAX_LINE_LENGTH + 1)
    expect(hasUnwrappableLine(long)).toBe(true)
    expect(hasUnwrappableLine(`a\nb\n${long}`)).toBe(true)
    expect(hasUnwrappableLine(`${long}\nshort`)).toBe(true)
  })

  it('allows large files whose lines all fit, including a line exactly at the limit', () => {
    const line = 'x'.repeat(SOFT_WRAP_MAX_LINE_LENGTH)
    expect(hasUnwrappableLine(`${line}\n${line}\n${line}`)).toBe(false)
    expect(hasUnwrappableLine('short\n'.repeat(100_000))).toBe(false)
  })
})
