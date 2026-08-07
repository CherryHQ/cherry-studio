import { mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTopicMessages } from '../useTopicMessages'

describe('useTopicMessages', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    mockUseInfiniteQuery.mockClear()
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

  describe('followingBranchCount', () => {
    it('reads the topic-level count off pages[0]', () => {
      mockUseInfiniteQuery.mockReturnValue({
        pages: [{ items: [], activeNodeId: 'node-1', followingBranchCount: 3 }],
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        hasNext: false,
        loadNext: vi.fn(),
        refresh: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn(),
        mutate: vi.fn().mockResolvedValue(undefined)
      } as any)

      const { result } = renderHook(() => useTopicMessages('topic-1'))

      expect(result.current.followingBranchCount).toBe(3)
    })

    it('defaults to 0 when no page has loaded yet', () => {
      mockUseInfiniteQuery.mockReturnValue({
        pages: [],
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        hasNext: false,
        loadNext: vi.fn(),
        refresh: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn(),
        mutate: vi.fn().mockResolvedValue(undefined)
      } as any)

      const { result } = renderHook(() => useTopicMessages('topic-1'))

      expect(result.current.followingBranchCount).toBe(0)
    })
  })
})
