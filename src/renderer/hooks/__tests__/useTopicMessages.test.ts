import { MockUseDataApiUtils, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Message } from '@shared/data/types/message'

import { useTopicMessages } from '../useTopicMessages'

function createAssistantMessage(id: string, modelId: string, createdAt: string, siblingsGroupId = 1): Message {
  return {
    id,
    topicId: 'topic-1',
    parentId: 'user-1',
    role: 'assistant',
    data: { parts: [] },
    searchableText: '',
    status: 'success',
    siblingsGroupId,
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

  it('uses one group classification for multi-model display and single-model navigation', () => {
    const firstModelReply = createAssistantMessage('reply-a-1', 'provider-a::model-a', '2026-01-01T00:00:01.000Z')
    const otherModelReply = createAssistantMessage('reply-b-1', 'provider-b::model-b', '2026-01-01T00:00:02.000Z')
    const secondModelReply = createAssistantMessage('reply-a-2', 'provider-a::model-a', '2026-01-01T00:00:03.000Z')
    const activeRegenerate = createAssistantMessage('reply-c-1', 'provider-c::model-c', '2026-01-01T00:00:04.000Z', 2)
    const offPathRegenerate = createAssistantMessage('reply-c-2', 'provider-c::model-c', '2026-01-01T00:00:05.000Z', 2)
    mockUseInfiniteQuery.mockReturnValue({
      pages: [
        {
          items: [
            { message: firstModelReply, siblingsGroup: [otherModelReply, secondModelReply] },
            { message: activeRegenerate, siblingsGroup: [offPathRegenerate] }
          ],
          nextCursor: undefined,
          activeNodeId: 'reply-c-1'
        }
      ],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate: vi.fn().mockResolvedValue(undefined)
    } as never)

    const { result } = renderHook(() => useTopicMessages('topic-1'))

    expect(result.current.uiMessages.map((message) => message.id)).toEqual([
      'reply-a-1',
      'reply-b-1',
      'reply-a-2',
      'reply-c-1'
    ])
    expect(Object.keys(result.current.siblingsMap).sort()).toEqual(['reply-c-1', 'reply-c-2'])
    expect(result.current.siblingsMap['reply-c-1'].map((message) => message.id)).toEqual(['reply-c-1', 'reply-c-2'])
  })
})
