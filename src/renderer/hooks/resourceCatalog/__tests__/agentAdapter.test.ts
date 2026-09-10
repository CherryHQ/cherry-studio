import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentAdapter, useAgentMutations, useAgentMutationsById } from '../agentAdapter'

const triggerMock = vi.hoisted(() => vi.fn())
const useMutationMock = vi.hoisted(() => vi.fn())
const useQueryMock = vi.hoisted(() => vi.fn())
const invalidateMock = vi.hoisted(() => vi.fn())
const ipcRequestMock = vi.hoisted(() => vi.fn())
const hiddenBuiltinVisibilityMock = vi.hoisted(() => ({ ids: [] as string[], isLoading: false }))

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => invalidateMock,
  useMutation: useMutationMock,
  useQuery: useQueryMock
}))

vi.mock('@renderer/hooks/agent/useBuiltinAgentListVisibility', () => ({
  useBuiltinAgentListVisibility: () => {
    const isHiddenBuiltin = (agent: { id: string; configuration?: { builtin_role?: string } }) =>
      hiddenBuiltinVisibilityMock.ids.includes(agent.id) &&
      ['assistant', 'support'].includes(agent.configuration?.builtin_role ?? '')

    return {
      filterHiddenBuiltinAgents: <T extends { id: string; configuration?: { builtin_role?: string } }>(agents: T[]) =>
        agents.filter(isHiddenBuiltin),
      hasHiddenBuiltinAgents: hiddenBuiltinVisibilityMock.ids.length > 0,
      isLoading: hiddenBuiltinVisibilityMock.isLoading
    }
  }
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequestMock } }))

describe('agentAdapter.useList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hiddenBuiltinVisibilityMock.ids = []
    hiddenBuiltinVisibilityMock.isLoading = false
  })

  it('includes hidden protected built-ins omitted from the main catalog page', () => {
    hiddenBuiltinVisibilityMock.ids = ['cherry-support']
    useQueryMock.mockImplementation((_path: string, options: { query: { builtinRoles?: string[] } }) => ({
      data: {
        items: options.query.builtinRoles
          ? [
              {
                id: 'cherry-support',
                name: 'Cherry Support',
                configuration: { builtin_role: 'support' }
              }
            ]
          : [{ id: 'agent-1', name: 'Agent', configuration: {} }]
      },
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn()
    }))

    const { result } = renderHook(() => agentAdapter.useList({ enabled: true }))

    expect(result.current.data.map((agent) => agent.id)).toEqual(['agent-1', 'cherry-support'])
  })

  it('keeps the primary catalog available when the supplemental hidden-agent query fails', () => {
    hiddenBuiltinVisibilityMock.ids = ['cherry-support']
    const supplementalError = new Error('supplemental query failed')
    useQueryMock.mockImplementation((_path: string, options: { query: { builtinRoles?: string[] } }) => ({
      data: options.query.builtinRoles ? undefined : { items: [{ id: 'agent-1', name: 'Agent', configuration: {} }] },
      isLoading: false,
      isRefreshing: false,
      error: options.query.builtinRoles ? supplementalError : undefined,
      refetch: vi.fn()
    }))

    const { result } = renderHook(() => agentAdapter.useList({ enabled: true }))

    expect(result.current.data.map((agent) => agent.id)).toEqual(['agent-1'])
    expect(result.current.error).toBeUndefined()
  })

  it('keeps the primary catalog visible while supplemental hidden-agent metadata loads', () => {
    hiddenBuiltinVisibilityMock.ids = ['cherry-support']
    useQueryMock.mockImplementation((_path: string, options: { query: { builtinRoles?: string[] } }) => ({
      data: options.query.builtinRoles ? undefined : { items: [{ id: 'agent-1', name: 'Agent', configuration: {} }] },
      isLoading: !!options.query.builtinRoles,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn()
    }))

    const { result } = renderHook(() => agentAdapter.useList({ enabled: true }))

    expect(result.current.data.map((agent) => agent.id)).toEqual(['agent-1'])
    expect(result.current.isLoading).toBe(false)
  })

  it('keeps the catalog loading until hidden built-in visibility is resolved', () => {
    hiddenBuiltinVisibilityMock.isLoading = true
    useQueryMock.mockReturnValue({
      data: { items: [{ id: 'cherry-support', name: 'Cherry Support', configuration: { builtin_role: 'support' } }] },
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn()
    })

    const { result } = renderHook(() => agentAdapter.useList({ enabled: true }))

    expect(result.current.isLoading).toBe(true)
  })

  it('recovers a hidden protected built-in after the Agent API limit of stale ids', () => {
    hiddenBuiltinVisibilityMock.ids = [
      ...Array.from({ length: AGENTS_MAX_LIMIT }, (_, index) => `stale-${index}`),
      'builtin-assistant'
    ]
    useQueryMock.mockImplementation(
      (_path: string, options: { query: { builtinRoles?: string[]; ids?: string[] } }) => ({
        data: {
          items: options.query.builtinRoles
            ? [
                {
                  id: 'builtin-assistant',
                  name: 'Cherry Assistant',
                  configuration: { builtin_role: 'assistant' }
                }
              ]
            : options.query.ids
              ? []
              : [{ id: 'agent-1', name: 'Agent', configuration: {} }]
        },
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn()
      })
    )

    const { result } = renderHook(() => agentAdapter.useList({ enabled: true }))

    expect(result.current.data.map((agent) => agent.id)).toEqual(['agent-1', 'builtin-assistant'])
  })
})

