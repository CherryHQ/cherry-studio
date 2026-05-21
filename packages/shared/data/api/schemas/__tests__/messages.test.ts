import { describe, expect, it } from 'vitest'

import { SearchMessagesQuerySchema } from '../messages'

describe('SearchMessagesQuerySchema', () => {
  it('normalizes topic message search queries', () => {
    expect(SearchMessagesQuerySchema.parse({ q: '  deploy  ' })).toEqual({
      q: 'deploy'
    })
  })

  it('accepts topic filter and pagination', () => {
    expect(
      SearchMessagesQuerySchema.parse({
        q: 'plan',
        topicId: 'topic-1',
        matchMode: 'substring',
        limit: '20',
        createdAtFrom: '2026-05-01T00:00:00.000Z'
      })
    ).toEqual({
      q: 'plan',
      topicId: 'topic-1',
      matchMode: 'substring',
      limit: 20,
      createdAtFrom: '2026-05-01T00:00:00.000Z'
    })
  })

  it('rejects invalid createdAtFrom', () => {
    expect(() => SearchMessagesQuerySchema.parse({ q: 'plan', createdAtFrom: 'today' })).toThrow()
  })
})
