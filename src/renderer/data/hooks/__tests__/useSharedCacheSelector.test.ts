/**
 * Contract tests for the multi-key shared cache selector hook.
 *
 * Locks the skeleton's own responsibilities against the REAL CacheService
 * (selector memoization/bail-out itself is the official with-selector's
 * behavior and is exercised, not re-proven):
 * - subscription set == snapshot read set (both driven by the same stable keys)
 * - idempotent base snapshot: unchanged entries keep the tuple identity, no
 *   "getSnapshot should be cached" warnings on zero/all/partial misses
 * - keys content/order changes re-subscribe and rebuild the tuple
 * - selection bail-out: an isEqual-accepted selection does not re-render
 * - the default comparator's promise (Object.is, one-level arrays/plain
 *   objects, Map/Set never equal), locked through hook behavior — the
 *   comparator itself is file-private
 */
import { cacheService } from '@data/CacheService'
import { useSharedCacheSelector } from '@data/hooks/useCache'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Undo the global mocks from renderer.setup.ts — the contract only means
// anything against the real store wiring.
vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

const broadcastSync = vi.fn()

// Main-owned job progress keys (object values, no schema default write-back).
const KEY_A = 'jobs.progress.selector-test-a' as const
const KEY_B = 'jobs.progress.selector-test-b' as const

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

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

  // The singleton persists across tests — make sure the keys start absent.
  cacheService.deleteShared(KEY_A)
  cacheService.deleteShared(KEY_B)
  broadcastSync.mockClear()

  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  // getSnapshot instability surfaces as a React console.error — fail loudly.
  const snapshotWarnings = consoleErrorSpy.mock.calls.filter((call) =>
    String(call[0]).includes('getSnapshot should be cached')
  )
  expect(snapshotWarnings).toEqual([])
  vi.restoreAllMocks()
})

describe('useSharedCacheSelector', () => {
  it('delivers values in key order and undefined on physical miss', () => {
    act(() => {
      cacheService.setShared(KEY_B, { progress: 42 })
    })

    const { result } = renderHook(() =>
      useSharedCacheSelector([KEY_A, KEY_B], (values) => ({ a: values[0], b: values[1] }))
    )

    expect(result.current.a).toBeUndefined() // partial miss
    expect(result.current.b).toEqual({ progress: 42 })
  })

  it('supports zero keys and full miss without snapshot churn', () => {
    const { result: empty, rerender: rerenderEmpty } = renderHook(() =>
      useSharedCacheSelector([], (values) => values.length)
    )
    expect(empty.current).toBe(0)
    rerenderEmpty()
    expect(empty.current).toBe(0)

    const { result: missed, rerender: rerenderMissed } = renderHook(() =>
      useSharedCacheSelector([KEY_A, KEY_B], (values) => values)
    )
    const first = missed.current
    expect(first).toEqual([undefined, undefined])
    rerenderMissed()
    expect(missed.current).toBe(first) // tuple identity held across renders
  })

  it('keeps unchanged entries reference-stable when a sibling key changes', () => {
    const valueA = { progress: 1 }
    act(() => {
      cacheService.setShared(KEY_A, valueA)
    })

    const { result } = renderHook(() => useSharedCacheSelector([KEY_A, KEY_B], (values) => values))
    const before = result.current

    act(() => {
      cacheService.setShared(KEY_B, { progress: 2 })
    })

    const after = result.current
    expect(after).not.toBe(before) // any entry change → new tuple
    expect(after[0]).toBe(before[0]) // untouched entry keeps its identity
    expect(after[1]).toEqual({ progress: 2 })
  })

  it('reuses the committed selection across re-renders with inline selector and isEqual', () => {
    act(() => {
      cacheService.setShared(KEY_A, { progress: 7 })
    })

    // Fresh selector AND isEqual closures (and a fresh keys array) on every
    // render — the hook must still hand back the committed selection by
    // reference.
    const { result, rerender } = renderHook(
      ({ label }: { label: string }) =>
        useSharedCacheSelector(
          [KEY_A],
          (values) => ({ label, progress: values[0]?.progress ?? 0 }),
          (a, b) => a.label === b.label && a.progress === b.progress
        ),
      { initialProps: { label: 'stable' } }
    )
    const first = result.current
    expect(first).toEqual({ label: 'stable', progress: 7 })

    rerender({ label: 'stable' })
    expect(result.current).toBe(first)
  })

  it('bails out without re-rendering when the selection stays isEqual', () => {
    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount++
      // Selection derives only from KEY_A; KEY_B is subscribed but projected away.
      return useSharedCacheSelector([KEY_A, KEY_B], (values) => ({ progress: values[0]?.progress ?? 0 }))
    })
    const committed = result.current
    const renders = renderCount

    act(() => {
      cacheService.setShared(KEY_B, { progress: 99 })
    })

    expect(renderCount).toBe(renders) // notified, selector ran, selection equal → no render
    expect(result.current).toBe(committed)

    act(() => {
      cacheService.setShared(KEY_A, { progress: 5 })
    })

    expect(renderCount).toBe(renders + 1)
    expect(result.current).toEqual({ progress: 5 })
  })

  it('does not re-render when raw fields change but the derived selection is unchanged', () => {
    // The Topics.tsx scenario: signature-based snapshots re-rendered on any raw
    // field change; selection-level comparison must not.
    act(() => {
      cacheService.setShared(KEY_A, { progress: 10 })
    })

    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount++
      return useSharedCacheSelector([KEY_A], (values) => ({
        started: (values[0]?.progress ?? 0) > 0
      }))
    })
    expect(result.current).toEqual({ started: true })
    const renders = renderCount

    act(() => {
      cacheService.setShared(KEY_A, { progress: 20 }) // raw change, same boolean
    })

    expect(renderCount).toBe(renders)
    expect(result.current).toEqual({ started: true })
  })

  it('re-subscribes and rebuilds the tuple when keys content changes', () => {
    const { result, rerender } = renderHook(
      ({ keys }: { keys: readonly (typeof KEY_A | typeof KEY_B)[] }) =>
        useSharedCacheSelector(keys, (values) => values),
      { initialProps: { keys: [KEY_A] as readonly (typeof KEY_A | typeof KEY_B)[] } }
    )
    expect(result.current).toEqual([undefined])

    // Not yet subscribed to KEY_B — writes to it must not surface.
    act(() => {
      cacheService.setShared(KEY_B, { progress: 1 })
    })
    expect(result.current).toEqual([undefined])

    rerender({ keys: [KEY_A, KEY_B] })
    expect(result.current).toEqual([undefined, { progress: 1 }])

    act(() => {
      cacheService.setShared(KEY_B, { progress: 2 })
    })
    expect(result.current).toEqual([undefined, { progress: 2 }])

    // Shrink back — KEY_B updates must stop surfacing (unsubscribed).
    rerender({ keys: [KEY_A] })
    expect(result.current).toEqual([undefined])
    const shrunk = result.current

    act(() => {
      cacheService.setShared(KEY_B, { progress: 3 })
    })
    expect(result.current).toBe(shrunk)
  })

  it('follows key order in the delivered tuple and stays reactive after a reorder', () => {
    act(() => {
      cacheService.setShared(KEY_A, { progress: 1 })
      cacheService.setShared(KEY_B, { progress: 2 })
    })

    const { result, rerender } = renderHook(
      ({ keys }: { keys: readonly (typeof KEY_A | typeof KEY_B)[] }) =>
        useSharedCacheSelector(keys, (values) => values),
      { initialProps: { keys: [KEY_A, KEY_B] as readonly (typeof KEY_A | typeof KEY_B)[] } }
    )
    expect(result.current).toEqual([{ progress: 1 }, { progress: 2 }])

    // Same key set, different order — a snapshot-shape change: the tuple is
    // rebuilt in the new order.
    rerender({ keys: [KEY_B, KEY_A] })
    expect(result.current).toEqual([{ progress: 2 }, { progress: 1 }])

    // Re-subscribed with the new shape: updates keep landing at the right index.
    act(() => {
      cacheService.setShared(KEY_A, { progress: 3 })
    })
    expect(result.current).toEqual([{ progress: 2 }, { progress: 3 }])
  })
})

