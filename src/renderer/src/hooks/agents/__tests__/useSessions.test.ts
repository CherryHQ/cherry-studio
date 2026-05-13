import { MockUseDataApiUtils, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessions } from '../useSessionDataApi'

const buildInfiniteReturn = (overrides: Record<string, unknown> = {}) => ({
  pages: [] as Array<{ items: Array<{ id: string; name: string }>; nextCursor?: string }>,
  isLoading: false,
  isRefreshing: false,
  error: undefined,
  hasNext: false,
  loadNext: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  reset: vi.fn(),
  mutate: vi.fn().mockResolvedValue(undefined),
  ...overrides
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/data/hooks/useReorder', () => ({
  useReorder: vi.fn(() => ({
    applyReorderedList: vi.fn().mockResolvedValue(undefined),
    move: vi.fn(),
    isPending: false
  }))
}))

vi.mock('../useSessionChanged', () => ({
  useSessionChanged: vi.fn()
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: { get: vi.fn() }
}))

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.stubGlobal('window', { toast: mockToast })

describe('useSessions', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('returns empty sessions when agentId is null', () => {
    mockUseInfiniteQuery.mockReturnValueOnce(buildInfiniteReturn() as never)

    const { result } = renderHook(() => useSessions(null))

    expect(result.current.sessions).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('flattens items from a single page', async () => {
    const items = [
      { id: 's-1', name: 'Session 1' },
      { id: 's-2', name: 'Session 2' }
    ]
    mockUseInfiniteQuery.mockReturnValue(buildInfiniteReturn({ pages: [{ items }] }) as never)

    const { result } = renderHook(() => useSessions('agent-1'))
    await act(async () => {})

    expect(result.current.sessions.map((s: any) => s.id)).toEqual(['s-1', 's-2'])
    expect(result.current.total).toBe(2)
  })

  it('flattens items across pages preserving page order', async () => {
    const page1 = [{ id: 's-1', name: 'Session 1' }]
    const page2 = [{ id: 's-2', name: 'Session 2' }]
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteReturn({ pages: [{ items: page1, nextCursor: 'c1' }, { items: page2 }] }) as never
    )

    const { result } = renderHook(() => useSessions('agent-1'))
    await act(async () => {})

    expect(result.current.sessions.map((s: any) => s.id)).toEqual(['s-1', 's-2'])
  })

  it('loadMore drives loadNext when hasMore is true', async () => {
    const loadNext = vi.fn()
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteReturn({
        pages: [{ items: [{ id: 's-1', name: 'Session 1' }], nextCursor: 'c1' }],
        hasNext: true,
        loadNext
      }) as never
    )

    const { result } = renderHook(() => useSessions('agent-1'))
    await act(async () => {})
    expect(result.current.hasMore).toBe(true)

    act(() => {
      result.current.loadMore()
    })
    expect(loadNext).toHaveBeenCalledTimes(1)
  })

  it('auto-loads the next page when loadAll is enabled', async () => {
    const loadNext = vi.fn()
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteReturn({
        pages: [{ items: [{ id: 's-1', name: 'Session 1' }], nextCursor: 'c1' }],
        hasNext: true,
        loadNext
      }) as never
    )

    renderHook(() => useSessions('agent-1', { loadAll: true }))
    await act(async () => {})

    expect(loadNext).toHaveBeenCalledTimes(1)
  })

  it('does not auto-load more pages by default', async () => {
    const loadNext = vi.fn()
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteReturn({
        pages: [{ items: [{ id: 's-1', name: 'Session 1' }], nextCursor: 'c1' }],
        hasNext: true,
        loadNext
      }) as never
    )

    renderHook(() => useSessions('agent-1'))
    await act(async () => {})

    expect(loadNext).not.toHaveBeenCalled()
  })

  it('loadMore is a no-op when hasMore is false', async () => {
    const loadNext = vi.fn()
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteReturn({
        pages: [{ items: [{ id: 's-1', name: 'Session 1' }] }],
        hasNext: false,
        loadNext
      }) as never
    )

    const { result } = renderHook(() => useSessions('agent-1'))
    await act(async () => {})

    act(() => {
      result.current.loadMore()
    })
    expect(loadNext).not.toHaveBeenCalled()
  })

  it('exposes hasMore from pagination', () => {
    mockUseInfiniteQuery.mockReturnValueOnce(
      buildInfiniteReturn({
        pages: [{ items: [], nextCursor: 'c1' }],
        hasNext: true
      }) as never
    )

    const { result } = renderHook(() => useSessions('agent-1'))

    expect(result.current.hasMore).toBe(true)
  })
})
