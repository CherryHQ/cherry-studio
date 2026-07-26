/**
 * Tests for the read-only shared cache observer hook (issue #17050).
 *
 * Locks the hook's zero-side-effect contract against the REAL CacheService:
 * mounting never materializes a schema default into a main-owned key, never
 * broadcasts, and never pins the key against owner deletion. The writable
 * `useSharedCache` serves as the negative control for each guarantee.
 */
import { cacheService } from '@data/CacheService'
import { useSharedCache, useSharedCacheValue } from '@data/hooks/useCache'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mocks from renderer.setup.ts — the contract only means
// anything against the real store wiring.
vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

const broadcastSync = vi.fn()

const BASE = 1_000_000
let now: number

// Main-owned job keys (schema defaults: state → null, progress → { progress: 0 })
const STATE_KEY = 'jobs.state.job-observer-test' as const

beforeEach(() => {
  broadcastSync.mockClear()
  now = BASE
  vi.spyOn(Date, 'now').mockImplementation(() => now)

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
  cacheService.deleteShared(STATE_KEY)
  broadcastSync.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSharedCacheValue', () => {
  it('mounting on an absent main-owned key returns undefined and writes nothing back', () => {
    const { result } = renderHook(() => useSharedCacheValue(STATE_KEY))

    expect(result.current).toBeUndefined()
    expect(cacheService.getSharedSnapshot(STATE_KEY)).toBeUndefined() // no default materialized
    expect(broadcastSync).not.toHaveBeenCalled()
  })

  it('negative control: writable useSharedCache DOES materialize the schema default on mount', () => {
    renderHook(() => useSharedCache(STATE_KEY))

    // Schema default for jobs.state.* is null (not undefined) — the writable
    // hook writes it into the cache and broadcasts, which is exactly the
    // mount-race pollution the read-only hook exists to avoid.
    expect(cacheService.getSharedSnapshot(STATE_KEY)).toBeNull()
    expect(broadcastSync).toHaveBeenCalled()
  })

  it('does not pin the key: owner deletion succeeds while mounted', () => {
    act(() => {
      cacheService.setShared(STATE_KEY, { id: 'j', status: 'running' } as any)
    })
    const { result } = renderHook(() => useSharedCacheValue(STATE_KEY))
    expect(result.current).toEqual({ id: 'j', status: 'running' })

    let deleted = false
    act(() => {
      deleted = cacheService.deleteShared(STATE_KEY)
    })

    expect(deleted).toBe(true)
    expect(result.current).toBeUndefined()
  })

  it('negative control: writable useSharedCache pins the key against deletion', () => {
    renderHook(() => useSharedCache(STATE_KEY))

    expect(cacheService.deleteShared(STATE_KEY)).toBe(false)
  })

  it('updates reactively when the owner publishes', () => {
    const { result } = renderHook(() => useSharedCacheValue(STATE_KEY))
    expect(result.current).toBeUndefined()

    act(() => {
      cacheService.setShared(STATE_KEY, { id: 'j', status: 'completed' } as any)
    })

    expect(result.current).toEqual({ id: 'j', status: 'completed' })
  })

  it('retains the last value for an expired-but-uncollected entry (eventual consistency)', () => {
    act(() => {
      cacheService.setShared(STATE_KEY, { id: 'j', status: 'completed' } as any, 1_000)
    })
    const { result, rerender } = renderHook(() => useSharedCacheValue(STATE_KEY))
    const beforeExpiry = result.current

    now = BASE + 60_000 // long past the TTL, no eviction event yet
    rerender()

    // No change event fired, so the snapshot must not flip with time; the value
    // disappears only when the physical deletion (Main tombstone / lazy
    // eviction) lands.
    expect(result.current).toBe(beforeExpiry)

    act(() => {
      cacheService.deleteShared(STATE_KEY)
    })
    expect(result.current).toBeUndefined()
  })
})
