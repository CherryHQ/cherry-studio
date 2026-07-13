import { publishDataApiCursorRevision } from '@renderer/data/hooks/useDataApiCursorRevision'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCursorGroupWindows } from '../useCursorGroupWindows'

const dataApiMocks = vi.hoisted(() => ({
  subscribe: vi.fn(() => vi.fn())
}))

vi.mock('@renderer/data/DataApiService', () => ({
  dataApiService: {
    subscribe: dataApiMocks.subscribe
  }
}))

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
        queryKey: 'query-a',
        resourcePath: '/topics'
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

  it('appends cursor pages without duplicating overlapping rows', async () => {
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
        items: [
          { id: 'item-b', name: 'B updated' },
          { id: 'item-c', name: 'C' }
        ]
      })
    const { result } = renderHook(() =>
      useCursorGroupWindows<Item>({
        enabled: true,
        fetchPage,
        getItemId: (item) => item.id,
        initialGroupIds: [],
        queryKey: 'query-a',
        resourcePath: '/topics'
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
      { id: 'item-b', name: 'B updated' },
      { id: 'item-c', name: 'C' }
    ])
  })

  it('resets windows from the shared resource revision without subscribing to Main', async () => {
    let phase: 'old' | 'new' = 'old'
    const fetchPage = vi.fn(async (_groupId: string, cursor?: string) => {
      if (phase === 'new') return { items: [{ id: 'new-a', name: 'New A' }] }
      return cursor
        ? { items: [{ id: 'old-b', name: 'Old B' }] }
        : { items: [{ id: 'old-a', name: 'Old A' }], nextCursor: 'old-cursor' }
    })
    const { result } = renderHook(() =>
      useCursorGroupWindows<Item>({
        enabled: true,
        fetchPage,
        getItemId: (item) => item.id,
        initialGroupIds: [],
        queryKey: 'query-a',
        resourcePath: '/topics'
      })
    )

    await act(async () => {
      await result.current.loadGroup('group-a')
    })
    await act(async () => {
      await result.current.loadMoreGroup('group-a')
    })
    expect(fetchPage).toHaveBeenLastCalledWith('group-a', 'old-cursor')

    phase = 'new'
    act(() => {
      publishDataApiCursorRevision('/topics')
    })
    await waitFor(() => expect(result.current.windows).toEqual({}))

    await act(async () => {
      await result.current.loadGroup('group-a')
    })
    expect(fetchPage).toHaveBeenLastCalledWith('group-a', undefined)
    expect(result.current.items).toEqual([{ id: 'new-a', name: 'New A' }])
    expect(dataApiMocks.subscribe).not.toHaveBeenCalled()
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
          queryKey,
          resourcePath: '/agent-sessions'
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
})
