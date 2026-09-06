import { describe, expect, it } from 'vitest'

import { parseChatRouteSearch } from '../routeSearch'

describe('parseChatRouteSearch', () => {
  it('parses the sidebar assistantId for pinned entity entries', () => {
    expect(parseChatRouteSearch({ assistantId: 'assistant-1' })).toEqual({
      assistantId: 'assistant-1',
      topicId: undefined
    })
  })

  it('keeps assistantId alongside an explicit topic', () => {
    expect(parseChatRouteSearch({ assistantId: 'assistant-1', topicId: 'topic-1' })).toEqual({
      assistantId: 'assistant-1',
      topicId: 'topic-1'
    })
  })

  it('drops non-string assistantId values', () => {
    expect(parseChatRouteSearch({ assistantId: 7 })).toEqual({
      assistantId: undefined,
      topicId: undefined
    })
  })
})
