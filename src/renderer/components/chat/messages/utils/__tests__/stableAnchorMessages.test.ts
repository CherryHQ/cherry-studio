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
  it('projects only the fields the anchor rail reads', () => {
    const cache = createStableAnchorMessagesCache()

    const [user, assistant] = stableAnchorMessages(
      [
        makeMessage({ id: 'user-1', role: 'user', isContextBoundary: true }),
        makeMessage({ id: 'assistant-1', role: 'assistant', parentId: 'user-1', isActiveBranch: true })
      ],
      cache
    )

    expect(user).toEqual({ id: 'user-1', role: 'user', isActiveBranch: undefined, isContextBoundary: true })
    expect(assistant).toEqual({
      id: 'assistant-1',
      role: 'assistant',
      isActiveBranch: true,
      isContextBoundary: undefined
    })
  })

  // The regression this exists for: a streaming chunk rebuilds the live message
  // and reallocates the array, but changes no topology. The rail's memo only
  // bails if the projection survives that untouched.
  it('reuses the previous array when a rebuilt list keeps the same topology', () => {
    const cache = createStableAnchorMessagesCache()
    const first = stableAnchorMessages(conversation(), cache)

    const streamed = conversation()
    streamed[1] = { ...streamed[1], status: 'pending', updatedAt: '2026-07-02T00:00:01.000Z' }
    const second = stableAnchorMessages(streamed, cache)

    expect(second).toBe(first)
  })

  it('rebuilds when a message is appended', () => {
    const cache = createStableAnchorMessagesCache()
    const first = stableAnchorMessages(conversation(), cache)

    const second = stableAnchorMessages([...conversation(), makeMessage({ id: 'user-2', role: 'user' })], cache)

    expect(second).not.toBe(first)
    expect(second.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'user-2'])
  })

  it('rebuilds when the active branch moves to a sibling', () => {
    const cache = createStableAnchorMessagesCache()
    const branched = [
      ...conversation(),
      makeMessage({ id: 'assistant-1b', role: 'assistant', parentId: 'user-1', isActiveBranch: false })
    ]
    const first = stableAnchorMessages(branched, cache)

    const switched = branched.map((message) =>
      message.id === 'assistant-1'
        ? { ...message, isActiveBranch: false }
        : message.id === 'assistant-1b'
          ? { ...message, isActiveBranch: true }
          : message
    )
    const second = stableAnchorMessages(switched, cache)

    expect(second).not.toBe(first)
    expect(second[1].isActiveBranch).toBe(false)
    expect(second[2].isActiveBranch).toBe(true)
  })

  it('rebuilds when a clear-context boundary appears', () => {
    const cache = createStableAnchorMessagesCache()
    const first = stableAnchorMessages(conversation(), cache)

    const withBoundary = conversation()
    withBoundary[0] = { ...withBoundary[0], isContextBoundary: true }
    const second = stableAnchorMessages(withBoundary, cache)

    expect(second).not.toBe(first)
    expect(second[0].isContextBoundary).toBe(true)
  })

  it('keeps reusing the previous array across repeated unchanged rebuilds', () => {
    const cache = createStableAnchorMessagesCache()
    const first = stableAnchorMessages(conversation(), cache)

    stableAnchorMessages(conversation(), cache)
    const third = stableAnchorMessages(conversation(), cache)

    expect(third).toBe(first)
  })
})
