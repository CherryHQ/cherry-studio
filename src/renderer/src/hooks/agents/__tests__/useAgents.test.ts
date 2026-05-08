import { cacheService } from '@data/CacheService'
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

const applyReorderedListMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@renderer/data/hooks/useReorder', () => ({
  useReorder: vi.fn(() => ({ applyReorderedList: applyReorderedListMock, move: vi.fn(), isPending: false }))
}))

const mockToast = {
  success: vi.fn(),
  error: vi.fn()
}
vi.stubGlobal('window', {
  toast: mockToast,
  api: {}
})

describe('useAgents', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    MockCacheUtils.resetMocks()
    vi.clearAllMocks()
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
        { id: 'agent-1', name: 'Agent 1', model: 'claude-3' },
        { id: 'agent-2', name: 'Agent 2', model: 'claude-3' }
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
    it('calls createTrigger and shows success toast', async () => {
      const mockAgent = { id: 'new-agent', name: 'New Agent', model: 'claude-3' }
      const mockTrigger = vi.fn().mockResolvedValue(mockAgent)
      MockUseDataApiUtils.mockMutationWithTrigger('POST', '/agents', mockTrigger)
      MockUseDataApiUtils.mockQueryResult('/agents', { data: { items: [], total: 0, page: 1 } as any })

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
      MockUseDataApiUtils.mockMutationWithTrigger('POST', '/agents', mockTrigger)
      MockUseDataApiUtils.mockQueryResult('/agents', { data: { items: [], total: 0, page: 1 } as any })

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
      const cacheSpy = vi.spyOn(cacheService, 'set')

      const { result } = renderHook(() => useAgents())
      await act(async () => result.current.deleteAgent('agent-1'))

      expect(mockToast.success).toHaveBeenCalledWith('common.delete_success')
      expect(cacheSpy).toHaveBeenCalled()
    })

    it('shows error toast when deleteTrigger throws', async () => {
      const mockTrigger = vi.fn().mockRejectedValue(new Error('Delete failed'))
      MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/agents/:agentId', mockTrigger)
      MockUseDataApiUtils.mockQueryResult('/agents', { data: { items: [], total: 0, page: 1 } as any })

      const { result } = renderHook(() => useAgents())
      await act(async () => result.current.deleteAgent('agent-1'))

      expect(mockToast.error).toHaveBeenCalled()
    })
  })

  describe('reorderAgents', () => {
    it('forwards the reordered list to useReorder.applyReorderedList', async () => {
      MockUseDataApiUtils.mockQueryResult('/agents', { data: { items: [], total: 0, page: 1 } as any })

      const { result } = renderHook(() => useAgents())
      const list = [{ id: 'a1' }, { id: 'a2' }] as any
      await act(async () => result.current.reorderAgents(list))

      expect(applyReorderedListMock).toHaveBeenCalledWith(list)
    })
  })
})
