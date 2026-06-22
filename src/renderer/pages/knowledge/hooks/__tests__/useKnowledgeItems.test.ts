import { useKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import type { KnowledgeItemListResponse } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseInfiniteQuery = vi.fn()

const expectKnowledgeItemsQuery = (baseId: string, enabled: boolean) => {
  expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/knowledge-bases/:id/items', {
    params: { id: baseId },
    query: { groupId: null },
    limit: 50,
    enabled,
    swrOptions: {
      refreshInterval: expect.any(Function),
      revalidateAll: expect.any(Boolean)
    }
  })
}

vi.mock('@data/hooks/useDataApi', () => ({
  useInfiniteQuery: (...args: unknown[]) => mockUseInfiniteQuery(...args),
  // Flatten pages the same way the real helper does so the hook's `items` is testable.
  useInfiniteFlatItems: (pages?: KnowledgeItemListResponse[]) => pages?.flatMap((page) => page.items) ?? [],
  useInvalidateCache: () => vi.fn()
}))

const makeItem = (overrides: Partial<KnowledgeItem> = {}): KnowledgeItem =>
  ({
    id: 'item-1',
    baseId: 'base-1',
    groupId: null,
    type: 'note',
    data: { source: 'item-1', content: 'hello' },
    status: 'completed',
    error: null,
    createdAt: '2026-04-21T10:00:00+08:00',
    updatedAt: '2026-04-21T10:00:00+08:00',
    ...overrides
  }) as KnowledgeItem

