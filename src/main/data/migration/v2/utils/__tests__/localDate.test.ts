import { describe, expect, it } from 'vitest'

import { isValidLocalDate } from '../localDate'

describe('isValidLocalDate', () => {
  it.each(['2026-07-23', '2024-02-29'])('accepts a real YYYY-MM-DD local date: %s', (value) => {
    expect(isValidLocalDate(value)).toBe(true)
  })

  it.each([undefined, 20260723, '0099-01-01', '2026-02-29', '2026-02-31', '2026-2-03', '2026-13-01'])(
    'rejects an invalid local date: %s',
    (value) => {
      expect(isValidLocalDate(value)).toBe(false)
    }
  )
})
