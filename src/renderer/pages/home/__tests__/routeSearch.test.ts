import { describe, expect, it } from 'vitest'

import { parseChatRouteSearch } from '../routeSearch'

describe('parseChatRouteSearch', () => {
  it('preserves the assistant and settings tab requested by another window', () => {
    expect(parseChatRouteSearch({ editAssistantId: 'assistant-1', editTab: 'tools.mcp' })).toMatchObject({
      editAssistantId: 'assistant-1',
      editTab: 'tools.mcp'
    })
    expect(parseChatRouteSearch({ editAssistantId: 42, editTab: 'tools.mcp' })).not.toHaveProperty('editAssistantId')
  })

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

  it('keeps the topic of a tab restored with the legacy message-only view param', () => {
    expect(parseChatRouteSearch({ topicId: 'topic-1', view: 'message' })).toEqual({
      assistantId: undefined,
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
