import { cacheService } from '@data/CacheService'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgents } from '../useAgents'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@data/hooks/useCache', () => ({
  useCache: vi.fn().mockReturnValue(['agent-1', vi.fn()])
}))

const mockToast = {
  success: vi.fn(),
  error: vi.fn()
}
vi.stubGlobal('window', {
  toast: mockToast,
  api: {
    agent: {
      reorderAgents: vi.fn().mockResolvedValue(undefined)
    }
  }
})

describe('useAgents', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    MockCacheUtils.resetMocks()
    vi.clearAllMocks()
  })

  describe('agents list', () => {
    it('returns empty array when data is undefined', () => {
      MockUseDataApiUtils.mockQueryData('/agents', undefined as any)
      vi.mocked(useQuery).mockReturnValue({
        data: undefined,
        isLoading: true,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn() as any
      })

      const { result } = renderHook(() => useAgents())
      expect(result.current.agents).toEqual([])
      expect(result.current.isLoading).toBe(true)
    })

    it('returns agents from data.items', () => {
      const mockAgents = [
        { id: 'agent-1', name: 'Agent 1', model: 'claude-3' },
        { id: 'agent-2', name: 'Agent 2', model: 'claude-3' }
      ]
      vi.mocked(useQuery).mockReturnValue({
        data: { items: mockAgents, total: 2, limit: 20, offset: 0 } as any,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn() as any
      })

      const { result } = renderHook(() => useAgents())
      expect(result.current.agents).toEqual(mockAgents)
      expect(result.current.isLoading).toBe(false)
    })
  })

  describe('addAgent', () => {
    it('calls createTrigger and shows success toast', async () => {
      const mockAgent = { id: 'new-agent', name: 'New Agent', model: 'claude-3' }
      const mockTrigger = vi.fn().mockResolvedValue(mockAgent)
      vi.mocked(useMutation).mockReturnValue({ trigger: mockTrigger, isLoading: false, error: undefined })
      vi.mocked(useQuery).mockReturnValue({
        data: { items: [], total: 0, limit: 20, offset: 0 } as any,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn() as any
      })

      const { result } = renderHook(() => useAgents())
      const addResult = await act(async () =>
        result.current.addAgent({
          name: 'New Agent',
          model: 'claude-3',
          type: 'claude-code',
          accessiblePaths: [],
          allowedTools: []
        })
      )

      expect(addResult.success).toBe(true)
      if (addResult.success) {
        expect(addResult.data).toEqual(mockAgent)
      }
      expect(mockToast.success).toHaveBeenCalledWith('common.add_success')
    })

    it('returns failure result when createTrigger throws', async () => {
      const error = new Error('Create failed')
      const mockTrigger = vi.fn().mockRejectedValue(error)
      vi.mocked(useMutation).mockReturnValue({ trigger: mockTrigger, isLoading: false, error: undefined })
      vi.mocked(useQuery).mockReturnValue({
        data: { items: [], total: 0, limit: 20, offset: 0 } as any,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn() as any
      })

      const { result } = renderHook(() => useAgents())
      const addResult = await act(async () =>
        result.current.addAgent({
          name: 'New Agent',
          model: 'claude-3',
          type: 'claude-code',
          accessiblePaths: [],
          allowedTools: []
        })
      )

      expect(addResult.success).toBe(false)
      expect(mockToast.error).toHaveBeenCalled()
    })
  })

  describe('deleteAgent', () => {
    it('calls deleteTrigger and updates cache', async () => {
      const mockTrigger = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useMutation).mockReturnValue({ trigger: mockTrigger, isLoading: false, error: undefined })
      vi.mocked(useQuery).mockReturnValue({
        data: {
          items: [
            { id: 'agent-1', name: 'A1' },
            { id: 'agent-2', name: 'A2' }
          ],
          total: 2,
          limit: 20,
          offset: 0
        } as any,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn() as any
      })
      const cacheSpy = vi.spyOn(cacheService, 'set')

      const { result } = renderHook(() => useAgents())
      await act(async () => result.current.deleteAgent('agent-1'))

      expect(mockToast.success).toHaveBeenCalledWith('common.delete_success')
      expect(cacheSpy).toHaveBeenCalled()
    })

    it('shows error toast when deleteTrigger throws', async () => {
      const mockTrigger = vi.fn().mockRejectedValue(new Error('Delete failed'))
      vi.mocked(useMutation).mockReturnValue({ trigger: mockTrigger, isLoading: false, error: undefined })
      vi.mocked(useQuery).mockReturnValue({
        data: { items: [], total: 0, limit: 20, offset: 0 } as any,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn() as any
      })

      const { result } = renderHook(() => useAgents())
      await act(async () => result.current.deleteAgent('agent-1'))

      expect(mockToast.error).toHaveBeenCalled()
    })
  })

  describe('reorderAgents', () => {
    it('calls window.api.agent.reorderAgents and refetches', async () => {
      const mockRefetch = vi.fn()
      vi.mocked(useMutation).mockReturnValue({ trigger: vi.fn(), isLoading: false, error: undefined })
      vi.mocked(useQuery).mockReturnValue({
        data: { items: [], total: 0, limit: 20, offset: 0 } as any,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: mockRefetch,
        mutate: vi.fn() as any
      })

      const { result } = renderHook(() => useAgents())
      await act(async () => result.current.reorderAgents([{ id: 'a1' } as any, { id: 'a2' } as any]))

      expect(window.api.agent.reorderAgents).toHaveBeenCalledWith(['a1', 'a2'])
      expect(mockRefetch).toHaveBeenCalled()
    })
  })
})
