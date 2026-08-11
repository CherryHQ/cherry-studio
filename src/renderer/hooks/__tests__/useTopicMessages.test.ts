import { MockUseDataApiUtils, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTopicMessages } from '../useTopicMessages'

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
})
