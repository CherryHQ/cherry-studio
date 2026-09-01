import { describe, expect, it } from 'vitest'

import { parseChatRouteSearch } from '../routeSearch'

describe('parseChatRouteSearch', () => {
  it('parses the sidebar assistantId for pinned entity entries', () => {
    expect(parseChatRouteSearch({ assistantId: 'assistant-1' })).toEqual({
      assistantId: 'assistant-1',
      topicId: undefined,
      view: undefined
    })
  })

  it('keeps assistantId alongside an explicit topic', () => {
    expect(parseChatRouteSearch({ assistantId: 'assistant-1', topicId: 'topic-1' })).toEqual({
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      view: undefined
    })
  })

  it('parses topic and message view', () => {
    expect(parseChatRouteSearch({ topicId: 'topic-1', view: 'message' })).toEqual({
      assistantId: undefined,
      topicId: 'topic-1',
      view: 'message'
    })
  })

  it('drops non-string assistantId values and unknown views', () => {
    expect(parseChatRouteSearch({ assistantId: 7, view: 'other' })).toEqual({
      assistantId: undefined,
      topicId: undefined,
      view: undefined
    })
  })
})