describe('useAgentMutationsById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMutationMock.mockReturnValue({
      trigger: triggerMock,
      isLoading: false,
      error: undefined
    })
  })

  it('uses DataApi only for the scoped update mutation', () => {
    renderHook(() => useAgentMutationsById('agent-1'))

    expect(useMutationMock).toHaveBeenCalledWith('PATCH', '/agents/agent-1', {
      refresh: expect.any(Function)
    })
    expect(useMutationMock).toHaveBeenCalledTimes(1)
  })

  it('deletes built-in and user agents through the registered IpcApi command', async () => {
    ipcRequestMock.mockResolvedValue({ deleted: true })
    invalidateMock.mockResolvedValue(undefined)
    const { result } = renderHook(() => useAgentMutationsById('cherry-support'))

    await act(() => result.current.deleteAgent())

    expect(ipcRequestMock).toHaveBeenCalledWith('ai.agent.delete', {
      agentId: 'cherry-support',
      deleteSessions: false
    })
    expect(invalidateMock).toHaveBeenCalledWith([
      '/agents',
      '/agents/cherry-support',
      '/agent-sessions',
      '/agent-channels',
      '/pins'
    ])
  })

  it('does not hide a committed deletion when cache refresh fails', async () => {
    ipcRequestMock.mockResolvedValue({ deleted: true })
    invalidateMock.mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => useAgentMutationsById('agent-1'))

    await expect(act(() => result.current.deleteAgent())).resolves.toBeUndefined()
  })

  it('additionally refreshes /skills only when the PATCH body includes skillUpdates', () => {
    renderHook(() => useAgentMutationsById('agent-1'))

    const patchCall = useMutationMock.mock.calls.find(([method]) => method === 'PATCH')
    const refresh = patchCall?.[2].refresh as (ctx: { args?: { body?: object } }) => string[]

    expect(refresh({ args: { body: { name: 'Renamed' } } })).toEqual(['/agents', '/agents/*'])
    expect(refresh({ args: { body: { skillUpdates: [{ skillId: 'skill-1', isEnabled: true }] } } })).toEqual([
      '/agents',
      '/agents/*',
      '/skills'
    ])
    expect(refresh({ args: { body: { skillUpdates: [] } } })).toEqual(['/agents', '/agents/*', '/skills'])
    expect(refresh({ args: undefined })).toEqual(['/agents', '/agents/*'])
  })
})

describe('useAgentMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateMock.mockResolvedValue(undefined)
  })

  it('creates through IpcApi and then invalidates the DataApi list', async () => {
    const dto = {
      name: 'Agent',
      model: 'anthropic::claude-3' as const,
      type: 'claude-code' as const
    }
    const created = { id: 'agent-1', ...dto }
    ipcRequestMock.mockResolvedValue(created)

    const { result } = renderHook(() => useAgentMutations())

    await act(async () => {
      await expect(result.current.createAgent(dto)).resolves.toEqual(created)
    })

    expect(ipcRequestMock).toHaveBeenCalledWith('ai.agent.create', dto)
    expect(invalidateMock).toHaveBeenCalledWith('/agents')
    expect(ipcRequestMock.mock.invocationCallOrder[0]).toBeLessThan(invalidateMock.mock.invocationCallOrder[0])
  })

  it('keeps a committed IPC creation successful when list invalidation fails', async () => {
    const dto = {
      name: 'Agent',
      model: 'anthropic::claude-3' as const,
      type: 'claude-code' as const
    }
    const created = { id: 'agent-1', ...dto }
    ipcRequestMock.mockResolvedValue(created)
    invalidateMock.mockRejectedValueOnce(new Error('revalidation failed'))

    const { result } = renderHook(() => useAgentMutations())

    await act(async () => {
      await expect(result.current.createAgent(dto)).resolves.toEqual(created)
    })

    expect(result.current.isCreatingAgent).toBe(false)
  })

  it('releases the creating state and skips invalidation when IPC creation fails', async () => {
    const dto = {
      name: 'Agent',
      model: 'anthropic::claude-3' as const,
      type: 'claude-code' as const
    }
    let rejectCreate!: (error: Error) => void
    const pendingCreate = new Promise<never>((_, reject) => {
      rejectCreate = reject
    })
    ipcRequestMock.mockReturnValueOnce(pendingCreate)

    const { result } = renderHook(() => useAgentMutations())
    let createPromise!: Promise<unknown>

    act(() => {
      createPromise = result.current.createAgent(dto)
    })
    await waitFor(() => expect(result.current.isCreatingAgent).toBe(true))

    await act(async () => {
      rejectCreate(new Error('create failed'))
      await expect(createPromise).rejects.toThrow('create failed')
    })

    expect(result.current.isCreatingAgent).toBe(false)
    expect(invalidateMock).not.toHaveBeenCalled()
  })
})
