import { dataApiService } from '@renderer/data/DataApiService'
import { toast } from '@renderer/services/toast'
import type { AgentSessionEntity, AgentSessionListItem } from '@shared/data/api/schemas/agentSessions'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import {
  MockUseDataApiUtils,
  mockUseInfiniteQuery,
  mockUseInvalidateCache,
  mockUseMutation
} from '@test-mocks/renderer/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useActiveSession,
  useAgentSessionAutoRenameSync,
  useAgentSessionsByIds,
  useLatestSession,
  useSessions,
  useUpdateSession
} from '../useSession'

const mockCloseConversationTabs = vi.hoisted(() => vi.fn())
const mockUseIpcOn = vi.hoisted(() => vi.fn())

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

const workspace = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user' as const,
  orderKey: 'a0',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z'
}

const createSession = (overrides: Partial<AgentSessionListItem> = {}): AgentSessionListItem => ({
  id: 'session-1',
  agentId: 'agent-1',
  name: 'Session',
  description: undefined,
  workspaceId: workspace.id,
  workspace,
  orderKey: 'a0',
  pinId: null,
  pinned: false,
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

  it('reports loading-more while fetching after the first loaded page', () => {
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteReturn({
        pages: [{ items: [{ id: 's-1', name: 'Session 1' }], nextCursor: 'c1' }],
        hasNext: true,
        isRefreshing: true
      }) as never
    )

    const { result } = renderHook(() => useSessions('agent-1'))

    expect(result.current.isLoadingMore).toBe(true)
  })

  it('derives pin ids from the paged list projection', async () => {
    mockUseInfiniteQuery.mockReturnValue(
      buildInfiniteReturn({
        pages: [
          {
            items: [
              { id: 's-1', name: 'Session 1', pinId: 'pin-1', pinned: true },
              { id: 's-2', name: 'Session 2', pinId: null, pinned: false }
            ]
          }
        ]
      }) as never
    )

    const { result } = renderHook(() => useSessions('agent-1'))
    await act(async () => {})

    expect(result.current.pinIdBySessionId).toEqual(new Map([['s-1', 'pin-1']]))
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

  it('passes flat History filters through to the cursor query', () => {
    mockUseInfiniteQuery.mockReturnValueOnce(buildInfiniteReturn() as never)

    renderHook(() =>
      useSessions('unlinked', {
        ids: ['session-1'],
        pinned: false,
        q: 'needle',
        searchScope: 'full',
        sortBy: 'updatedAt'
      })
    )

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith('/agent-sessions', {
      continuityKey:
        '{"agentId":"unlinked","ids":["session-1"],"mode":"flat","pinned":false,"q":"needle","searchScope":"full"}',
      enabled: undefined,
      limit: 20,
      query: {
        agentId: 'unlinked',
        ids: ['session-1'],
        pinned: false,
        q: 'needle',
        searchScope: 'full',
        sortBy: 'updatedAt'
      },
      resetOnLocalWrite: '/agent-sessions',
      swrOptions: undefined
    })
  })

  it('builds a pin-owned query without the selected session sort', () => {
    mockUseInfiniteQuery.mockReturnValueOnce(buildInfiniteReturn() as never)

    renderHook(() =>
      useSessions('agent-1', {
        pinned: true,
        q: 'needle',
        searchScope: 'name',
        sortBy: 'updatedAt'
      })
    )

    expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
      '/agent-sessions',
      expect.objectContaining({
        continuityKey: '{"agentId":"agent-1","mode":"pinned","pinned":true,"q":"needle","searchScope":"name"}',
        query: {
          agentId: 'agent-1',
          pinned: true,
          q: 'needle',
          searchScope: 'name'
        }
      })
    )
  })

  it('creates a session through DataApi without a second list refresh', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const mockSession = {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'New session',
      description: 'Notes',
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/tmp/workspace',
        type: 'user',
        orderKey: 'a0',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      orderKey: 'a0',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
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
    expect(refresh).not.toHaveBeenCalled()
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

describe('useAgentSessionsByIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves runtime ids through bounded 200-id DataApi pages', async () => {
    const sessionIds = Array.from({ length: 201 }, (_, index) => `session-${String(index).padStart(3, '0')}`)
    vi.mocked(dataApiService.get).mockImplementation(async (_path, options) => {
      const ids = options?.query?.ids ?? []
      return {
        items: ids.map((id) => createSession({ id })),
        nextCursor: undefined
      } as never
    })

    const { result } = renderHook(() =>
      useAgentSessionsByIds(sessionIds, {
        agentId: '00000000-0000-4000-8000-000000000001',
        q: 'needle',
        searchScope: 'full'
      })
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(dataApiService.get).toHaveBeenCalledTimes(2)
    expect(vi.mocked(dataApiService.get).mock.calls[0][1]?.query).toMatchObject({
      ids: sessionIds.slice(0, 200),
      limit: 200,
      q: 'needle',
      searchScope: 'full',
      sortBy: 'updatedAt'
    })
    expect(vi.mocked(dataApiService.get).mock.calls[1][1]?.query).toMatchObject({
      ids: sessionIds.slice(200),
      limit: 200
    })
    expect(result.current.sessions).toHaveLength(201)
  })

  it('reapplies updatedAt order across bounded id request chunks', async () => {
    const sessionIds = Array.from({ length: 201 }, (_, index) => `session-${String(index).padStart(3, '0')}`)
    vi.mocked(dataApiService.get).mockImplementation(async (_path, options) => {
      const ids = options?.query?.ids ?? []
      return {
        items: ids.map((id) =>
          createSession({
            id,
            pinId: `pin-${id}`,
            pinned: true,
            updatedAt: id === 'session-200' ? '2025-01-01T00:00:00Z' : '2024-01-01T00:00:00Z'
          })
        ),
        nextCursor: undefined
      } as never
    })

    const { result } = renderHook(() => useAgentSessionsByIds(sessionIds))

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(dataApiService.get).toHaveBeenCalledTimes(2)
    expect(vi.mocked(dataApiService.get).mock.calls[0][1]?.query).not.toHaveProperty('pinned')
    expect(vi.mocked(dataApiService.get).mock.calls[0][1]?.query).toMatchObject({ sortBy: 'updatedAt' })
    expect(result.current.sessions[0]?.id).toBe('session-200')
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
    const mockResult = {
      id: 'session-1',
      agentId: 'agent-2',
      name: 'Session',
      orderKey: 'a0',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
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
    const mockResult = {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'New name',
      orderKey: 'a0',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
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

  it('updates when called with no agentId (composer path) — only an explicit null gates', async () => {
    const mockResult = {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'New name',
      orderKey: 'a0',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
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
    const mockResult = {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'New name',
      orderKey: 'a0',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
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
    const mockResult = {
      id: 's1',
      agentId: 'a1',
      name: 'S',
      orderKey: 'a0',
      createdAt: '',
      updatedAt: ''
    }
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
      if (event === 'ai.agent_session_auto_renamed') emitAutoRenamed = handler
    })
    const invalidate = vi.fn().mockResolvedValue(undefined)
    mockUseInvalidateCache.mockReturnValue(invalidate)

    renderHook(() => useAgentSessionAutoRenameSync())

    expect(mockUseIpcOn).toHaveBeenCalledWith('ai.agent_session_auto_renamed', expect.any(Function))
    act(() => {
      emitAutoRenamed?.({ sessionId: 'session-1' })
    })

    expect(invalidate).toHaveBeenCalledWith(['/agent-sessions', '/agent-sessions/session-1'])
  })
})
