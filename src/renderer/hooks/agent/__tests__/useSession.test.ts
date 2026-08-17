import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import {
  MockUseDataApiUtils,
  mockUseInfiniteQuery,
  mockUseInvalidateCache,
  mockUseMutation,
  mockUseQuery
} from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useActiveSession,
  useAgentSessionAutoRenameSync,
  useLatestSession,
  useSessions,
  useUpdateSession
} from '../useSession'

const mockCloseConversationTabs = vi.hoisted(() => vi.fn())
const mockUseIpcOn = vi.hoisted(() => vi.fn())
const mockT = vi.hoisted(() => (key: string) => key)

vi.mock('@renderer/hooks/tab', () => ({
  useCloseConversationTabs: () => mockCloseConversationTabs
}))

vi.mock('@renderer/ipc', () => ({
  useIpcOn: mockUseIpcOn
}))

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
  useTranslation: () => ({ t: mockT })
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

const workspace = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user' as const,
  orderKey: 'a0',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z'
}

const createSession = (overrides: Partial<AgentSessionEntity> = {}): AgentSessionEntity => ({
  id: 'session-1',
  agentId: 'agent-1',
  name: 'Session',
  description: undefined,
  workspaceId: workspace.id,
  workspace,
  orderKey: 'a0',
  lastActivityAt: '2024-01-01T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
  isNameManuallyEdited: overrides.isNameManuallyEdited ?? false
})

