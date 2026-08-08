import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentMutations, useAgentMutationsById } from '../agentAdapter'

const triggerMock = vi.hoisted(() => vi.fn())
const useMutationMock = vi.hoisted(() => vi.fn())
const invalidateMock = vi.hoisted(() => vi.fn())
const ipcRequestMock = vi.hoisted(() => vi.fn())

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => invalidateMock,
  useMutation: useMutationMock,
  useQuery: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequestMock } }))

describe('useAgentMutationsById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMutationMock.mockReturnValue({
      trigger: triggerMock,
      isLoading: false,
      error: undefined
    })
  })

  it('refreshes agent list and details after scoped mutations', () => {
    renderHook(() => useAgentMutationsById('agent-1'))

    expect(useMutationMock).toHaveBeenCalledWith('PATCH', '/agents/agent-1', {
      refresh: expect.any(Function)
    })
    expect(useMutationMock).toHaveBeenCalledWith('DELETE', '/agents/agent-1', {
      refresh: ['/agents', '/agents/*', '/pins']
    })
  })

  it('additionally refreshes /skills only when the PATCH body includes skillUpdates', () => {
    renderHook(() => useAgentMutationsById('agent-1'))

    const patchCall = useMutationMock.mock.calls.find(([method]) => method === 'PATCH')
    const refresh = patchCall?.[2].refresh as (ctx: { args?: { body?: object } }) => string[]

    expect(refresh({ args: { body: { name: 'Renamed' } } })).toEqual(['/agents', '/agents/agent-1'])
    expect(refresh({ args: { body: { skillUpdates: [{ skillId: 'skill-1', isEnabled: true }] } } })).toEqual([
      '/agents',
      '/agents/agent-1',
      '/skills'
    ])
    expect(refresh({ args: { body: { skillUpdates: [] } } })).toEqual(['/agents', '/agents/agent-1', '/skills'])
    expect(refresh({ args: undefined })).toEqual(['/agents', '/agents/agent-1'])
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
