import { useQuery } from '@data/hooks/useDataApi'
import { toast } from '@renderer/services/toast'
import { MockUseDataApiUtils, mockUseInvalidateCache } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgent, useAgents, useUpdateAgent } from '../useAgent'

const { ipcRequestMock } = vi.hoisted(() => ({ ipcRequestMock: vi.fn() }))
const invalidateSpy = vi.fn(async () => {})

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: ipcRequestMock,
    on: vi.fn(() => () => undefined)
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('useAgent', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('does not fetch when id is null', () => {
    const mockUseQuery = vi.mocked(useQuery)
    MockUseDataApiUtils.mockQueryResult('/agents/:agentId', { data: undefined })

    const { result } = renderHook(() => useAgent(null))

    expect(result.current.agent).toBeUndefined()
    expect(mockUseQuery).toHaveBeenCalledWith('/agents/:agentId', expect.objectContaining({ enabled: false }))
    expect(mockUseQuery).not.toHaveBeenCalledWith('/mcp-servers', expect.anything())
  })

  it('fetches agent when id is provided', () => {
    const mockUseQuery = vi.mocked(useQuery)
    const mockAgent = {
      id: 'agent-1',
      name: 'Test Agent',
      model: 'claude-3',
      type: 'claude-code',
      configuration: { permission_mode: 'default', env_vars: {} },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
    MockUseDataApiUtils.mockQueryResult('/agents/:agentId', { data: mockAgent as any })

    const { result } = renderHook(() => useAgent('agent-1'))

    expect(result.current.agent).toBeDefined()
    expect(result.current.agent?.id).toBe('agent-1')
    expect(result.current.agent).not.toHaveProperty('tools')
    expect(result.current.isLoading).toBe(false)
    expect(mockUseQuery).toHaveBeenCalledWith(
      '/agents/:agentId',
      expect.objectContaining({
        enabled: true,
        swrOptions: expect.objectContaining({ keepPreviousData: false })
      })
    )
    expect(mockUseQuery).not.toHaveBeenCalledWith('/mcp-servers', expect.anything())
  })

  it('parses configuration through AgentConfigurationSchema preserving known and unknown fields', () => {
    const mockAgent = {
      id: 'agent-1',
      name: 'Test Agent',
      model: 'claude-3',
      type: 'claude-code',
      configuration: { avatar: '🤖', reasoning_effort: 'high' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
    MockUseDataApiUtils.mockQueryResult('/agents/:agentId', { data: mockAgent as any })

    const { result } = renderHook(() => useAgent('agent-1'))

    // Known field preserved; optional fields not explicitly set remain undefined
    expect(result.current.agent?.configuration?.avatar).toBe('🤖')
    expect(result.current.agent?.configuration?.reasoning_effort).toBe('high')
    expect(result.current.agent?.configuration?.permission_mode).toBeUndefined()
  })

  it('drops type-mismatched keys but preserves valid sibling keys when persisted configuration is malformed', () => {
    const mockAgent = {
      id: 'agent-1',
      name: 'Test Agent',
      model: 'claude-3',
      type: 'claude-code',
      // permission_mode/reasoning_effort 'invalid' fail enum checks; env_vars/null fails record check.
      // heartbeat_interval/200 is well-typed and must survive.
      configuration: {
        permission_mode: 'invalid',
        reasoning_effort: 'invalid',
        env_vars: null,
        heartbeat_interval: 200
      },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
    MockUseDataApiUtils.mockQueryResult('/agents/:agentId', { data: mockAgent as any })

    const { result } = renderHook(() => useAgent('agent-1'))

    // Bad keys are stripped so callers' `?? DEFAULT` fallbacks fire normally;
    // valid keys round-trip unchanged.
    expect(result.current.agent?.configuration).toEqual({ heartbeat_interval: 200 })
  })

  it('returns loading state correctly', () => {
    MockUseDataApiUtils.mockQueryLoading('/agents/:agentId')

    const { result } = renderHook(() => useAgent('agent-1'))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.agent).toBeUndefined()
  })

  it('exposes refetch as revalidate', () => {
    const mockRefetch = vi.fn().mockResolvedValue(undefined)
    MockUseDataApiUtils.mockQueryResult('/agents/:agentId', { data: undefined, refetch: mockRefetch })

    const { result } = renderHook(() => useAgent('agent-1'))

    void result.current.revalidate()
    expect(mockRefetch).toHaveBeenCalled()
  })
})

describe('useAgents', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
    mockUseInvalidateCache.mockReturnValue(invalidateSpy)
  })

  describe('agents list', () => {
    it('returns empty array when data is undefined', () => {
      MockUseDataApiUtils.mockQueryLoading('/agents')

      const { result } = renderHook(() => useAgents())
      expect(result.current.agents).toEqual([])
      expect(result.current.isLoading).toBe(true)
    })

    it('returns agents from data.items', () => {
      const mockAgents = [
        { id: 'agent-1', name: 'Agent 1', model: 'anthropic::claude-3' },
        { id: 'agent-2', name: 'Agent 2', model: 'anthropic::claude-3' }
      ]
      MockUseDataApiUtils.mockQueryResult('/agents', {
        data: { items: mockAgents, total: 2, page: 1 } as any
      })

      const { result } = renderHook(() => useAgents())
      expect(result.current.agents).toEqual(mockAgents)
      expect(result.current.isLoading).toBe(false)
    })
  })

  describe('addAgent', () => {
    it('creates through IpcApi, invalidates the DataApi list, and shows success toast', async () => {
      const mockAgent = { id: 'new-agent', name: 'New Agent', model: 'anthropic::claude-3' }
      ipcRequestMock.mockResolvedValue(mockAgent)
      MockUseDataApiUtils.mockQueryResult('/agents', { data: { items: [], total: 0, page: 1 } as any })

      const { result } = renderHook(() => useAgents())
      const form = {
        name: 'New Agent',
        model: 'anthropic::claude-3' as const,
        type: 'claude-code' as const
      }
      const addResult = await act(async () => result.current.addAgent(form))

      expect(ipcRequestMock).toHaveBeenCalledWith('ai.agent.create', form)
      expect(invalidateSpy).toHaveBeenCalledWith('/agents')
      expect(addResult.success).toBe(true)
      if (addResult.success) {
        expect(addResult.data).toEqual(mockAgent)
      }
      expect(toast.success).toHaveBeenCalledWith('common.add_success')
    })

    it('returns failure result when IpcApi creation throws', async () => {
      const error = new Error('Create failed')
      ipcRequestMock.mockRejectedValue(error)
      MockUseDataApiUtils.mockQueryResult('/agents', { data: { items: [], total: 0, page: 1 } as any })

      const { result } = renderHook(() => useAgents())
      const addResult = await act(async () =>
        result.current.addAgent({
          name: 'New Agent',
          model: 'anthropic::claude-3',
          type: 'claude-code'
        })
      )

      expect(invalidateSpy).not.toHaveBeenCalled()
      expect(addResult.success).toBe(false)
      expect(toast.error).toHaveBeenCalled()
    })

    it('returns the committed Agent when list invalidation fails', async () => {
      const mockAgent = { id: 'new-agent', name: 'New Agent', model: 'anthropic::claude-3' }
      ipcRequestMock.mockResolvedValue(mockAgent)
      invalidateSpy.mockRejectedValueOnce(new Error('revalidation failed'))
      MockUseDataApiUtils.mockQueryResult('/agents', { data: { items: [], total: 0, page: 1 } as any })

      const { result } = renderHook(() => useAgents())
      const addResult = await act(async () =>
        result.current.addAgent({
          name: 'New Agent',
          model: 'anthropic::claude-3',
          type: 'claude-code'
        })
      )

      expect(addResult).toEqual({ success: true, data: mockAgent })
      expect(toast.success).toHaveBeenCalledWith('common.add_success')
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('deleteAgent', () => {
    it('calls deleteTrigger and shows success toast', async () => {
      const mockTrigger = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/agents/:agentId', mockTrigger)
      MockUseDataApiUtils.mockQueryResult('/agents', {
        data: {
          items: [
            { id: 'agent-1', name: 'A1' },
            { id: 'agent-2', name: 'A2' }
          ],
          total: 2,
          page: 1
        } as any
      })

      const { result } = renderHook(() => useAgents())
      await act(async () => result.current.deleteAgent('agent-1'))

      expect(mockTrigger).toHaveBeenCalledWith({ params: { agentId: 'agent-1' } })
      expect(toast.success).toHaveBeenCalledWith('common.delete_success')
    })

    it('shows error toast when deleteTrigger throws', async () => {
      const mockTrigger = vi.fn().mockRejectedValue(new Error('Delete failed'))
      MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/agents/:agentId', mockTrigger)
      MockUseDataApiUtils.mockQueryResult('/agents', { data: { items: [], total: 0, page: 1 } as any })

      const { result } = renderHook(() => useAgents())
      await act(async () => result.current.deleteAgent('agent-1'))

      expect(toast.error).toHaveBeenCalled()
    })
  })
})

describe('useUpdateAgent', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  describe('updateAgent', () => {
    it('calls updateTrigger and returns agent with defaults applied', async () => {
      const mockResult = {
        id: 'agent-1',
        name: 'Updated',
        model: 'claude-3',
        type: 'claude-code',
        configuration: { avatar: '🤖' },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
      const mockTrigger = vi.fn().mockResolvedValue(mockResult)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId', mockTrigger)

      const { result } = renderHook(() => useUpdateAgent())
      const updated = await act(async () => result.current.updateAgent({ id: 'agent-1', name: 'Updated' }))

      expect(mockTrigger).toHaveBeenCalledWith({ params: { agentId: 'agent-1' }, body: { name: 'Updated' } })
      expect(updated).toBeDefined()
      expect(updated?.id).toBe('agent-1')
      expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ key: 'update-agent' }))
    })

    it('does not show success toast when showSuccessToast is false', async () => {
      const mockResult = {
        id: 'agent-1',
        name: 'Updated',
        model: 'claude-3',
        type: 'claude-code',
        configuration: {},
        createdAt: '',
        updatedAt: ''
      }
      const mockTrigger = vi.fn().mockResolvedValue(mockResult)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId', mockTrigger)

      const { result } = renderHook(() => useUpdateAgent())
      await act(async () => result.current.updateAgent({ id: 'agent-1', name: 'Updated' }, { showSuccessToast: false }))

      expect(toast.success).not.toHaveBeenCalled()
    })

    it('shows error toast and returns undefined on failure', async () => {
      const mockTrigger = vi.fn().mockRejectedValue(new Error('Update failed'))
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId', mockTrigger)

      const { result } = renderHook(() => useUpdateAgent())
      const updated = await act(async () => result.current.updateAgent({ id: 'agent-1', name: 'Fail' }))

      expect(updated).toBeUndefined()
      expect(toast.error).toHaveBeenCalled()
    })
  })

  describe('updateModel', () => {
    it('sends the model and pending reasoning selection as a narrow patch', async () => {
      const mockTrigger = vi.fn().mockResolvedValue({
        id: 'agent-1',
        name: 'A',
        model: 'anthropic::new-model',
        type: 'claude-code',
        configuration: { avatar: '🤖', reasoning_effort: 'default' },
        createdAt: '',
        updatedAt: ''
      })
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId', mockTrigger)

      const { result } = renderHook(() => useUpdateAgent())
      const updated = await act(async () =>
        result.current.updateModel({
          agentId: 'agent-1',
          modelId: 'anthropic::new-model',
          reasoningEffort: 'high'
        })
      )

      expect(mockTrigger).toHaveBeenCalledWith({
        params: { agentId: 'agent-1' },
        body: {
          model: 'anthropic::new-model',
          configuration: { reasoning_effort: 'high' }
        }
      })
      expect(updated?.model).toBe('anthropic::new-model')
    })

    it('does not send configuration when only the model changed', async () => {
      const mockTrigger = vi.fn().mockResolvedValue({
        id: 'agent-1',
        name: 'A',
        model: 'anthropic::new-model',
        type: 'claude-code',
        configuration: { avatar: '🤖', reasoning_effort: 'default' },
        createdAt: '',
        updatedAt: ''
      })
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId', mockTrigger)

      const { result } = renderHook(() => useUpdateAgent())
      await act(async () =>
        result.current.updateModel({
          agentId: 'agent-1',
          modelId: 'anthropic::new-model'
        })
      )

      expect(mockTrigger).toHaveBeenCalledWith({
        params: { agentId: 'agent-1' },
        body: { model: 'anthropic::new-model' }
      })
    })
  })
})
