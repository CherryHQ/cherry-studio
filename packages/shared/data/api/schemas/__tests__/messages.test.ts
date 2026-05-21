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
        limit: '20'
      })
    ).toEqual({
      q: 'plan',
      topicId: 'topic-1',
      matchMode: 'substring',
      limit: 20
    })
  })
})