describe('useActiveSession', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  const setActiveSessionId = vi.fn()

  it('ignores query data that does not match the active session id', () => {
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', {
      data: createSession({ id: 'session-1' }),
      isLoading: false
    })

    const { result } = renderHook(() => useActiveSession({ activeSessionId: 'session-2', setActiveSessionId }))

    expect(result.current.activeSessionId).toBe('session-2')
    expect(result.current.session).toBeUndefined()
    expect(result.current.sessionSource).toBe('none')
  })

  it('uses a matching pending session while the query catches up', () => {
    const pendingSession = createSession({ id: 'temp-session-1' })
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', {
      data: undefined,
      isLoading: true
    })

    const { result, rerender } = renderHook(
      ({ activeSessionId }) => useActiveSession({ activeSessionId, setActiveSessionId }),
      { initialProps: { activeSessionId: null as string | null } }
    )

    act(() => result.current.setActiveSession(pendingSession))
    expect(setActiveSessionId).toHaveBeenCalledWith('temp-session-1')
    rerender({ activeSessionId: 'temp-session-1' })

    expect(result.current.session).toBe(pendingSession)
    expect(result.current.sessionSource).toBe('pending')
    expect(result.current.isLoading).toBe(false)
  })

  it('uses a matching initial session that arrives after mount', () => {
    const initialSession = createSession({ id: 'session-1' })
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', {
      data: undefined,
      isLoading: true
    })

    const { result, rerender } = renderHook(
      ({ session }) => useActiveSession({ activeSessionId: 'session-1', setActiveSessionId, initialSession: session }),
      { initialProps: { session: null as AgentSessionEntity | null } }
    )

    expect(result.current.session).toBeUndefined()

    rerender({ session: initialSession })

    expect(result.current.session).toBe(initialSession)
    expect(result.current.sessionSource).toBe('pending')
    expect(result.current.isLoading).toBe(false)
  })

  it('does not serve an initial session after the canonical query reports not found', () => {
    const initialSession = createSession({ id: 'session-1' })
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', {
      data: undefined,
      error: DataApiErrorFactory.notFound('Agent session', 'session-1'),
      isLoading: false
    })

    const { result } = renderHook(() =>
      useActiveSession({ activeSessionId: 'session-1', setActiveSessionId, initialSession })
    )

    expect(result.current.session).toBeUndefined()
    expect(result.current.sessionSource).toBe('none')
  })

  it('does not serve cached query data after the canonical query reports not found', () => {
    const cachedSession = createSession({ id: 'session-1' })
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', {
      data: cachedSession,
      error: DataApiErrorFactory.notFound('Agent session', 'session-1'),
      isLoading: false
    })

    const { result } = renderHook(() => useActiveSession({ activeSessionId: 'session-1', setActiveSessionId }))

    expect(result.current.session).toBeUndefined()
    expect(result.current.sessionSource).toBe('none')
  })

  it('does not serve an explicitly pending session after the canonical query reports not found', () => {
    const pendingSession = createSession({ id: 'session-1', name: 'Pending Session' })
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', {
      data: undefined,
      error: DataApiErrorFactory.notFound('Agent session', 'session-1'),
      isLoading: false
    })

    const { result, rerender } = renderHook(
      ({ activeSessionId }) => useActiveSession({ activeSessionId, setActiveSessionId }),
      { initialProps: { activeSessionId: null as string | null } }
    )

    act(() => result.current.setActiveSession(pendingSession))
    rerender({ activeSessionId: 'session-1' })

    expect(result.current.session).toBeUndefined()
    expect(result.current.sessionSource).toBe('none')
  })

  it('keeps an initial session available after a transient query error', () => {
    const initialSession = createSession({ id: 'session-1' })
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', {
      data: undefined,
      error: new Error('temporarily unavailable'),
      isLoading: false
    })

    const { result } = renderHook(() =>
      useActiveSession({ activeSessionId: 'session-1', setActiveSessionId, initialSession })
    )

    expect(result.current.session).toBe(initialSession)
    expect(result.current.sessionSource).toBe('pending')
  })

  it('prefers matching query data over a pending session', () => {
    const querySession = createSession({ id: 'session-1' })
    const pendingSession = createSession({ id: 'session-1', name: 'Pending Session' })
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', {
      data: querySession,
      isLoading: false
    })

    const { result, rerender } = renderHook(
      ({ activeSessionId }) => useActiveSession({ activeSessionId, setActiveSessionId }),
      { initialProps: { activeSessionId: null as string | null } }
    )

    act(() => result.current.setActiveSession(pendingSession))
    rerender({ activeSessionId: 'session-1' })

    expect(result.current.session).toBe(querySession)
    expect(result.current.sessionSource).toBe('query')
  })

  it('ignores a pending session left over from a previous active id', () => {
    const pendingSession = createSession({ id: 'temp-session-1' })
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', {
      data: undefined,
      isLoading: false
    })

    const { result, rerender } = renderHook(
      ({ activeSessionId }) => useActiveSession({ activeSessionId, setActiveSessionId }),
      { initialProps: { activeSessionId: 'temp-session-1' as string | null } }
    )

    act(() => result.current.setActiveSession(pendingSession))
    // Move to an unrelated id without touching pending: the stale pending must not resolve.
    rerender({ activeSessionId: 'session-9' })

    expect(result.current.session).toBeUndefined()
    expect(result.current.sessionSource).toBe('none')
  })

  it('clearActiveSession clears the active id', () => {
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: undefined, isLoading: false })

    const { result } = renderHook(() => useActiveSession({ activeSessionId: 'session-1', setActiveSessionId }))

    act(() => result.current.clearActiveSession())
    expect(setActiveSessionId).toHaveBeenCalledWith(null)
  })
})

