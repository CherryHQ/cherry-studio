import { MockUseDataApiUtils, mockUsePaginatedQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessions } from '../useSessions'

const buildPaginatedReturn = (overrides: Record<string, unknown> = {}) => ({
  items: [],
  total: 0,
  page: 1,
  isLoading: false,
  isRefreshing: false,
  error: undefined,
  hasNext: false,
  hasPrev: false,
  prevPage: vi.fn(),
  nextPage: vi.fn(),
  refresh: vi.fn(),
  reset: vi.fn(),
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
    mockUsePaginatedQuery.mockReset()
  })

  it('returns empty sessions when agentId is null', () => {
    MockUseDataApiUtils.mockPaginatedData('/agents/:agentId/sessions', [])

    const { result } = renderHook(() => useSessions(null))

    expect(result.current.sessions).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('returns sessions from page 1 results', async () => {
    const mockSessions = [
      { id: 's-1', name: 'Session 1' },
      { id: 's-2', name: 'Session 2' }
    ]
    MockUseDataApiUtils.mockPaginatedData('/agents/:agentId/sessions', mockSessions, { page: 1 })

    const { result } = renderHook(() => useSessions('agent-1'))

    await act(async () => {})

    expect(result.current.sessions).toEqual(mockSessions)
  })

  it('deduplicates and appends on page 2', async () => {
    const page1 = [
      { id: 's-1', name: 'Session 1' },
      { id: 's-2', name: 'Session 2' }
    ]
    const page2 = [
      { id: 's-2', name: 'Session 2' }, // duplicate — must be filtered
      { id: 's-3', name: 'Session 3' }
    ]

    MockUseDataApiUtils.mockPaginatedData('/agents/:agentId/sessions', page1, { page: 1 })
    const { result, rerender } = renderHook(() => useSessions('agent-1'))
    await act(async () => {})
    expect(result.current.sessions).toEqual(page1)

    // Simulate loading page 2
    MockUseDataApiUtils.mockPaginatedData('/agents/:agentId/sessions', page2, { page: 2 })
    rerender()
    await act(async () => {})

    const ids = result.current.sessions.map((s: any) => s.id)
    expect(ids).toContain('s-1')
    expect(ids).toContain('s-2')
    expect(ids).toContain('s-3')
    // s-2 should appear only once
    expect(ids.filter((id: string) => id === 's-2').length).toBe(1)
  })

  it('loadMore drives nextPage when hasMore is true', async () => {
    // Stable references across re-renders to avoid the [agentId, items, page]
    // effect re-firing on every render and triggering an infinite loop.
    const stableItems = [{ id: 's-1', name: 'Session 1' }]
    const nextPage = vi.fn()
    const stableReturn = buildPaginatedReturn({
      items: stableItems,
      total: 5,
      hasNext: true,
      nextPage
    })
    const emptyReturn = buildPaginatedReturn()
    mockUsePaginatedQuery.mockImplementation((queryPath: string) =>
      queryPath === '/agents/:agentId/sessions' ? stableReturn : emptyReturn
    )

    const { result } = renderHook(() => useSessions('agent-1'))
    await act(async () => {})
    expect(result.current.hasMore).toBe(true)

    act(() => {
      result.current.loadMore()
    })
    expect(nextPage).toHaveBeenCalledTimes(1)
  })

  it('loadMore is a no-op when hasMore is false', async () => {
    const stableItems = [{ id: 's-1', name: 'Session 1' }]
    const nextPage = vi.fn()
    const stableReturn = buildPaginatedReturn({
      items: stableItems,
      total: 1,
      hasNext: false,
      nextPage
    })
    const emptyReturn = buildPaginatedReturn()
    mockUsePaginatedQuery.mockImplementation((queryPath: string) =>
      queryPath === '/agents/:agentId/sessions' ? stableReturn : emptyReturn
    )

    const { result } = renderHook(() => useSessions('agent-1'))
    await act(async () => {})
    act(() => {
      result.current.loadMore()
    })
    expect(nextPage).not.toHaveBeenCalled()
  })

  it('resets loadedSessions when agentId changes', async () => {
    const sessions = [{ id: 's-1', name: 'Session 1' }]
    MockUseDataApiUtils.mockPaginatedData('/agents/:agentId/sessions', sessions, { page: 1 })

    const { result, rerender } = renderHook(({ agentId }) => useSessions(agentId), {
      initialProps: { agentId: 'agent-1' }
    })
    await act(async () => {})
    expect(result.current.sessions).toEqual(sessions)

    // Switch to a different agent with no sessions
    MockUseDataApiUtils.mockPaginatedData('/agents/:agentId/sessions', [])
    rerender({ agentId: 'agent-2' })
    await act(async () => {})

    expect(result.current.sessions).toEqual([])
  })

  it('exposes hasMore from pagination', () => {
    MockUseDataApiUtils.mockPaginatedData('/agents/:agentId/sessions', [], {
      hasNext: true
    })

    const { result } = renderHook(() => useSessions('agent-1'))

    expect(result.current.hasMore).toBe(true)
  })
})
