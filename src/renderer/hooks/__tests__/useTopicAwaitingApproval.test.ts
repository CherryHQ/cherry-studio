import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { useAgentSessionSlashCommands } from '@renderer/hooks/agent/useAgentSessionSlashCommands'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY } from '@shared/ai/agentSessionSlashCommands'
import type { TopicStreamStatus } from '@shared/ai/transport'
import { topicLastSeenCompletionCacheKey, topicStreamStatusCacheKey } from '@shared/data/cache/cacheKey'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

import {
  useTopicAwaitingApproval,
  useTopicDbRefreshOnAwaitingApproval,
  useTopicStreamStatus
} from '../useTopicStreamStatus'

const setEntry = (status: TopicStreamStatus | undefined, lastCompletedAt?: number, topicId = 't') => {
  act(() => {
    const key = topicStreamStatusCacheKey(topicId)
    if (status === undefined) cacheService.deleteShared(key)
    else cacheService.setShared(key, { status, lastCompletedAt, activeExecutions: [], awaitingApprovalAnchors: [] })
  })
}

afterEach(() => {
  cleanup()
  cacheService.cleanup()
})

describe('useTopicAwaitingApproval', () => {
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
    setEntry('streaming', undefined, 'topic-1')
    const { rerender } = renderHook(
      ({ topicId }: { topicId: string }) => useTopicDbRefreshOnAwaitingApproval(topicId, refresh),
      { initialProps: { topicId: 'topic-1' } }
    )

    setEntry('awaiting-approval', undefined, 'topic-2')
    await act(async () => {
      rerender({ topicId: 'topic-2' })
      await Promise.resolve()
    })

    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('topic and session cache boundaries', () => {
  it('observes an Agent topic after an empty selection without creating placeholder entries', () => {
    const { result, rerender } = renderHook(({ topicId }) => useTopicStreamStatus(topicId), {
      initialProps: { topicId: '' }
    })
    expect(result.current.status).toBeUndefined()
    expect(result.current.isFulfilled).toBe(false)
    act(() => result.current.markSeen())
    expect(cacheService.getStats().summary.shared.totalCount).toBe(0)

    const topicId = buildAgentSessionTopicId('session-1')
    setEntry('streaming', undefined, topicId)
    rerender({ topicId })
    expect(result.current.isPending).toBe(true)
    setEntry('done', 123, topicId)
    expect(result.current.isFulfilled).toBe(true)
    act(() => result.current.markSeen())
    expect(result.current.isFulfilled).toBe(false)
    expect(cacheService.getShared(topicLastSeenCompletionCacheKey(topicId))).toBe(123)

    rerender({ topicId: '' })
    expect(result.current.status).toBeUndefined()
    expect(result.current.isPending).toBe(false)
  })

  it('waits for a real session before observing slash commands', () => {
    const { result, rerender } = renderHook(({ sessionId }) => useAgentSessionSlashCommands(sessionId), {
      initialProps: { sessionId: '' }
    })
    expect(result.current).toBeUndefined()
    expect(cacheService.getStats().summary.shared.totalCount).toBe(0)
    act(() =>
      cacheService.setShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('session-1'), [
        { name: 'deploy', description: 'Deploy', argumentHint: '' }
      ])
    )
    rerender({ sessionId: 'session-1' })
    expect(result.current).toEqual([{ command: '/deploy', description: 'Deploy', builtin: undefined }])
  })
})
