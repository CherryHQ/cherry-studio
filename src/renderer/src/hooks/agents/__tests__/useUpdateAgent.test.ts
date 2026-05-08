import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useUpdateAgent } from '../useAgentDataApi'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const mockToast = {
  success: vi.fn(),
  error: vi.fn()
}
vi.stubGlobal('window', { toast: mockToast })

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
        accessiblePaths: [],
        allowedTools: [],
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
      expect(mockToast.success).toHaveBeenCalledWith(expect.objectContaining({ key: 'update-agent' }))
    })

    it('does not show success toast when showSuccessToast is false', async () => {
      const mockResult = {
        id: 'agent-1',
        name: 'Updated',
        model: 'claude-3',
        type: 'claude-code',
        accessiblePaths: [],
        allowedTools: [],
        configuration: {},
        createdAt: '',
        updatedAt: ''
      }
      const mockTrigger = vi.fn().mockResolvedValue(mockResult)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId', mockTrigger)

      const { result } = renderHook(() => useUpdateAgent())
      await act(async () => result.current.updateAgent({ id: 'agent-1', name: 'Updated' }, { showSuccessToast: false }))

      expect(mockToast.success).not.toHaveBeenCalled()
    })

    it('shows error toast and returns undefined on failure', async () => {
      const mockTrigger = vi.fn().mockRejectedValue(new Error('Update failed'))
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId', mockTrigger)

      const { result } = renderHook(() => useUpdateAgent())
      const updated = await act(async () => result.current.updateAgent({ id: 'agent-1', name: 'Fail' }))

      expect(updated).toBeUndefined()
      expect(mockToast.error).toHaveBeenCalled()
    })
  })

  describe('updateModel', () => {
    it('delegates to updateAgent with model field', async () => {
      const mockTrigger = vi.fn().mockResolvedValue({
        id: 'agent-1',
        name: 'A',
        model: 'new-model',
        type: 'claude-code',
        accessiblePaths: [],
        allowedTools: [],
        configuration: {},
        createdAt: '',
        updatedAt: ''
      })
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId', mockTrigger)

      const { result } = renderHook(() => useUpdateAgent())
      await act(async () => result.current.updateModel('agent-1', 'new-model'))

      expect(mockTrigger).toHaveBeenCalledWith({
        params: { agentId: 'agent-1' },
        body: { model: 'new-model' }
      })
    })
  })
})