describe('useSessions', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('disables loaded-page revalidation while a load-all session chain is still growing', () => {
    renderHook(() => useSessions(undefined, { loadAll: true, pageSize: 200 }))

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/agent-sessions', {
      query: undefined,
      limit: 200,
      enabled: undefined,
      swrOptions: { revalidateAll: false, revalidateFirstPage: false }
    })
  })

  it('flips revalidateAll on once a load-all session chain is fully loaded', () => {
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteReturn({
        pages: [{ items: [{ id: 'session-a', name: 'S' }] }],
        hasNext: false
      }) as never
    )

    renderHook(() => useSessions(undefined, { loadAll: true, pageSize: 200 }))

    expect(mockUseInfiniteQuery).toHaveBeenLastCalledWith('/agent-sessions', {
      query: undefined,
      limit: 200,
      enabled: undefined,
      swrOptions: { revalidateAll: true, revalidateFirstPage: false }
    })
  })

  it('keeps progressive session sources on first-page revalidation', () => {
    renderHook(() => useSessions(undefined))

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/agent-sessions', {
      query: undefined,
      limit: 20,
      enabled: undefined,
      swrOptions: { revalidateAll: false, revalidateFirstPage: true }
    })
  })

  it('does not revalidate previously loaded pages while the load-all session chain grows', () => {
    // Simulate a multi-page loadAll: each render grows `pages` by one and
    // keeps `hasNext` true until the final page. The auto-paginate effect
    // drives `loadNext`; we assert that across every growth render the
    // loaded-page revalidation stays disabled: `revalidateAll` prevents a
    // quadratic re-fetch of earlier pages, while `revalidateFirstPage`
    // prevents one redundant page-0 request per `loadNext`.
    const loadNext = vi.fn()
    let pages: Array<{ items: Array<{ id: string; name: string }>; nextCursor?: string }> = [
      { items: [{ id: 's1', name: 'S1' }], nextCursor: 'c1' }
    ]
    let hasNext = true

    mockUseInfiniteQuery.mockImplementation(
      () =>
        buildInfiniteReturn({
          pages,
          hasNext,
          loadNext
        }) as never
    )

    const { rerender } = renderHook(() => useSessions('agent-1', { loadAll: true, pageSize: 1 }))

    // Page 1 → 2
    pages = [...pages, { items: [{ id: 's2', name: 'S2' }], nextCursor: 'c2' }]
    act(() => rerender())
    // Page 2 → 3 (final)
    pages = [...pages, { items: [{ id: 's3', name: 'S3' }] }]
    hasNext = false
    act(() => rerender())

    // The auto-paginate effect drives loadNext; the key regression check is
    // that neither previous pages nor page 0 are revalidated during growth.
    expect(loadNext).toHaveBeenCalled()

    // All calls during growth (every call except the final post-fully-loaded
    // re-render where the effect flips revalidateAll on) must keep both
    // growth-time revalidation modes off.
    const growthCalls = mockUseInfiniteQuery.mock.calls.slice(0, -1)
    expect(growthCalls.length).toBeGreaterThan(0)
    for (const call of growthCalls) {
      expect(call[1]).toMatchObject({ swrOptions: { revalidateAll: false, revalidateFirstPage: false } })
    }
    // The final call — after the chain is fully loaded — flips revalidateAll on.
    const lastCall = mockUseInfiniteQuery.mock.calls[mockUseInfiniteQuery.mock.calls.length - 1]
    expect(lastCall[1]).toMatchObject({ swrOptions: { revalidateAll: true, revalidateFirstPage: false } })
  })

  it('returns empty sessions when agentId is null', () => {
    mockUseInfiniteQuery.mockReturnValueOnce(buildInfiniteReturn() as never)

    const { result } = renderHook(() => useSessions(null))

    expect(result.current.sessions).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('disables both session and pin queries when the source is disabled', () => {
    mockUseInfiniteQuery.mockReturnValue(buildInfiniteReturn() as never)

    renderHook(() => useSessions(undefined, { enabled: false }))

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
      '/agent-sessions',
      expect.objectContaining({
        enabled: false
      })
    )
    expect(mockUseQuery).toHaveBeenCalledWith('/pins', {
      query: { entityType: 'session' },
      enabled: false
    })
  })

  it('refetches session pins after a pin membership notification', () => {
    const refetchPins = vi.fn().mockResolvedValue(undefined)
    MockUseDataApiUtils.mockQueryResult('/pins', {
      data: [],
      refetch: refetchPins
    })

    renderHook(() => useSessions('agent-1'))
    act(() => {
      MockUseDataApiUtils.emitDataChange([{ endpoint: '/pins', kind: 'membership' }])
    })

    expect(refetchPins).toHaveBeenCalledOnce()
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

  it('reuses deeply equal session entities by id while allowing their order to change', () => {
    const sessionA = createSession({ id: 'session-a', name: 'Session A' })
    const sessionB = createSession({ id: 'session-b', name: 'Session B' })
    let pages = [{ items: [sessionA, sessionB] }]
    mockUseInfiniteQuery.mockImplementation(() => buildInfiniteReturn({ pages }) as never)

    const { result, rerender } = renderHook(() => useSessions('agent-1'))
    const firstSessions = result.current.sessions

    pages = [
      {
        items: [
          { ...sessionB, workspace: { ...sessionB.workspace } },
          { ...sessionA, workspace: { ...sessionA.workspace } }
        ]
      }
    ]
    rerender()

    expect(result.current.sessions).not.toBe(firstSessions)
    expect(result.current.sessions[0]).toBe(firstSessions[1])
    expect(result.current.sessions[1]).toBe(firstSessions[0])

    const reorderedSessions = result.current.sessions
    pages = [
      {
        items: [
          { ...sessionB, name: 'Renamed Session B', workspace: { ...sessionB.workspace } },
          { ...sessionA, workspace: { ...sessionA.workspace } }
        ]
      }
    ]
    rerender()

    expect(result.current.sessions[0]).not.toBe(reorderedSessions[0])
    expect(result.current.sessions[1]).toBe(reorderedSessions[1])
  })

  it('keeps togglePin stable while reading the latest pin map', async () => {
    const pinTrigger = vi.fn().mockResolvedValue(undefined)
    const unpinTrigger = vi.fn().mockResolvedValue(undefined)
    const defaultTrigger = vi.fn().mockResolvedValue(undefined)
    const pin = {
      id: 'pin-session-a',
      entityType: 'session' as const,
      entityId: 'session-a',
      orderKey: 'a0',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
    let pins: (typeof pin)[] = []
    const infiniteReturn = buildInfiniteReturn()
    mockUseInfiniteQuery.mockReturnValue(infiniteReturn as never)
    mockUseQuery.mockImplementation((path: string) => ({
      data: path === '/pins' ? pins : undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue(undefined)
    }))
    mockUseMutation.mockImplementation((method: string, path: string) => ({
      trigger:
        method === 'POST' && path === '/pins'
          ? pinTrigger
          : method === 'DELETE' && path === '/pins/:id'
            ? unpinTrigger
            : defaultTrigger,
      isLoading: false,
      error: undefined
    }))

    const { result, rerender } = renderHook(() => useSessions('agent-1'))
    const initialTogglePin = result.current.togglePin

    pins = [pin]
    rerender()

    expect(result.current.togglePin).toBe(initialTogglePin)
    await act(async () => result.current.togglePin('session-a'))
    expect(unpinTrigger).toHaveBeenCalledWith({ params: { id: pin.id } })
    expect(pinTrigger).not.toHaveBeenCalled()
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

  it('exposes full-load and pin-loading state for grouped sidebars', async () => {
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteReturn({
        pages: [{ items: [{ id: 's-1', name: 'Session 1' }], nextCursor: 'c1' }],
        hasNext: true
      }) as never
    )
    MockUseDataApiUtils.mockQueryResult('/pins', {
      data: [],
      isLoading: true
    })

    const { result } = renderHook(() => useSessions('agent-1', { loadAll: true }))
    await act(async () => {})

    expect(result.current.isFullyLoaded).toBe(false)
    expect(result.current.isLoadingAll).toBe(true)
    expect(result.current.isPinsLoading).toBe(true)
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

  it('creates a session through DataApi and refreshes the session list', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const mockSession = createSession({
      name: 'New session',
      description: 'Notes'
    })
    const createTrigger = vi.fn().mockResolvedValueOnce(mockSession)
    mockUseInfiniteQuery.mockReturnValue(buildInfiniteReturn({ refresh }) as never)
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/agent-sessions', createTrigger)

    const { result } = renderHook(() => useSessions('agent-1'))
    const created = await act(async () =>
      result.current.createSession({
        name: 'New session',
        description: 'Notes',
        workspace: { type: 'user', workspaceId: 'workspace-1' }
      })
    )

    expect(createTrigger).toHaveBeenCalledWith({
      body: {
        agentId: 'agent-1',
        name: 'New session',
        description: 'Notes',
        workspace: { type: 'user', workspaceId: 'workspace-1' }
      }
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(created).toBe(mockSession)
  })

  it('deletes a session and closes the matching agent conversation tab', async () => {
    const deleteTrigger = vi.fn().mockResolvedValue(undefined)
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/agent-sessions/:sessionId', deleteTrigger)

    const { result } = renderHook(() => useSessions('agent-1'))
    const deleted = await act(async () => result.current.deleteSession('session-a'))

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { sessionId: 'session-a' } })
    expect(mockCloseConversationTabs).toHaveBeenCalledWith('agents', ['session-a'])
    expect(deleted).toBe(true)
  })

  it('deletes selected sessions through comma-separated query ids', async () => {
    const response = { deletedIds: ['session-a', 'session-b'], deletedCount: 2 }
    const deleteTrigger = vi.fn().mockResolvedValue(response)
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/agent-sessions', deleteTrigger)

    const { result } = renderHook(() => useSessions('agent-1'))
    const deleted = await act(async () => result.current.deleteSessions(['session-a', 'session-b']))

    expect(deleteTrigger).toHaveBeenCalledWith({ query: { ids: 'session-a,session-b' } })
    expect(mockCloseConversationTabs).toHaveBeenCalledWith('agents', response.deletedIds)
    expect(deleted).toBe(response)
  })

  it('returns the created session when refreshing the session list fails', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('refresh failed'))
    const mockSession = createSession({
      name: 'New session',
      description: 'Notes'
    })
    const createTrigger = vi.fn().mockResolvedValueOnce(mockSession)
    mockUseInfiniteQuery.mockReturnValue(buildInfiniteReturn({ refresh }) as never)
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/agent-sessions', createTrigger)

    const { result } = renderHook(() => useSessions('agent-1'))
    const created = await act(async () =>
      result.current.createSession({
        name: 'New session',
        description: 'Notes',
        workspace: { type: 'user', workspaceId: 'workspace-1' }
      })
    )

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(created).toBe(mockSession)
    expect(toast.error).toHaveBeenCalled()
  })

  it('shows an error toast and returns null when DataApi session creation fails', async () => {
    mockUseInfiniteQuery.mockReturnValue(buildInfiniteReturn() as never)
    const createTrigger = vi.fn().mockRejectedValueOnce(new Error('create failed'))
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/agent-sessions', createTrigger)

    const { result } = renderHook(() => useSessions('agent-1'))
    const created = await act(async () =>
      result.current.createSession({ name: 'New session', workspace: { type: 'system' } })
    )

    expect(created).toBeNull()
    expect(toast.error).toHaveBeenCalled()
  })
})

describe('useLatestSession', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('keeps first-entry restore gated while cached latest session is revalidating', () => {
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/latest', {
      data: { session: createSession({ id: 'session-latest' }) } as never,
      isRefreshing: true
    })

    const { result } = renderHook(() => useLatestSession())

    expect(result.current.latestSession?.id).toBe('session-latest')
    expect(result.current.isLoading).toBe(true)
  })
})

