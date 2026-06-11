import { MockUseDataApiUtils, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessions, useUpdateSession } from '../useSession'

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
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(created).toBe(mockSession)
  })

  it('returns the created session when refreshing the session list fails', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('refresh failed'))
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

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(created).toBe(mockSession)
    expect(mockToast.error).toHaveBeenCalled()
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
    expect(mockToast.error).toHaveBeenCalled()
  })
})

describe('useUpdateSession', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('returns undefined when agentId is null', async () => {
    const { result } = renderHook(() => useUpdateSession(null))
    const updated = await act(async () => result.current.updateSession({ id: 'session-1' }))

    expect(updated).toBeUndefined()
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

    const { result } = renderHook(() => useUpdateSession('agent-1'))
    const updated = await act(async () => result.current.updateSession({ id: 'session-1', name: 'New name' }))

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { sessionId: 'session-1' },
      body: { name: 'New name' }
    })
    expect(updated).toBeDefined()
    expect(mockToast.success).toHaveBeenCalledWith('common.update_success')
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

    const { result } = renderHook(() => useUpdateSession('agent-1'))
    await act(async () => result.current.updateSession({ id: 'session-1' }, { showSuccessToast: false }))

    expect(mockToast.success).not.toHaveBeenCalled()
  })

  it('shows error toast and returns undefined on failure', async () => {
    const mockTrigger = vi.fn().mockRejectedValue(new Error('Update failed'))
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agent-sessions/:sessionId', mockTrigger)

    const { result } = renderHook(() => useUpdateSession('agent-1'))
    const updated = await act(async () => result.current.updateSession({ id: 'session-1' }))

    expect(updated).toBeUndefined()
    expect(mockToast.error).toHaveBeenCalled()
  })
})
