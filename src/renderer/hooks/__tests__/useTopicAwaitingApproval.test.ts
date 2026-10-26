import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { useFollowupQueue } from '@renderer/components/composer/useFollowupQueue'
import type { TopicStreamStatus } from '@shared/ai/transport'

const mockEntry = vi.fn<
  () =>
    | {
        status: TopicStreamStatus | undefined
        turnId?: string
        lastCompletedAt?: number
        activeExecutions: []
        awaitingApprovalAnchors: []
      }
    | undefined
>()

let lastSeenCompletion: number | null = null
const setLastSeenCompletion = vi.fn((next: number | null) => {
  lastSeenCompletion = next
})

// Mock at the cache layer rather than at useTopicStreamStatus — intra-module
// vi.mock can't intercept calls between functions in the same source file.
// The main-owned status entry is observed read-only (useSharedCacheValue);
// the window-owned lastSeenCompletion marker keeps the writable hook.
vi.mock('@renderer/data/hooks/useCache', () => ({
  useSharedCache: (key: string) => {
    if (key.startsWith('topic.stream.last_seen_completion.')) {
      return [lastSeenCompletion, setLastSeenCompletion]
    }
    return [mockEntry()]
  },
  useSharedCacheValue: () => mockEntry()
}))

import {
  useTopicAwaitingApproval,
  useTopicDbRefreshOnAwaitingApproval,
  useTopicStreamStatus
} from '../useTopicStreamStatus'

const setEntry = (status: TopicStreamStatus | undefined, lastCompletedAt?: number, turnId = 'turn-1') => {
  mockEntry.mockReturnValue({ status, turnId, lastCompletedAt, activeExecutions: [], awaitingApprovalAnchors: [] })
}

describe('useTopicAwaitingApproval', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    mockEntry.mockReset()
    setLastSeenCompletion.mockClear()
    lastSeenCompletion = null
  })

  it('is true iff the cross-window shared-cache status is awaiting-approval', () => {
    setEntry('awaiting-approval')
    expect(renderHook(() => useTopicAwaitingApproval('t')).result.current).toBe(true)
  })

  it.each<TopicStreamStatus | undefined>(['pending', 'streaming', 'aborted', 'done', 'error', undefined])(
    'is false for status %s (no per-window partsMap scan / SWR dependency)',
    (status) => {
      setEntry(status)
      expect(renderHook(() => useTopicAwaitingApproval('t')).result.current).toBe(false)
    }
  )

  it('treats each stream completion as unread until that specific completion is marked seen', () => {
    setEntry('done', 1000)

    const { result, rerender } = renderHook(() => useTopicStreamStatus('t'))

    expect(result.current.isFulfilled).toBe(true)

    act(() => {
      result.current.markSeen()
    })
    rerender()

    expect(result.current.isFulfilled).toBe(false)

    setEntry('done', 2000)
    rerender()

    expect(result.current.isFulfilled).toBe(true)
  })

  it.each(['done', 'error', 'aborted'] as const)(
    'exposes %s identity without broadening the successful unread receipt',
    (status) => {
      setEntry(status, 1000, 'terminal-identity')
      const { result, rerender } = renderHook(() => useTopicStreamStatus('t'))
      expect(result.current.turnId).toBe('terminal-identity')
      expect(result.current.isFulfilled).toBe(status === 'done')
      act(() => {
        result.current.markSeen()
      })
      rerender()
      expect(result.current.isFulfilled).toBe(false)
      expect(result.current.turnId).toBe('terminal-identity')
    }
  )

  it('does not let badge acknowledgment consume queue admission for the same turn', async () => {
    setEntry('done', 1000, 'acknowledged-turn')
    const badge = renderHook(() => useTopicStreamStatus('t'))
    act(() => {
      badge.result.current.markSeen()
    })
    badge.rerender()
    expect(badge.result.current.isFulfilled).toBe(false)
    const payload = { text: 'B', userMessageParts: [{ type: 'text' as const, text: 'B' }] }
    cacheService.setCasual('followup-queue.t:assistant', [{ id: 'B', draft: { text: 'B', tokens: [] }, payload }])
    const onDrain = vi.fn().mockResolvedValue(true)
    const queue = renderHook(() => {
      const stream = useTopicStreamStatus('t')
      return useFollowupQueue({ ...stream, scopeKey: 't:assistant', autoSendEnabled: true, onDrain })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(onDrain.mock.calls).toEqual([[payload, true]])
    expect(queue.result.current.items).toEqual([])
  })

  it.each<TopicStreamStatus>(['pending', 'streaming'])(
    'refreshes once on %s to awaiting-approval',
    async (liveStatus) => {
      const refresh = vi.fn(async () => {})
      setEntry(liveStatus)
      const { rerender } = renderHook(() => useTopicDbRefreshOnAwaitingApproval('t', refresh))

      setEntry('awaiting-approval')
      await act(async () => {
        rerender()
        await Promise.resolve()
      })
      expect(refresh).toHaveBeenCalledTimes(1)

      await act(async () => {
        rerender()
        await Promise.resolve()
      })
      expect(refresh).toHaveBeenCalledTimes(1)
    }
  )

  it.each<TopicStreamStatus>(['done', 'error', 'aborted'])(
    'does not refresh on streaming to %s',
    async (terminalStatus) => {
      const refresh = vi.fn(async () => {})
      setEntry('streaming')
      const { rerender } = renderHook(() => useTopicDbRefreshOnAwaitingApproval('t', refresh))

      setEntry(terminalStatus)
      await act(async () => {
        rerender()
        await Promise.resolve()
      })

      expect(refresh).not.toHaveBeenCalled()
    }
  )

  it('does not carry a live edge across topic identities', async () => {
    const refresh = vi.fn(async () => {})
    setEntry('streaming')
    const { rerender } = renderHook(
      ({ topicId }: { topicId: string }) => useTopicDbRefreshOnAwaitingApproval(topicId, refresh),
      { initialProps: { topicId: 'topic-1' } }
    )

    setEntry('awaiting-approval')
    await act(async () => {
      rerender({ topicId: 'topic-2' })
      await Promise.resolve()
    })

    expect(refresh).not.toHaveBeenCalled()
  })
})
