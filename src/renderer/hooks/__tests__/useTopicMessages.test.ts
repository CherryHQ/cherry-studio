import type { Message } from '@shared/data/types/message'
import { MockUseDataApiUtils, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    MockUseDataApiUtils.resetMocks()
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

  it('revalidates when a loaded message read model changes', () => {
    const mutate = vi.fn().mockResolvedValue(undefined)
    const anchorMessage = {
      id: 'anchor-1',
      topicId: 'topic-1',
      parentId: null,
      role: 'assistant',
      data: { parts: [] },
      searchableText: '',
      status: 'success',
      siblingsGroupId: 0,
      modelId: null,
      messageSnapshot: null,
      stats: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    mockUseInfiniteQuery.mockReturnValueOnce({
      pages: [
        {
          items: [
            {
              message: { ...anchorMessage, id: 'recent-anchor' },
              siblingsGroup: []
            }
          ],
          nextCursor: 'older-page',
          activeNodeId: 'recent-anchor'
        },
        {
          items: [
            {
              message: anchorMessage,
              siblingsGroup: []
            }
          ],
          nextCursor: undefined,
          activeNodeId: 'recent-anchor'
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate
    } as never)

    renderHook(() => useTopicMessages('topic-1'))

    act(() => {
      MockUseDataApiUtils.emitDataChange([
        { endpoint: '/topics/:topicId/messages', kind: 'projection', entityIds: ['other-anchor'] }
      ])
    })
    expect(mutate).not.toHaveBeenCalled()

    act(() => {
      MockUseDataApiUtils.emitDataChange([
        { endpoint: '/topics/:topicId/messages', kind: 'projection', entityIds: ['anchor-1'] }
      ])
    })
    expect(mutate).toHaveBeenCalledWith()
  })

  it('revalidates on a same-topic membership change whose entity ids are not loaded yet', () => {
    const mutate = vi.fn().mockResolvedValue(undefined)
    const loadedMessage = {
      id: 'loaded-1',
      topicId: 'topic-1',
      parentId: null,
      role: 'user',
      data: { parts: [] },
      searchableText: '',
      status: 'success',
      siblingsGroupId: 0,
      modelId: null,
      messageSnapshot: null,
      stats: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    mockUseInfiniteQuery.mockReturnValueOnce({
      pages: [
        {
          items: [{ message: loadedMessage, siblingsGroup: [] }],
          nextCursor: undefined,
          activeNodeId: 'loaded-1'
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate
    } as never)

    renderHook(() => useTopicMessages('topic-1'))

    act(() => {
      MockUseDataApiUtils.emitDataChange([
        {
          endpoint: '/topics/:topicId/messages',
          kind: 'projection',
          routeParams: { topicId: 'topic-1' },
          entityIds: ['new-user-1', 'new-placeholder-1']
        }
      ])
    })
    expect(mutate).not.toHaveBeenCalled()

    act(() => {
      MockUseDataApiUtils.emitDataChange([
        {
          endpoint: '/topics/:topicId/messages',
          kind: 'membership',
          routeParams: { topicId: 'topic-1' },
          entityIds: ['new-user-1', 'new-placeholder-1']
        }
      ])
    })
    expect(mutate).toHaveBeenCalledWith()
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
