/**
 * Tests for useMcpRuntimeStatus after migrating to the read-only
 * useSharedCacheValue observer (issue #17050).
 *
 * The migration's tricky bit: the fallback needs `isActive`, so it cannot be a
 * module-level const — it must be a useMemo evaluated UNCONDITIONALLY before
 * `??` (a hook on the right side of `??` would be skipped on cache hit,
 * violating the Rules of Hooks). These tests lock the observable outcomes:
 * reference-stable defaults, cache wins over default, and no default
 * materialization into the main-owned key.
 */
import { cacheService } from '@data/CacheService'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMcpRuntimeStatus } from '../useMcpRuntimeStatus'

// Undo the global mocks — these tests need the real cache wiring.
vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

const broadcastSync = vi.fn()

const SERVER_ID = 'mcp-hook-test'
const KEY = `mcp.status.${SERVER_ID}` as const

beforeEach(() => {
  broadcastSync.mockClear()

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

  // The singleton persists across tests — make sure the key starts absent.
  cacheService.deleteShared(KEY)
  broadcastSync.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useMcpRuntimeStatus', () => {
  it('derives the default from isActive on a cache miss', () => {
    const { result: active } = renderHook(() => useMcpRuntimeStatus(SERVER_ID, true))
    expect(active.current).toEqual({ state: 'connecting', lastCheckedAt: 0 })

    const { result: inactive } = renderHook(() => useMcpRuntimeStatus(SERVER_ID, false))
    expect(inactive.current).toEqual({ state: 'disabled', lastCheckedAt: 0 })
  })

  it('keeps the default reference stable across re-renders with unchanged isActive', () => {
    const { result, rerender } = renderHook(({ isActive }) => useMcpRuntimeStatus(SERVER_ID, isActive), {
      initialProps: { isActive: true }
    })
    const first = result.current

    rerender({ isActive: true })
    expect(result.current).toBe(first) // useMemo, not a per-render object

    rerender({ isActive: false })
    expect(result.current).toEqual({ state: 'disabled', lastCheckedAt: 0 })
  })

  it('never materializes the default into the main-owned key', () => {
    renderHook(() => useMcpRuntimeStatus(SERVER_ID, true))

    expect(cacheService.getSharedSnapshot(KEY)).toBeUndefined()
    expect(broadcastSync).not.toHaveBeenCalled()
  })

  it('prefers the published runtime status over the local default', () => {
    const { result } = renderHook(() => useMcpRuntimeStatus(SERVER_ID, true))

    act(() => {
      cacheService.setShared(KEY, { state: 'running', lastCheckedAt: 123 } as any)
    })

    expect(result.current).toEqual({ state: 'running', lastCheckedAt: 123 })
  })
})
