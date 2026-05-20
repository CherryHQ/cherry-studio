import { describe, expect, it } from 'vitest'

import {
  GLOBAL_SEARCH_DEFAULT_LIMIT_PER_TYPE,
  GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE,
  GlobalSearchQuerySchema
} from '../globalSearch'

describe('GlobalSearchQuerySchema', () => {
  it('trims q and applies default limit', () => {
    expect(GlobalSearchQuerySchema.parse({ q: '  assistant  ' })).toEqual({
      q: 'assistant',
      limitPerType: GLOBAL_SEARCH_DEFAULT_LIMIT_PER_TYPE
    })
  })

  it('accepts type filters and caps limitPerType', () => {
    expect(
      GlobalSearchQuerySchema.parse({
        q: 'agent',
        types: ['agent', 'session'],
        limitPerType: GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE
      })
    ).toEqual({
      q: 'agent',
      types: ['agent', 'session'],
      limitPerType: GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE
    })
  })

  it('rejects blank q and out-of-range limits', () => {
    expect(() => GlobalSearchQuerySchema.parse({ q: '   ' })).toThrow()
    expect(() =>
      GlobalSearchQuerySchema.parse({ q: 'agent', limitPerType: GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE + 1 })
    ).toThrow()
  })
})
