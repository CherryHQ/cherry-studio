import { describe, expect, it } from 'vitest'

import { computeSearchTextId, computeUnitId, hashContentText, hashEmbeddingText } from '../hashing'

describe('hashing', () => {
  it('hashEmbeddingText is deterministic and content-sensitive', () => {
    expect(hashEmbeddingText('hello')).toBe(hashEmbeddingText('hello'))
    expect(hashEmbeddingText('hello')).not.toBe(hashEmbeddingText('world'))
  })

  it('hashContentText is deterministic and content-sensitive', () => {
    expect(hashContentText('text')).toBe(hashContentText('text'))
    expect(hashContentText('text')).not.toBe(hashContentText('other'))
  })

  it('computeUnitId is stable for the same inputs and varies by offset/index', () => {
    const base = computeUnitId('m1', 'c1', 'chunk', 0, 0, 10)
    expect(computeUnitId('m1', 'c1', 'chunk', 0, 0, 10)).toBe(base)
    expect(computeUnitId('m1', 'c1', 'chunk', 1, 0, 10)).not.toBe(base)
    expect(computeUnitId('m1', 'c1', 'chunk', 0, 0, 11)).not.toBe(base)
    expect(computeUnitId('m2', 'c1', 'chunk', 0, 0, 10)).not.toBe(base)
  })

  it('computeUnitId does not collide across adjacent field boundaries', () => {
    // "1" + "23" must not hash the same as "12" + "3".
    expect(computeUnitId('m', 'c', 'chunk', 1, 23, 30)).not.toBe(computeUnitId('m', 'c', 'chunk', 12, 3, 30))
  })

  it('computeSearchTextId is stable per (target_type, target_id, kind)', () => {
    expect(computeSearchTextId('search_unit', 'u1', 'body')).toBe(computeSearchTextId('search_unit', 'u1', 'body'))
    expect(computeSearchTextId('search_unit', 'u1', 'body')).not.toBe(computeSearchTextId('search_unit', 'u1', 'title'))
  })
})
