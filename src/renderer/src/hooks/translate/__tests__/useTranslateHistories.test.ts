import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTranslateHistories } from '../useTranslateHistories'

const swrInfiniteMock = vi.fn()
vi.mock('swr/infinite', () => ({
  default: (...args: unknown[]) => swrInfiniteMock(...args)
}))

// `@data/DataApiService` is already mocked globally in tests/renderer.setup.ts;
// these tests intercept `useSWRInfinite` directly so the fetcher never runs.

type Page = { items: Array<{ id: string }>; total: number; page: number; limit: number }

function buildSWRState(pages: Page[], setSize = vi.fn()) {
  return {
    data: pages,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
    size: pages.length,
    setSize
  }
}

describe('useTranslateHistories', () => {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    // The hook fires a one-shot toast when SWR returns an error; the test env
    // doesn't provide a toast shim by default, so install one here.
    Object.defineProperty(window, 'toast', { value: toast, writable: true, configurable: true })
  })

  it('flattens items across pages and picks `total` from the first page', () => {
    const pages: Page[] = [
      { items: [{ id: 'a' }, { id: 'b' }], total: 5, page: 1, limit: 2 },
      { items: [{ id: 'c' }, { id: 'd' }], total: 5, page: 2, limit: 2 }
    ]
    swrInfiniteMock.mockReturnValue(buildSWRState(pages))

    const { result } = renderHook(() => useTranslateHistories({ pageSize: 2 }))

    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.current.total).toBe(5)
    expect(result.current.hasMore).toBe(true)
  })

  it('reports hasMore=false once loaded items reach the total', () => {
    const pages: Page[] = [{ items: [{ id: 'a' }, { id: 'b' }], total: 2, page: 1, limit: 2 }]
    swrInfiniteMock.mockReturnValue(buildSWRState(pages))

    const { result } = renderHook(() => useTranslateHistories())

    expect(result.current.hasMore).toBe(false)
  })

  it('loadMore increments setSize when there are more pages to fetch', () => {
    const setSize = vi.fn()
    const pages: Page[] = [{ items: [{ id: 'a' }, { id: 'b' }], total: 10, page: 1, limit: 2 }]
    swrInfiniteMock.mockReturnValue(buildSWRState(pages, setSize))

    const { result } = renderHook(() => useTranslateHistories({ pageSize: 2 }))

    act(() => {
      result.current.loadMore()
    })

    expect(setSize).toHaveBeenCalledTimes(1)
    const updater = setSize.mock.calls[0][0] as (n: number) => number
    expect(updater(1)).toBe(2)
  })

  it('loadMore is a no-op when hasMore is false', () => {
    const setSize = vi.fn()
    const pages: Page[] = [{ items: [{ id: 'a' }, { id: 'b' }], total: 2, page: 1, limit: 2 }]
    swrInfiniteMock.mockReturnValue(buildSWRState(pages, setSize))

    const { result } = renderHook(() => useTranslateHistories())

    act(() => {
      result.current.loadMore()
    })

    expect(setSize).not.toHaveBeenCalled()
  })

  it('builds SWR keys that include search, star, and pageSize so filter changes invalidate caches', () => {
    swrInfiniteMock.mockReturnValue(buildSWRState([]))

    renderHook(() => useTranslateHistories({ search: 'hello', star: true, pageSize: 5 }))

    const getKey = swrInfiniteMock.mock.calls[0][0] as (
      pageIndex: number,
      prev: Page | null
    ) => readonly unknown[] | null

    expect(getKey(0, null)).toEqual(['/translate/histories', 1, 5, 'hello', true])
    // Next page: previous page saturated (items.length === pageSize) → continue
    const prevSaturated: Page = {
      items: Array.from({ length: 5 }, (_, i) => ({ id: `x${i}` })),
      total: 10,
      page: 1,
      limit: 5
    }
    expect(getKey(1, prevSaturated)).toEqual(['/translate/histories', 2, 5, 'hello', true])
    // Next page: previous page short (items.length < pageSize) → terminate
    const prevShort: Page = { items: [{ id: 'y' }], total: 6, page: 2, limit: 5 }
    expect(getKey(2, prevShort)).toBeNull()
  })

  it('exposes SWR errors so consumers can distinguish loading from failure', () => {
    const failure = new Error('infinite fetch failed')
    swrInfiniteMock.mockReturnValue({
      data: undefined,
      error: failure,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      size: 0,
      setSize: vi.fn()
    })

    const { result } = renderHook(() => useTranslateHistories())

    // `data: undefined` alone is ambiguous (loading vs failed); the `error`
    // field is what callers like TranslateHistoryList read to render a retry
    // state instead of an empty state.
    expect(result.current.error).toBe(failure)
    expect(result.current.items).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.hasMore).toBe(false)
  })
})