describe('useKnowledgeItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('flattens infinite pages and surfaces total, pagination state, and refresh', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })]
    const refresh = vi.fn()
    const loadNext = vi.fn()

    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items, total: 7, nextCursor: 'cursor-1' }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: true,
      loadNext,
      refresh
    })

    const { result } = renderHook(() => useKnowledgeItems('base-1'))

    expectKnowledgeItemsQuery('base-1', true)
    expect(result.current.items).toEqual(items)
    expect(result.current.total).toBe(7)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeUndefined()
    expect(result.current.hasMore).toBe(true)
    expect(result.current.isLoadingMore).toBe(false)
    expect(result.current.refresh).toBe(refresh)
  })

  it('does not flag isLoadingMore during background polling', () => {
    // Regression guard: isLoadingMore used to be `isRefreshing && pages.length > 0`, so a poll in
    // flight blocked a scroll-to-bottom. It must now reflect ONLY a real in-flight load-more.
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: [makeItem()], total: 1, nextCursor: 'cursor-1' }],
      isLoading: false,
      isRefreshing: true,
      error: undefined,
      hasNext: true,
      loadNext: vi.fn(),
      refresh: vi.fn()
    })

    const { result } = renderHook(() => useKnowledgeItems('base-1'))

    expect(result.current.isLoadingMore).toBe(false)
  })

  it('loadMore triggers loadNext, flags an in-flight load-more, and dedupes a second call', () => {
    const loadNext = vi.fn()
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: [makeItem()], total: 5, nextCursor: 'cursor-1' }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: true,
      loadNext,
      refresh: vi.fn()
    })

    const { result } = renderHook(() => useKnowledgeItems('base-1'))

    act(() => result.current.loadMore())
    expect(loadNext).toHaveBeenCalledTimes(1)
    expect(result.current.isLoadingMore).toBe(true)

    // A second load-more while the first is still in flight is ignored — even though a poll
    // (isRefreshing) might fire in between, it no longer settles the in-flight flag.
    act(() => result.current.loadMore())
    expect(loadNext).toHaveBeenCalledTimes(1)
  })

  it('clears the in-flight flag once the requested page lands and allows the next load-more', () => {
    const loadNext = vi.fn()
    let queryResult = {
      pages: [{ items: [makeItem()], total: 5, nextCursor: 'cursor-1' }],
      isLoading: false,
      isRefreshing: false,
      error: undefined as Error | undefined,
      hasNext: true,
      loadNext,
      refresh: vi.fn()
    }
    mockUseInfiniteQuery.mockImplementation(() => queryResult)

    const { result, rerender } = renderHook(() => useKnowledgeItems('base-1'))

    act(() => result.current.loadMore())
    expect(result.current.isLoadingMore).toBe(true)

    // The requested page lands (pages grew), so the in-flight flag settles.
    queryResult = {
      ...queryResult,
      pages: [
        { items: [makeItem()], total: 5, nextCursor: 'cursor-1' },
        { items: [makeItem({ id: 'item-2' })], total: 5, nextCursor: 'cursor-2' }
      ]
    }
    rerender()

    expect(result.current.isLoadingMore).toBe(false)

    act(() => result.current.loadMore())
    expect(loadNext).toHaveBeenCalledTimes(2)
  })

  it('resets the in-flight load-more when the knowledge base changes', () => {
    // Regression: the hook instance is reused across base switches. An in-flight load-more from
    // the previous base used to leak in and wedge `loadMore` for the new base, because the
    // land/end/error clear can't fire when the new base loaded fewer pages and still has a next.
    const loadNext = vi.fn()
    let queryResult = {
      pages: [{ items: [makeItem()], total: 5, nextCursor: 'cursor-1' }],
      isLoading: false,
      isRefreshing: false,
      error: undefined as Error | undefined,
      hasNext: true,
      loadNext,
      refresh: vi.fn()
    }
    mockUseInfiniteQuery.mockImplementation(() => queryResult)

    const { result, rerender } = renderHook(({ baseId }) => useKnowledgeItems(baseId), {
      initialProps: { baseId: 'base-1' }
    })

    act(() => result.current.loadMore())
    expect(result.current.isLoadingMore).toBe(true)

    // Switch base: the new base's first page has no more loaded pages than the in-flight base and
    // still has a next cursor, so only the base-change reset can settle the stuck flag.
    queryResult = {
      ...queryResult,
      pages: [{ items: [makeItem({ id: 'b-1' })], total: 9, nextCursor: 'cursor-b' }]
    }
    rerender({ baseId: 'base-2' })

    expect(result.current.isLoadingMore).toBe(false)

    // The new base can paginate again.
    act(() => result.current.loadMore())
    expect(loadNext).toHaveBeenCalledTimes(2)
  })

  it('clears the in-flight load-more when the fetch errors and allows a retry', () => {
    // The `|| error` reset branch lets a failed load-more be retried. pages don't grow and
    // hasNext stays true, so ONLY the error branch can settle the stuck in-flight flag.
    const loadNext = vi.fn()
    let queryResult = {
      pages: [{ items: [makeItem()], total: 5, nextCursor: 'cursor-1' }],
      isLoading: false,
      isRefreshing: false,
      error: undefined as Error | undefined,
      hasNext: true,
      loadNext,
      refresh: vi.fn()
    }
    mockUseInfiniteQuery.mockImplementation(() => queryResult)

    const { result, rerender } = renderHook(() => useKnowledgeItems('base-1'))

    act(() => result.current.loadMore())
    expect(result.current.isLoadingMore).toBe(true)

    // The load-more rejects.
    queryResult = { ...queryResult, error: new Error('load failed') }
    rerender()

    expect(result.current.isLoadingMore).toBe(false)

    // Once the error clears the user can retry, which fires loadNext again.
    queryResult = { ...queryResult, error: undefined }
    rerender()

    act(() => result.current.loadMore())
    expect(loadNext).toHaveBeenCalledTimes(2)
    expect(result.current.isLoadingMore).toBe(true)
  })

  it('does not load more when there is no next page', () => {
    const loadNext = vi.fn()
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: [makeItem()], total: 1, nextCursor: undefined }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext,
      refresh: vi.fn()
    })

    const { result } = renderHook(() => useKnowledgeItems('base-1'))

    act(() => result.current.loadMore())

    expect(loadNext).not.toHaveBeenCalled()
  })

  it('does not enable the query before a knowledge base is selected', () => {
    const error = new Error('disabled')
    mockUseInfiniteQuery.mockReturnValue({
      pages: [],
      isLoading: false,
      isRefreshing: false,
      error,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn()
    })

    const { result } = renderHook(() => useKnowledgeItems(''))

    expectKnowledgeItemsQuery('', false)
    expect(result.current.items).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.error).toBe(error)
    expect(result.current.hasMore).toBe(false)
  })

  it('polls while any returned item is non-terminal and stops when all terminal', () => {
    mockUseInfiniteQuery.mockReturnValue({
      pages: [],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn()
    })

    renderHook(() => useKnowledgeItems('base-1'))

    const refreshInterval = mockUseInfiniteQuery.mock.calls[0][1].swrOptions.refreshInterval as (
      pages?: KnowledgeItemListResponse[]
    ) => number

    expect(refreshInterval(undefined)).toBe(0)
    expect(
      refreshInterval([
        {
          items: [makeItem({ id: 'done', status: 'completed' }), makeItem({ id: 'busy', status: 'embedding' })],
          total: 2
        }
      ])
    ).toBe(2000)
    expect(
      refreshInterval([
        {
          items: [
            makeItem({ id: 'done', status: 'completed' }),
            makeItem({ id: 'failed', status: 'failed', error: 'x' })
          ],
          total: 2
        }
      ])
    ).toBe(0)
  })

  it('revalidates every loaded page while any item is non-terminal so later-page rows refresh', () => {
    // Otherwise polling only revalidates page 0 and a non-terminal row on a later page stays stale
    // forever while the interval spins endlessly.
    mockUseInfiniteQuery.mockReturnValue({
      pages: [{ items: [makeItem({ id: 'busy', status: 'embedding' })], total: 1, nextCursor: undefined }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn()
    })

    renderHook(() => useKnowledgeItems('base-1'))

    // The effect re-renders after promoting revalidateAll, so the latest call carries the new value.
    const lastCall = mockUseInfiniteQuery.mock.calls.at(-1)
    expect(lastCall?.[1].swrOptions.revalidateAll).toBe(true)
  })

  it('stops revalidating later pages once every item reaches a terminal status', () => {
    // Start processing so the effect promotes revalidateAll, then finish: the reset back to false
    // is what keeps a later scroll-to-bottom a single fetch. (A static all-terminal render would
    // pass vacuously off the initial useState(false), so drive the real true -> false transition.)
    let queryResult = {
      pages: [{ items: [makeItem({ id: 'busy', status: 'embedding' })], total: 1, nextCursor: undefined }],
      isLoading: false,
      isRefreshing: false,
      error: undefined as Error | undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn()
    }
    mockUseInfiniteQuery.mockImplementation(() => queryResult)

    const { rerender } = renderHook(() => useKnowledgeItems('base-1'))

    expect(mockUseInfiniteQuery.mock.calls.at(-1)?.[1].swrOptions.revalidateAll).toBe(true)

    queryResult = {
      ...queryResult,
      pages: [{ items: [makeItem({ id: 'done', status: 'completed' })], total: 1, nextCursor: undefined }]
    }
    rerender()

    expect(mockUseInfiniteQuery.mock.calls.at(-1)?.[1].swrOptions.revalidateAll).toBe(false)
  })
})
