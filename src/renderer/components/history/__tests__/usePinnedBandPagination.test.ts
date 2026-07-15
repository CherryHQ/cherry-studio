import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PinnedBandSource } from '../usePinnedBandPagination'
import { usePinnedBandPagination } from '../usePinnedBandPagination'

type Item = { id: string; pinned?: boolean }

const source = (overrides: Partial<PinnedBandSource<Item>> = {}): PinnedBandSource<Item> => ({
  items: [],
  error: undefined,
  hasNext: false,
  isLoading: false,
  isLoadingMore: false,
  loadNext: vi.fn(),
  reload: vi.fn().mockResolvedValue(undefined),
  ...overrides
})

const useTestPinnedBandPagination = (
  pinned: PinnedBandSource<Item>,
  unpinned: PinnedBandSource<Item>,
  continuityKey = 'default'
) => usePinnedBandPagination(pinned, unpinned, { continuityKey })

describe('usePinnedBandPagination', () => {
  it('renders the pinned band first and appends the unpinned band once pins are complete', () => {
    const { result } = renderHook(() =>
      useTestPinnedBandPagination(
        source({ items: [{ id: 'p1', pinned: true }] }),
        source({ items: [{ id: 'u1' }, { id: 'u2' }] })
      )
    )

    expect(result.current.isPinnedBandComplete).toBe(true)
    expect(result.current.items.map((item) => item.id)).toEqual(['p1', 'u1', 'u2'])
  })

  it('hides the unpinned band while pin pages remain, so a pin can never appear below unpinned rows', () => {
    const { result } = renderHook(() =>
      useTestPinnedBandPagination(
        source({ items: [{ id: 'p1', pinned: true }], hasNext: true }),
        source({ items: [{ id: 'u1' }] })
      )
    )

    expect(result.current.isPinnedBandComplete).toBe(false)
    expect(result.current.items.map((item) => item.id)).toEqual(['p1'])
    expect(result.current.hasNext).toBe(true)
  })

  it('drops rows whose pin state contradicts their stream', () => {
    const { result } = renderHook(() =>
      useTestPinnedBandPagination(
        source({ items: [{ id: 'p1', pinned: true }, { id: 'stale-unpinned' }] }),
        source({ items: [{ id: 'u1' }, { id: 'stale-pinned', pinned: true }] })
      )
    )

    expect(result.current.items.map((item) => item.id)).toEqual(['p1', 'u1'])
  })

  it('deduplicates transient cross-band snapshots with the pinned row winning', () => {
    const pinnedRow = { id: 'moving', pinned: true }
    const { result } = renderHook(() =>
      useTestPinnedBandPagination(source({ items: [pinnedRow] }), source({ items: [{ id: 'moving' }, { id: 'u1' }] }))
    )

    expect(result.current.items).toEqual([pinnedRow, { id: 'u1' }])
  })

  it('cascades loadNext: pinned stream drains before the unpinned stream pages', () => {
    const pinned = source({ hasNext: true })
    const unpinned = source({ hasNext: true })
    const { result } = renderHook(() => useTestPinnedBandPagination(pinned, unpinned))

    result.current.loadNext()
    expect(pinned.loadNext).toHaveBeenCalledTimes(1)
    expect(unpinned.loadNext).not.toHaveBeenCalled()
  })

  it('pages the unpinned stream only after the pinned band is complete', () => {
    const pinned = source()
    const unpinned = source({ hasNext: true })
    const { result } = renderHook(() => useTestPinnedBandPagination(pinned, unpinned))

    result.current.loadNext()
    expect(pinned.loadNext).not.toHaveBeenCalled()
    expect(unpinned.loadNext).toHaveBeenCalledTimes(1)
  })

  it('suppresses unpinned errors and loading until the pinned band is complete', () => {
    const unpinnedError = new Error('later band failed')
    const incomplete = renderHook(() =>
      useTestPinnedBandPagination(source({ isLoading: true }), source({ error: unpinnedError, isLoading: true }))
    )
    expect(incomplete.result.current.error).toBeUndefined()

    const complete = renderHook(() =>
      useTestPinnedBandPagination(source(), source({ error: unpinnedError, isLoading: true }))
    )
    expect(complete.result.current.error).toBe(unpinnedError)
    expect(complete.result.current.isLoading).toBe(true)
  })

  it('reload restarts both streams', async () => {
    const pinned = source()
    const unpinned = source()
    const { result } = renderHook(() => useTestPinnedBandPagination(pinned, unpinned))

    await result.current.reload()
    expect(pinned.reload).toHaveBeenCalledTimes(1)
    expect(unpinned.reload).toHaveBeenCalledTimes(1)
  })

  it('keeps ordinary rows after a completed pin band fails to refresh, but resets continuity for a new scope', () => {
    let continuityKey = 'assistant:a'
    let pinned = source({ items: [{ id: 'p1', pinned: true }] })
    const unpinned = source({ items: [{ id: 'u1' }] })
    const { result, rerender } = renderHook(() => useTestPinnedBandPagination(pinned, unpinned, continuityKey))

    expect(result.current.items.map((item) => item.id)).toEqual(['p1', 'u1'])

    pinned = source({ items: [{ id: 'p1', pinned: true }], isLoading: true })
    rerender()
    expect(result.current.items.map((item) => item.id)).toEqual(['p1'])

    const refreshError = new Error('pin refresh failed')
    pinned = source({ items: [{ id: 'p1', pinned: true }], error: refreshError })
    rerender()

    expect(result.current.items.map((item) => item.id)).toEqual(['p1', 'u1'])
    expect(result.current.error).toBe(refreshError)

    continuityKey = 'assistant:b'
    rerender()

    expect(result.current.items.map((item) => item.id)).toEqual(['p1'])
    expect(result.current.isPinnedBandComplete).toBe(false)
  })

  it('invalidates prior completion after a same-scope reset returns an incomplete first page', () => {
    let pinned = source({ items: [{ id: 'p1', pinned: true }] })
    const unpinned = source({ items: [{ id: 'u1' }] })
    const { result, rerender } = renderHook(() => useTestPinnedBandPagination(pinned, unpinned, 'assistant:a'))

    expect(result.current.items.map((item) => item.id)).toEqual(['p1', 'u1'])

    pinned = source({ items: [{ id: 'p2', pinned: true }], hasNext: true })
    rerender()
    expect(result.current.items.map((item) => item.id)).toEqual(['p2'])

    const nextPageError = new Error('next pin page failed')
    pinned = source({ items: [{ id: 'p2', pinned: true }], error: nextPageError, hasNext: true })
    rerender()

    expect(result.current.items.map((item) => item.id)).toEqual(['p2'])
    expect(result.current.isPinnedBandComplete).toBe(false)
    expect(result.current.error).toBe(nextPageError)
  })
})
