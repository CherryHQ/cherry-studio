import { mockUsePaginatedQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTranslateHistories } from '../useTranslateHistories'

type HistoryItem = { id: string }

function buildPaginatedState(overrides: Record<string, unknown> = {}) {
  return {
    items: [],
    total: 0,
    page: 1,
    isLoading: false,
    isRefreshing: false,
    isValidating: false,
    error: undefined,
    hasNext: false,
    hasPrev: false,
    prevPage: vi.fn(),
    nextPage: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
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

  it('accumulates items across paginated pages and exposes total from usePaginatedQuery', async () => {
    const page1: HistoryItem[] = [{ id: 'a' }, { id: 'b' }]
    const page2: HistoryItem[] = [{ id: 'c' }, { id: 'd' }]
    mockUsePaginatedQuery.mockReturnValue(buildPaginatedState({ items: page1, total: 5, page: 1, hasNext: true }))

    const { result, rerender } = renderHook(() => useTranslateHistories({ pageSize: 2 }))
    await act(async () => {})

    mockUsePaginatedQuery.mockReturnValue(buildPaginatedState({ items: page2, total: 5, page: 2, hasNext: true }))
    rerender()
    await act(async () => {})

    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.current.total).toBe(5)
    expect(result.current.hasMore).toBe(true)
  })

  it('reports hasMore=false once loaded items reach the total', () => {
    mockUsePaginatedQuery.mockReturnValue(
      buildPaginatedState({ items: [{ id: 'a' }, { id: 'b' }], total: 2, hasNext: false })
    )

    const { result } = renderHook(() => useTranslateHistories())

    expect(result.current.hasMore).toBe(false)
  })

  it('loadMore increments setSize when there are more pages to fetch', () => {
    const nextPage = vi.fn()
    mockUsePaginatedQuery.mockReturnValue(
      buildPaginatedState({ items: [{ id: 'a' }, { id: 'b' }], total: 10, hasNext: true, nextPage })
    )

    const { result } = renderHook(() => useTranslateHistories({ pageSize: 2 }))

    act(() => {
      result.current.loadMore()
    })

    expect(nextPage).toHaveBeenCalledTimes(1)
  })

  it('loadMore is a no-op when hasMore is false', () => {
    const nextPage = vi.fn()
    mockUsePaginatedQuery.mockReturnValue(
      buildPaginatedState({ items: [{ id: 'a' }, { id: 'b' }], total: 2, hasNext: false, nextPage })
    )

    const { result } = renderHook(() => useTranslateHistories())

    act(() => {
      result.current.loadMore()
    })

    expect(nextPage).not.toHaveBeenCalled()
  })

  it('uses usePaginatedQuery with search, star, and pageSize query options', () => {
    mockUsePaginatedQuery.mockReturnValue(buildPaginatedState())

    renderHook(() => useTranslateHistories({ search: 'hello', star: true, pageSize: 5 }))

    expect(mockUsePaginatedQuery).toHaveBeenCalledWith('/translate/histories', {
      query: { search: 'hello', star: true },
      limit: 5,
      swrOptions: { keepPreviousData: false }
    })
  })

  it('exposes SWR errors so consumers can distinguish loading from failure', () => {
    const failure = new Error('paginated fetch failed')
    mockUsePaginatedQuery.mockReturnValue(buildPaginatedState({ error: failure }))

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
      mockUsePaginatedQuery.mockReturnValue(buildPaginatedState({ isLoading: true }))

      const { result } = renderHook(() => useTranslateHistories())

      expect(result.current.status).toBe('loading')
    })

    it("returns 'error' when the request failed without cached data", () => {
      mockUsePaginatedQuery.mockReturnValue(buildPaginatedState({ error: new Error('boom') }))

      const { result } = renderHook(() => useTranslateHistories())

      expect(result.current.status).toBe('error')
    })

    it("returns 'ready' once data is resolved, even when the list is empty", () => {
      mockUsePaginatedQuery.mockReturnValue(buildPaginatedState({ items: [], total: 0 }))

      const { result } = renderHook(() => useTranslateHistories())

      expect(result.current.status).toBe('ready')
      expect(result.current.items).toEqual([])
    })
  })
})
