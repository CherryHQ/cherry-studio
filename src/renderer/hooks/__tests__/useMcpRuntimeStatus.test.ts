import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { useMcpRuntimeStatus, useMcpRuntimeStatusMap } from '../useMcpRuntimeStatus'

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
    expect(result.current[SERVER_B]).toEqual({ state: 'running', lastCheckedAt: 7 })
  })
})
