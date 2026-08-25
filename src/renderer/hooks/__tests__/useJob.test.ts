/**
 * Tests for useJob / useJobProgress after migrating to the read-only
 * useSharedCacheValue observer (issue #17050).
 *
 * Locks the migration's behavior-preservation goals:
 *  - useJob still enables the DataApi fallback on a cache miss (`enabled` flips
 *    with cache presence) and no longer materializes the schema default (null)
 *    into the main-owned key on mount.
 *  - useJobProgress falls back to a reference-stable local EMPTY progress
 *    object instead of writing `{ progress: 0 }` back into the cache.
 */
import { cacheService } from '@data/CacheService'
import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useJob, useJobProgress } from '../useJob'

// Undo the global mocks — these tests need the real cache wiring.
// @data/hooks/useDataApi stays on the unified global mock (renderer.setup.ts);
// mockUseQuery is inspected for call args and steered via MockUseDataApiUtils.
vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

const broadcastSync = vi.fn()

const JOB_ID = 'job-hook-test'
const STATE_KEY = `jobs.state.${JOB_ID}` as const
const PROGRESS_KEY = `jobs.progress.${JOB_ID}` as const

const RUNNING_SNAPSHOT = { id: JOB_ID, status: 'running' } as any

beforeEach(() => {
  broadcastSync.mockClear()
  MockUseDataApiUtils.resetMocks()
  // The unified mock fabricates data for any enabled query by default; pin the
  // job path to "no DB row yet" so `data` reflects only the cache tier.
  MockUseDataApiUtils.mockQueryResult(`/jobs/${JOB_ID}`, { data: undefined })

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      cache: {
        broadcastSync,
        onSync: vi.fn(),
        getAllShared: vi.fn(async () => ({}))
      }
    }
  })

  // The singleton persists across tests — make sure the keys start absent.
  cacheService.deleteShared(STATE_KEY)
  cacheService.deleteShared(PROGRESS_KEY)
  broadcastSync.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useJob', () => {
  it('enables the DataApi fallback on a cache miss without polluting the cache', () => {
    const { result } = renderHook(() => useJob(JOB_ID))

    expect(result.current.data).toBeNull()
    expect(mockUseQuery).toHaveBeenLastCalledWith(`/jobs/${JOB_ID}`, { enabled: true })

    // Pre-migration, mounting wrote the schema default (null) into the
    // main-owned key and broadcast it to every window; now the miss stays a miss.
    expect(cacheService.getSharedSnapshot(STATE_KEY)).toBeUndefined()
    expect(broadcastSync).not.toHaveBeenCalled()
  })

  it('serves the cache snapshot and disables the fallback once main publishes', () => {
    const { result } = renderHook(() => useJob(JOB_ID))

    act(() => {
      cacheService.setShared(STATE_KEY, RUNNING_SNAPSHOT)
    })

    expect(result.current.data).toEqual(RUNNING_SNAPSHOT)
    expect(mockUseQuery).toHaveBeenLastCalledWith(`/jobs/${JOB_ID}`, { enabled: false })
  })

  it('re-enables the fallback after the cache entry disappears (TTL tombstone)', () => {
    act(() => {
      cacheService.setShared(STATE_KEY, RUNNING_SNAPSHOT)
    })
    const { result } = renderHook(() => useJob(JOB_ID))
    expect(mockUseQuery).toHaveBeenLastCalledWith(`/jobs/${JOB_ID}`, { enabled: false })

    act(() => {
      cacheService.deleteShared(STATE_KEY)
    })

    expect(result.current.data).toBeNull()
    expect(mockUseQuery).toHaveBeenLastCalledWith(`/jobs/${JOB_ID}`, { enabled: true })
  })
})

describe('useJobProgress', () => {
  it('falls back to a reference-stable empty progress on a cache miss', () => {
    const { result, rerender } = renderHook(() => useJobProgress(JOB_ID))

    expect(result.current).toEqual({ progress: 0 })
    const first = result.current
    rerender()
    expect(result.current).toBe(first) // module-level const, not a per-render object

    // The fallback never leaks into the cache.
    expect(cacheService.getSharedSnapshot(PROGRESS_KEY)).toBeUndefined()
    expect(broadcastSync).not.toHaveBeenCalled()
  })

  it('returns the published progress and drops back to the fallback on deletion', () => {
    const { result } = renderHook(() => useJobProgress(JOB_ID))

    act(() => {
      cacheService.setShared(PROGRESS_KEY, { progress: 42 })
    })
    expect(result.current).toEqual({ progress: 42 })

    act(() => {
      cacheService.deleteShared(PROGRESS_KEY)
    })
    expect(result.current).toEqual({ progress: 0 })
  })
})
