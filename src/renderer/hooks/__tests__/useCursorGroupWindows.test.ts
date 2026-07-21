import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCursorGroupWindows } from '../useCursorGroupWindows'

type Item = { id: string; name: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('useCursorGroupWindows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shares an in-flight group request with a concurrent header selection', async () => {
    const page = deferred<{ items: Item[]; nextCursor?: string }>()
    const fetchPage = vi.fn(() => page.promise)
    const { result } = renderHook(() =>
      useCursorGroupWindows<Item>({
        enabled: true,
        fetchPage,
        getItemId: (item) => item.id,
        initialGroupIds: [],
        queryKey: 'query-a'
      })
    )

    let preload!: Promise<string | null>
    let selection!: Promise<string | null>
    act(() => {
      preload = result.current.loadGroup('group-a')
      selection = result.current.loadGroup('group-a')
    })
    expect(selection).toBe(preload)
    expect(fetchPage).toHaveBeenCalledTimes(1)

    await act(async () => {
      page.resolve({ items: [{ id: 'item-a', name: 'A' }] })
      await expect(selection).resolves.toBe('item-a')
    })
    expect(result.current.items).toEqual([{ id: 'item-a', name: 'A' }])
  })

  it('appends the next cursor page to the loaded group window', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          { id: 'item-a', name: 'A' },
          { id: 'item-b', name: 'B' }
        ],
        nextCursor: 'cursor-b'
      })
      .mockResolvedValueOnce({
        items: [{ id: 'item-c', name: 'C' }]
      })
    const { result } = renderHook(() =>
      useCursorGroupWindows<Item>({
        enabled: true,
        fetchPage,
        getItemId: (item) => item.id,
        initialGroupIds: [],
        queryKey: 'query-a'
      })
    )

    await act(async () => {
      await result.current.loadGroup('group-a')
    })
    await act(async () => {
      await result.current.loadMoreGroup('group-a')
    })

    expect(fetchPage).toHaveBeenNthCalledWith(2, 'group-a', 'cursor-b')
    expect(result.current.windows['group-a']?.items).toEqual([
      { id: 'item-a', name: 'A' },
      { id: 'item-b', name: 'B' },
      { id: 'item-c', name: 'C' }
    ])
  })

  it('ignores a stale page after the query key changes', async () => {
    const page = deferred<{ items: Item[] }>()
    const fetchPage = vi.fn(() => page.promise)
    const { result, rerender } = renderHook(
      ({ queryKey }) =>
        useCursorGroupWindows<Item>({
          enabled: true,
          fetchPage,
          getItemId: (item) => item.id,
          initialGroupIds: [],
          queryKey
        }),
      { initialProps: { queryKey: 'query-a' } }
    )

    let request!: Promise<string | null>
    act(() => {
      request = result.current.loadGroup('group-a')
    })
    rerender({ queryKey: 'query-b' })

    await act(async () => {
      page.resolve({ items: [{ id: 'stale', name: 'Stale' }] })
      await request
    })
    expect(result.current.items).toEqual([])
    expect(result.current.windows).toEqual({})
  })

  it('refills a loaded window from the collection head', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          { id: 'item-a', name: 'A' },
          { id: 'item-b', name: 'B' }
        ],
        nextCursor: 'cursor-b'
      })
      .mockResolvedValueOnce({ items: [{ id: 'item-c', name: 'C' }] })
    const { result } = renderHook(() =>
      useCursorGroupWindows<Item>({
        enabled: true,
        fetchPage,
        getItemId: (item) => item.id,
        initialGroupIds: [],
        queryKey: 'query-a'
      })
    )

    await act(async () => {
      await result.current.refillGroup('group-a', 3)
    })

    expect(fetchPage).toHaveBeenNthCalledWith(1, 'group-a', undefined)
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'group-a', 'cursor-b')
    expect(result.current.windows['group-a']?.items).toEqual([
      { id: 'item-a', name: 'A' },
      { id: 'item-b', name: 'B' },
      { id: 'item-c', name: 'C' }
    ])
  })
})
