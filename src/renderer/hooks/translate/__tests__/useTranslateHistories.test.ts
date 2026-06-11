import { mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTranslateHistories } from '../useTranslateHistories'

type HistoryItem = { id: string }

function buildInfiniteState(overrides: Record<string, unknown> = {}) {
  return {
    pages: [],
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasNext: false,
    loadNext: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
    mutate: vi.fn(),
    ...overrides
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

  it('flattens infinite query pages and exposes total from the first page', () => {
    const page1: HistoryItem[] = [{ id: 'a' }, { id: 'b' }]
    const page2: HistoryItem[] = [{ id: 'c' }, { id: 'd' }]
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteState({
        pages: [
          { items: page1, total: 5, nextCursor: 'cursor-2' },
          { items: page2, total: 5 }
        ],
        hasNext: true
      })
    )

    const { result } = renderHook(() => useTranslateHistories({ pageSize: 2 }))

    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.current.total).toBe(5)
    expect(result.current.hasMore).toBe(true)
  })

  it('reports hasMore=false when the infinite query has no next cursor', () => {
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteState({ pages: [{ items: [{ id: 'a' }, { id: 'b' }], total: 2 }], hasNext: false })
    )

    const { result } = renderHook(() => useTranslateHistories())

    expect(result.current.hasMore).toBe(false)
  })

  it('loadMore loads the next infinite page when there are more pages to fetch', () => {
    const loadNext = vi.fn()
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteState({ pages: [{ items: [{ id: 'a' }, { id: 'b' }], total: 10 }], hasNext: true, loadNext })
    )

    const { result } = renderHook(() => useTranslateHistories({ pageSize: 2 }))

    act(() => {
      result.current.loadMore()
    })

    expect(loadNext).toHaveBeenCalledTimes(1)
  })

  it('loadMore is a no-op when hasMore is false', () => {
    const loadNext = vi.fn()
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteState({ pages: [{ items: [{ id: 'a' }, { id: 'b' }], total: 2 }], hasNext: false, loadNext })
    )

    const { result } = renderHook(() => useTranslateHistories())

    act(() => {
      result.current.loadMore()
    })

    expect(loadNext).not.toHaveBeenCalled()
  })

  it('uses useInfiniteQuery with search, star, and pageSize query options', () => {
    mockUseInfiniteQuery.mockReturnValue(buildInfiniteState())

    renderHook(() => useTranslateHistories({ search: 'hello', star: true, pageSize: 5 }))

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/translate/histories', {
      query: { search: 'hello', star: true },
      limit: 5,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('exposes SWR errors so consumers can distinguish loading from failure', () => {
    const failure = new Error('infinite fetch failed')
    mockUseInfiniteQuery.mockReturnValue(buildInfiniteState({ error: failure }))

    const { result } = renderHook(() => useTranslateHistories())

    // `data: undefined` alone is ambiguous (loading vs failed); the `error`
    // field is what callers like TranslateHistoryList read to render a retry
    // state instead of an empty state.
    expect(result.current.error).toBe(failure)
    expect(result.current.items).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.hasMore).toBe(false)
  })

  describe('status discriminator', () => {
    it("returns 'loading' while SWR has neither data nor error", () => {
      mockUseInfiniteQuery.mockReturnValue(buildInfiniteState({ isLoading: true }))

      const { result } = renderHook(() => useTranslateHistories())

      expect(result.current.status).toBe('loading')
    })

    it("returns 'error' when the request failed without cached data", () => {
      mockUseInfiniteQuery.mockReturnValue(buildInfiniteState({ error: new Error('boom') }))

      const { result } = renderHook(() => useTranslateHistories())

      expect(result.current.status).toBe('error')
    })

    it("returns 'ready' once data is resolved, even when the list is empty", () => {
      mockUseInfiniteQuery.mockReturnValue(buildInfiniteState({ pages: [{ items: [], total: 0 }] }))

      const { result } = renderHook(() => useTranslateHistories())

      expect(result.current.status).toBe('ready')
      expect(result.current.items).toEqual([])
    })
  })
})
