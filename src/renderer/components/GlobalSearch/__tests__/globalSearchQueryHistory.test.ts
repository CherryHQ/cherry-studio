import { describe, expect, it } from 'vitest'

import { rememberGlobalSearchQuery, sanitizeGlobalSearchQueries } from '../globalSearchQueryHistory'

describe('global search query history', () => {
  // Prevent corrupted persisted UI data from hiding usable history or retaining unbounded/private extra fields.
  it('validates, orders and caps stored queries without mutating the input', () => {
    const stored = [
      null,
      { query: ' ', lastUsedAt: 4 },
      { query: 'bad', lastUsedAt: '5' },
      { query: 'infinite', lastUsedAt: Infinity },
      { query: 'negative', lastUsedAt: -1 },
      { query: ' repeat ', lastUsedAt: 99, snippet: 'must not persist' },
      { query: 'repeat', lastUsedAt: 98 },
      ...Array.from({ length: 25 }, (_, i) => ({ query: `query ${i}`, lastUsedAt: i }))
    ]
    const clean = sanitizeGlobalSearchQueries(stored)
    expect(clean).toHaveLength(20)
    expect(clean[0]).toEqual({ query: 'repeat', lastUsedAt: 99 })
    expect(clean.at(-1)).toEqual({ query: 'query 6', lastUsedAt: 6 })
    expect(stored[5]).toHaveProperty('snippet', 'must not persist')
    expect(sanitizeGlobalSearchQueries({ query: 'not an array' })).toEqual([])
  })

  // Reusing a query must not create duplicates or normalize away meaningful search text.
  it('moves exact trimmed reuse to the front while retaining internal whitespace and case', () => {
    const before = [
      { query: 'hello 世界', lastUsedAt: 1 },
      { query: 'Hello 世界', lastUsedAt: 2 }
    ]
    const saved = rememberGlobalSearchQuery(before, ' hello 世界 ', 3)
    expect(saved).toEqual([
      { query: 'hello 世界', lastUsedAt: 3 },
      { query: 'Hello 世界', lastUsedAt: 2 }
    ])
    expect(rememberGlobalSearchQuery(saved, 'hello  世界', 4)[0].query).toBe('hello  世界')
    expect(rememberGlobalSearchQuery(saved, '  ', 5)).toEqual(saved)
    expect(before[0].lastUsedAt).toBe(1)
  })
})
