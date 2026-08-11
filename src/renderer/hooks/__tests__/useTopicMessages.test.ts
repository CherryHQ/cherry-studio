import type { Message } from '@shared/data/types/message'
import { mockUseDataChange, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { projectBranchMessagesToUI, useTopicMessages } from '../useTopicMessages'

function createAssistantMessage(id: string, modelId: string, createdAt: string): Message {
  return {
    id,
    topicId: 'topic-1',
    parentId: 'user-1',
    role: 'assistant',
    data: { parts: [] },
    searchableText: '',
    status: 'success',
    siblingsGroupId: 1,
    modelId,
    createdAt,
    updatedAt: createdAt
  }
}

describe('useTopicMessages', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    mockUseInfiniteQuery.mockClear()
    mockUseDataChange.mockClear()
  })

  describe('page size by navigation mode', () => {
    it('requests 50-item pages when navigation mode is the default (none)', () => {
      renderHook(() => useTopicMessages('topic-1'))

      expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
        '/topics/:topicId/messages',
        expect.objectContaining({ limit: 50 })
      )
    })

    it('requests 150-item pages when navigation mode is anchor (fills the tick rail)', () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.message.navigation_mode', 'anchor')

      renderHook(() => useTopicMessages('topic-1'))

      expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
        '/topics/:topicId/messages',
        expect.objectContaining({ limit: 150 })
      )
    })

    it('keeps the 50-item baseline for the buttons navigation mode', () => {
      MockUsePreferenceUtils.setPreferenceValue('chat.message.navigation_mode', 'buttons')

      renderHook(() => useTopicMessages('topic-1'))

      expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
        '/topics/:topicId/messages',
        expect.objectContaining({ limit: 50 })
      )
    })
  })

  it('subscribes the branch history to cross-window message changes', () => {
    renderHook(() => useTopicMessages('topic-1'))

    expect(mockUseDataChange).toHaveBeenCalledWith('/topics/:topicId/messages', expect.any(Function), {
      routeParams: { topicId: 'topic-1' }
    })
  })

  it('refetches when the route-scoped subscription delivers an effect', () => {
    renderHook(() => useTopicMessages('topic-1'))
    const mutate = mockUseInfiniteQuery.mock.results.at(-1)?.value.mutate
    const listener = mockUseDataChange.mock.calls.at(-1)?.[1]

    listener?.([
      {
        endpoint: '/topics/:topicId/messages',
        kind: 'projection',
        routeParams: { topicId: 'topic-1' }
      }
    ])
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('keeps repeated replies from the same model visible in a multi-model group', () => {
    const firstModelReply = createAssistantMessage('reply-a-1', 'provider-a::model-a', '2026-01-01T00:00:01.000Z')
    const otherModelReply = createAssistantMessage('reply-b-1', 'provider-b::model-b', '2026-01-01T00:00:02.000Z')
    const secondModelReply = createAssistantMessage('reply-a-2', 'provider-a::model-a', '2026-01-01T00:00:03.000Z')

    const messages = projectBranchMessagesToUI([
      {
        message: firstModelReply,
        siblingsGroup: [otherModelReply, secondModelReply]
      }
    ])

    expect(messages.map((message) => message.id)).toEqual(['reply-a-1', 'reply-b-1', 'reply-a-2'])
  })

  it('keeps a single-model regenerate group on its active reply', () => {
    const activeReply = createAssistantMessage('reply-a-1', 'provider-a::model-a', '2026-01-01T00:00:01.000Z')
    const regeneratedReply = createAssistantMessage('reply-a-2', 'provider-a::model-a', '2026-01-01T00:00:02.000Z')

    const messages = projectBranchMessagesToUI([
      {
        message: activeReply,
        siblingsGroup: [regeneratedReply]
      }
    ])

    expect(messages.map((message) => message.id)).toEqual(['reply-a-1'])
  })
})
