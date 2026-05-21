import { describe, expect, it } from 'vitest'

import { GlobalSearchQuerySchema } from '../globalSearch'

describe('GlobalSearchQuerySchema', () => {
  it('trims q without applying a default limit', () => {
    expect(GlobalSearchQuerySchema.parse({ q: '  assistant  ' })).toEqual({
      q: 'assistant'
    })
  })

  it('accepts type filters and explicit positive limitPerType', () => {
    expect(
      GlobalSearchQuerySchema.parse({
        q: 'agent',
        types: ['agent', 'session'],
        updatedAtFrom: '2026-05-01T00:00:00.000Z',
        limitPerType: 500
      })
    ).toEqual({
      q: 'agent',
      types: ['agent', 'session'],
      updatedAtFrom: '2026-05-01T00:00:00.000Z',
      limitPerType: 500
    })
  })

  it('rejects blank q, invalid updatedAtFrom, and non-positive limits', () => {
    expect(() => GlobalSearchQuerySchema.parse({ q: '   ' })).toThrow()
    expect(() => GlobalSearchQuerySchema.parse({ q: 'agent', updatedAtFrom: 'today' })).toThrow()
    expect(() => GlobalSearchQuerySchema.parse({ q: 'agent', limitPerType: 0 })).toThrow()
  })
})
