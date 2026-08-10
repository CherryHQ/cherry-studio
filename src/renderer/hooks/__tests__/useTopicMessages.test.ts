import { mockUseDataChange, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useTopicMessages } from '../useTopicMessages'

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
})
