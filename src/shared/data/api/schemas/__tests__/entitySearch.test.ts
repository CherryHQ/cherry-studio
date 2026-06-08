import { describe, expect, expectTypeOf, it } from 'vitest'

import type { EntitySearchItem } from '../search'
import { ENTITY_SEARCH_MAX_LIMIT_PER_TYPE, EntitySearchQuerySchema } from '../search'

describe('EntitySearchQuerySchema', () => {
  it('trims q without applying a default limit', () => {
    expect(EntitySearchQuerySchema.parse({ q: '  assistant  ' })).toEqual({
      q: 'assistant'
    })
  })

  it('accepts type filters and explicit positive limitPerType', () => {
    expect(
      EntitySearchQuerySchema.parse({
        q: 'agent',
        types: ['agent', 'session'],
        updatedAtFrom: '2026-05-01T00:00:00.000Z',
        limitPerType: ENTITY_SEARCH_MAX_LIMIT_PER_TYPE
      })
    ).toEqual({
      q: 'agent',
      types: ['agent', 'session'],
      updatedAtFrom: '2026-05-01T00:00:00.000Z',
      limitPerType: ENTITY_SEARCH_MAX_LIMIT_PER_TYPE
    })
  })

  it('rejects blank q, invalid updatedAtFrom, out-of-range limits, and message flags', () => {
    expect(() => EntitySearchQuerySchema.parse({ q: '   ' })).toThrow()
    expect(() => EntitySearchQuerySchema.parse({ q: 'agent', updatedAtFrom: 'today' })).toThrow()
    expect(() => EntitySearchQuerySchema.parse({ q: 'agent', limitPerType: 0 })).toThrow()
    expect(() =>
      EntitySearchQuerySchema.parse({ q: 'agent', limitPerType: ENTITY_SEARCH_MAX_LIMIT_PER_TYPE + 1 })
    ).toThrow()
    expect(() => EntitySearchQuerySchema.parse({ q: 'agent', includeMessages: true })).toThrow()
  })

  it('narrows target by result type at compile time', () => {
    const assertNarrowing = (item: EntitySearchItem) => {
      if (item.type === 'assistant') {
        expectTypeOf(item.target).toEqualTypeOf<{ assistantId: string }>()
      }
      if (item.type === 'topic') {
        expectTypeOf(item.target).toEqualTypeOf<{ topicId: string; assistantId?: string }>()
      }
      if (item.type === 'session') {
        expectTypeOf(item.target).toEqualTypeOf<{ sessionId: string; agentId: string | null }>()
      }
    }

    expect(assertNarrowing).toBeTypeOf('function')
  })
})
