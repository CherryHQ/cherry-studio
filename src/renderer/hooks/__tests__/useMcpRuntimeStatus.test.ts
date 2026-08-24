/**
 * Tests for useMcpRuntimeStatus (read-only useSharedCacheValue observer,
 * issue #17050) and useMcpRuntimeStatusMap (multi-key useSharedCacheSelector).
 *
 * The defaults are two module-level constants selected by `isActive`, so
 * cache-miss fallbacks are reference-stable by construction — both for the
 * single-key `?? fallback` and inside the map selector. These tests lock the
 * observable outcomes: reference-stable defaults, cache wins over default,
 * and no default materialization into the main-owned keys.
 */
import { cacheService } from '@data/CacheService'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDefaultMcpRuntimeStatus, useMcpRuntimeStatus, useMcpRuntimeStatusMap } from '../useMcpRuntimeStatus'

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

describe('useMcpRuntimeStatusMap', () => {
  const SERVER_A = 'mcp-map-test-a'
  const SERVER_B = 'mcp-map-test-b'
  const KEY_A = `mcp.status.${SERVER_A}` as const
  const KEY_B = `mcp.status.${SERVER_B}` as const

  beforeEach(() => {
    cacheService.deleteShared(KEY_A)
    cacheService.deleteShared(KEY_B)
  })

  it('fills misses with the module-level defaults, reference-stable across renders', () => {
    const servers = [
      { id: SERVER_A, isActive: true },
      { id: SERVER_B, isActive: false }
    ]
    const { result, rerender } = renderHook(({ list }) => useMcpRuntimeStatusMap(list), {
      initialProps: { list: servers }
    })

    expect(result.current[SERVER_A]).toBe(getDefaultMcpRuntimeStatus(true))
    expect(result.current[SERVER_B]).toBe(getDefaultMcpRuntimeStatus(false))

    const first = result.current
    rerender({ list: servers })
    expect(result.current).toBe(first) // committed selection reused

    expect(cacheService.getSharedSnapshot(KEY_A)).toBeUndefined() // nothing materialized
  })

  it('zips published statuses to their server ids and keeps others on default', () => {
    const { result } = renderHook(() =>
      useMcpRuntimeStatusMap([
        { id: SERVER_A, isActive: true },
        { id: SERVER_B, isActive: true }
      ])
    )

    act(() => {
      cacheService.setShared(KEY_B, { state: 'running', lastCheckedAt: 7 } as any)
    })

    expect(result.current[SERVER_A]).toBe(getDefaultMcpRuntimeStatus(true))
    expect(result.current[SERVER_B]).toEqual({ state: 'running', lastCheckedAt: 7 })
  })
})
