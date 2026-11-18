import { describe, expect, it } from 'vitest'

import { DEFAULT_WEB_SEARCH_CUTOFF_LIMIT, normalizeWebSearchCutoffLimit } from '../webSearch'

describe('web-search cutoff input', () => {
  it.each([0.1, 1, 2500, Number.MAX_VALUE])('preserves the finite positive limit %s', (limit) => {
    expect(normalizeWebSearchCutoffLimit(limit)).toBe(limit)
  })

  it.each([undefined, null, false, true, '123', {}, [], 0, -1, Number.NaN, Infinity, -Infinity])(
    'uses the default without coercing invalid input: %j',
    (input) => {
      expect(normalizeWebSearchCutoffLimit(input)).toBe(DEFAULT_WEB_SEARCH_CUTOFF_LIMIT)
    }
  )
})