describe('useUpdateSession', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('updates sessions even when the previous agentId is null', async () => {
    const mockResult = createSession({ agentId: 'agent-2' })
    const mockTrigger = vi.fn().mockResolvedValue(mockResult)
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agent-sessions/:sessionId', mockTrigger)

    const { result } = renderHook(() => useUpdateSession())
    const updated = await act(async () =>
      result.current.updateSession({ id: 'session-1', agentId: 'agent-2' }, { showSuccessToast: false })
    )

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { sessionId: 'session-1' },
      body: { agentId: 'agent-2' }
    })
    expect(updated).toBe(mockResult)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('updates when called with no agentId (composer path) — only an explicit null gates', async () => {
    const mockResult = createSession({ name: 'New name' })
    const mockTrigger = vi.fn().mockResolvedValue(mockResult)
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agent-sessions/:sessionId', mockTrigger)

    const { result } = renderHook(() => useUpdateSession())
    const updated = await act(async () => result.current.updateSession({ id: 'session-1', name: 'New name' }))

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { sessionId: 'session-1' },
      body: { name: 'New name' }
    })
    expect(updated).toEqual(mockResult)
  })

  it('calls updateTrigger with sessionId-only params and returns session', async () => {
    const mockResult = createSession({ name: 'New name' })
    const mockTrigger = vi.fn().mockResolvedValue(mockResult)
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agent-sessions/:sessionId', mockTrigger)

    const { result } = renderHook(() => useUpdateSession())
    const updated = await act(async () => result.current.updateSession({ id: 'session-1', name: 'New name' }))

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { sessionId: 'session-1' },
      body: { name: 'New name' }
    })
    expect(updated).toBeDefined()
    expect(toast.success).toHaveBeenCalledWith('common.update_success')
  })

  it('keeps the session PATCH refresh scoped to session caches', () => {
    renderHook(() => useUpdateSession())

    const updateMutationCall = mockUseMutation.mock.calls.find(
      ([method, path]) => method === 'PATCH' && path === '/agent-sessions/:sessionId'
    )
    const refresh = updateMutationCall?.[2]?.refresh as (context: {
      args: { params: { sessionId: string }; body?: Record<string, unknown> }
      result: AgentSessionEntity
    }) => string[]

    expect(
      refresh({
        args: { params: { sessionId: 'session-1' }, body: { name: 'Renamed session' } },
        result: createSession()
      })
    ).toEqual(['/agent-sessions', '/agent-sessions/session-1'])
  })

  it('refreshes workspaces through the dedicated workspace mutation', async () => {
    const mockResult = createSession()
    const setWorkspaceTrigger = vi.fn().mockResolvedValue(mockResult)
    MockUseDataApiUtils.mockMutationWithTrigger('PUT', '/agent-sessions/:sessionId/workspace', setWorkspaceTrigger)

    const { result } = renderHook(() => useUpdateSession())
    const updated = await act(async () =>
      result.current.setSessionWorkspace('session-1', { type: 'user', workspaceId: 'workspace-1' })
    )

    expect(setWorkspaceTrigger).toHaveBeenCalledWith({
      params: { sessionId: 'session-1' },
      body: { type: 'user', workspaceId: 'workspace-1' }
    })
    expect(updated).toBe(mockResult)

    const workspaceMutationCall = mockUseMutation.mock.calls.find(
      ([method, path]) => method === 'PUT' && path === '/agent-sessions/:sessionId/workspace'
    )
    const refresh = workspaceMutationCall?.[2]?.refresh as (context: {
      args: { params: { sessionId: string } }
    }) => string[]
    expect(refresh({ args: { params: { sessionId: 'session-1' } } })).toEqual([
      '/agent-sessions',
      '/agent-sessions/session-1',
      '/agent-workspaces'
    ])
  })

  it('does not show success toast when showSuccessToast is false', async () => {
    const mockResult = createSession({ id: 's1', agentId: 'a1', name: 'S', createdAt: '', updatedAt: '' })
    const mockTrigger = vi.fn().mockResolvedValue(mockResult)
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agent-sessions/:sessionId', mockTrigger)

    const { result } = renderHook(() => useUpdateSession())
    await act(async () => result.current.updateSession({ id: 'session-1' }, { showSuccessToast: false }))

    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows error toast and returns undefined on failure', async () => {
    const mockTrigger = vi.fn().mockRejectedValue(new Error('Update failed'))
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agent-sessions/:sessionId', mockTrigger)

    const { result } = renderHook(() => useUpdateSession())
    const updated = await act(async () => result.current.updateSession({ id: 'session-1' }))

    expect(updated).toBeUndefined()
    expect(toast.error).toHaveBeenCalled()
  })
})

describe('useAgentSessionAutoRenameSync', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('invalidates agent session list and detail caches when a session is auto-renamed', () => {
    let emitAutoRenamed: ((payload: { sessionId: string }) => void) | undefined
    mockUseIpcOn.mockImplementation((event: string, handler: (payload: { sessionId: string }) => void) => {
      if (event === 'ai.agent.session.auto_renamed') emitAutoRenamed = handler
    })
    const invalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockReturnValue(invalidate)

    renderHook(() => useAgentSessionAutoRenameSync())

    expect(mockUseIpcOn).toHaveBeenCalledWith('ai.agent.session.auto_renamed', expect.any(Function))
    act(() => {
      emitAutoRenamed?.({ sessionId: 'session-1' })
    })

    expect(invalidate).toHaveBeenCalledWith(['/agent-sessions', '/agent-sessions/session-1'])
  })
})
