/**
 * Tests for useAgentSessionStreamStatuses after migrating to
 * useSharedCacheSelector: the signature string is replaced by an explicit Map
 * comparator (session id, status, isPending), so both its equal branch (raw
 * entry fields change, derived state doesn't → no re-render) and its unequal
 * branch (derived state changes → re-render) must hold.
 */
import { cacheService } from '@data/CacheService'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { TopicStatusSnapshotEntry, TopicStreamStatus } from '@shared/ai/transport'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentSessionStreamStatuses } from '../useAgentSessionStreamStatuses'

// Undo the global mocks — these tests need the real cache wiring.
vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

const SESSION_ID = 'session-stream-test'
const KEY = `topic.stream.statuses.${buildAgentSessionTopicId(SESSION_ID)}` as const

const makeEntry = (status: TopicStreamStatus, lastCompletedAt: number): TopicStatusSnapshotEntry => ({
  status,
  activeExecutions: [],
  awaitingApprovalAnchors: [],
  lastCompletedAt
})

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      cache: {
        broadcastSync: vi.fn(),
        onSync: vi.fn(),
        getAllShared: vi.fn(async () => ({}))
      }
    }
  })

  // The singleton persists across tests — make sure the key starts absent.
  cacheService.deleteShared(KEY)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAgentSessionStreamStatuses', () => {
  it('returns the stable empty map when no session has a status', () => {
    const { result, rerender } = renderHook(() => useAgentSessionStreamStatuses([SESSION_ID]))

    expect(result.current.size).toBe(0)
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('classifies a published status into the session map', () => {
    const { result } = renderHook(() => useAgentSessionStreamStatuses([SESSION_ID]))

    act(() => {
      cacheService.setShared(KEY, makeEntry('streaming', 1))
    })

    expect(result.current.get(SESSION_ID)).toEqual({ isPending: true, status: 'streaming' })
  })

  it('comparator equal branch: raw entry fields change, derived state does not → no re-render', () => {
    act(() => {
      cacheService.setShared(KEY, makeEntry('streaming', 1))
    })

    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount++
      return useAgentSessionStreamStatuses([SESSION_ID])
    })
    const committed = result.current
    const renders = renderCount

    act(() => {
      // Notification fires (value deep-differs) but status/isPending are unchanged.
      cacheService.setShared(KEY, makeEntry('streaming', 2))
    })

    expect(renderCount).toBe(renders)
    expect(result.current).toBe(committed)
  })

  it('comparator unequal branch: derived state change re-renders with the new map', () => {
    act(() => {
      cacheService.setShared(KEY, makeEntry('streaming', 1))
    })

    const { result } = renderHook(() => useAgentSessionStreamStatuses([SESSION_ID]))
    expect(result.current.get(SESSION_ID)?.isPending).toBe(true)

    act(() => {
      cacheService.setShared(KEY, makeEntry('done', 3))
    })

    expect(result.current.get(SESSION_ID)).toEqual({ isPending: false, status: 'done' })
  })
})