/**
 * The default comparator is file-private; its promise is locked through hook
 * behavior. Plain-object selections (equal → no render, changed → render) are
 * already covered by the bail-out tests above.
 */
describe('default comparator (observed through the hook)', () => {
  it('reuses primitive selections via Object.is, including NaN', () => {
    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount++
      return useSharedCacheSelector([KEY_A], () => Number.NaN)
    })
    expect(result.current).toBeNaN()
    const renders = renderCount

    act(() => {
      cacheService.setShared(KEY_A, { progress: 1 }) // notifies; selection still NaN
    })

    expect(renderCount).toBe(renders)
  })

  it('compares array selections item-wise on entry identity', () => {
    act(() => {
      cacheService.setShared(KEY_A, { progress: 1 })
    })

    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount++
      return useSharedCacheSelector([KEY_A, KEY_B], (values) => [values[0]])
    })
    const committed = result.current
    const renders = renderCount

    act(() => {
      cacheService.setShared(KEY_B, { progress: 2 }) // not part of the selection
    })

    expect(renderCount).toBe(renders) // fresh array, same single entry → equal
    expect(result.current).toBe(committed)

    act(() => {
      cacheService.setShared(KEY_A, { progress: 3 })
    })

    expect(renderCount).toBe(renders + 1)
    expect(result.current).toEqual([{ progress: 3 }])
  })

  it('treats Map selections as never-equal — an explicit comparator is required', () => {
    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount++
      return useSharedCacheSelector([KEY_A, KEY_B], (values) => new Map([['a', values[0]]]))
    })
    const committed = result.current
    const renders = renderCount

    act(() => {
      cacheService.setShared(KEY_B, { progress: 1 }) // selection content unchanged
    })

    expect(renderCount).toBe(renders + 1) // the default comparator rejects Maps
    expect(result.current).not.toBe(committed)
  })
})
