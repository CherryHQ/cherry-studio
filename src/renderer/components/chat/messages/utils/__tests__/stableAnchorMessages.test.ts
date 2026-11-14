import { describe, expect, it } from 'vitest'

import type { MessageListItem } from '../../types'
import { createStableAnchorMessagesCache, stableAnchorMessages } from '../stableAnchorMessages'

function makeMessage(overrides: Partial<MessageListItem> & Pick<MessageListItem, 'id' | 'role'>): MessageListItem {
  return {
    topicId: 'topic-1',
    parentId: null,
    createdAt: '2026-07-02T00:00:00.000Z',
    status: 'success',
    ...overrides
  }
}

const conversation = (): MessageListItem[] => [
  makeMessage({ id: 'user-1', role: 'user' }),
  makeMessage({ id: 'assistant-1', role: 'assistant', parentId: 'user-1', isActiveBranch: true })
]

describe('stableAnchorMessages', () => {
  // The regression this exists for: a streaming chunk rebuilds the live message
  // and reallocates the array, but changes no topology. The rail's memo only
  // bails if the projection survives that untouched.

  it('rebuilds when a message is appended', () => {
    const cache = createStableAnchorMessagesCache()

    const second = stableAnchorMessages([...conversation(), makeMessage({ id: 'user-2', role: 'user' })], cache)

    expect(second.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'user-2'])
  })

  it('rebuilds when the active branch moves to a sibling', () => {
    const cache = createStableAnchorMessagesCache()
    const branched = [
      ...conversation(),
      makeMessage({ id: 'assistant-1b', role: 'assistant', parentId: 'user-1', isActiveBranch: false })
    ]

    const switched = branched.map((message) =>
      message.id === 'assistant-1'
        ? { ...message, isActiveBranch: false }
        : message.id === 'assistant-1b'
          ? { ...message, isActiveBranch: true }
          : message
    )
    const second = stableAnchorMessages(switched, cache)

    expect(second[1].isActiveBranch).toBe(false)
    expect(second[2].isActiveBranch).toBe(true)
  })

  it('rebuilds when a clear-context boundary appears', () => {
    const cache = createStableAnchorMessagesCache()

    const withBoundary = conversation()
    withBoundary[0] = { ...withBoundary[0], isContextBoundary: true }
    const second = stableAnchorMessages(withBoundary, cache)

    expect(second[0].isContextBoundary).toBe(true)
  })
})
