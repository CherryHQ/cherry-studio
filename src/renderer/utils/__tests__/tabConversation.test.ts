import { describe, expect, it } from 'vitest'

import { getConversationStatus } from '../conversationStatus'
import { getTabConversation } from '../tabConversation'

describe('conversation tabs', () => {
  it('resolves only explicit conversation routes, never URL-like titles or other pages', () => {
    expect(getTabConversation({ type: 'route', url: '/app/chat?topicId=topic-1' })).toEqual({
      conversationType: 'assistant',
      conversationId: 'topic-1'
    })
    expect(getTabConversation({ type: 'route', url: '/app/agents?sessionId=session-1' })).toEqual({
      conversationType: 'agent',
      conversationId: 'session-1'
    })
    expect(getTabConversation({ type: 'route', url: '/app/chat' })).toBeUndefined()
    expect(getTabConversation({ type: 'route', url: '/app/settings?topicId=topic-1' })).toBeUndefined()
    expect(getTabConversation({ type: 'webview', url: 'https://example.com/app/chat?topicId=topic-1' })).toBeUndefined()
  })
  it('keeps attention above activity and errors, and only hides completion on the active tab', () => {
    const flags = { isAwaitingApproval: true, isPending: true, isErrored: true, isFulfilled: true, isActive: true }
    expect(getConversationStatus(flags)).toBe('approval')
    expect(getConversationStatus({ ...flags, isAwaitingApproval: false })).toBe('pending')
    expect(getConversationStatus({ ...flags, isAwaitingApproval: false, isPending: false })).toBe('error')
    expect(
      getConversationStatus({ ...flags, isAwaitingApproval: false, isPending: false, isErrored: false })
    ).toBeNull()
    expect(
      getConversationStatus({
        ...flags,
        isAwaitingApproval: false,
        isPending: false,
        isErrored: false,
        isActive: false
      })
    ).toBe('done')
  })
})
