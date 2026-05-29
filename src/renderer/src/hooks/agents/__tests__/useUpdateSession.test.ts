import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useUpdateSession } from '../useUpdateSession'

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

  it('calls updateTrigger with correct params and returns session with defaults', async () => {
    const mockResult = {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Session',
      model: 'claude-3',
      agentType: 'claude-code',
      accessiblePaths: [],
      allowedTools: [],
      configuration: { avatar: '🤖' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
    const mockTrigger = vi.fn().mockResolvedValue(mockResult)
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId/sessions/:sessionId', mockTrigger)

    const { result } = renderHook(() => useUpdateSession('agent-1'))
    const updated = await act(async () => result.current.updateSession({ id: 'session-1', model: 'claude-3' }))

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { agentId: 'agent-1', sessionId: 'session-1' },
      body: { model: 'claude-3' }
    })
    expect(updated).toBeDefined()
    expect(mockToast.success).toHaveBeenCalledWith('common.update_success')
  })

  it('does not show success toast when showSuccessToast is false', async () => {
    const mockResult = {
      id: 's1',
      agentId: 'a1',
      name: 'S',
      model: 'claude',
      agentType: 'claude-code',
      accessiblePaths: [],
      allowedTools: [],
      configuration: {},
      createdAt: '',
      updatedAt: ''
    }
    const mockTrigger = vi.fn().mockResolvedValue(mockResult)
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId/sessions/:sessionId', mockTrigger)

    const { result } = renderHook(() => useUpdateSession('agent-1'))
    await act(async () => result.current.updateSession({ id: 'session-1' }, { showSuccessToast: false }))

    expect(mockToast.success).not.toHaveBeenCalled()
  })

  it('shows error toast and returns undefined on failure', async () => {
    const mockTrigger = vi.fn().mockRejectedValue(new Error('Update failed'))
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId/sessions/:sessionId', mockTrigger)

    const { result } = renderHook(() => useUpdateSession('agent-1'))
    const updated = await act(async () => result.current.updateSession({ id: 'session-1' }))

    expect(updated).toBeUndefined()
    expect(mockToast.error).toHaveBeenCalled()
  })

  describe('updateModel', () => {
    it('delegates to updateSession with model field', async () => {
      const mockResult = {
        id: 's1',
        agentId: 'a1',
        name: 'S',
        model: 'new-model',
        agentType: 'claude-code',
        accessiblePaths: [],
        allowedTools: [],
        configuration: {},
        createdAt: '',
        updatedAt: ''
      }
      const mockTrigger = vi.fn().mockResolvedValue(mockResult)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId/sessions/:sessionId', mockTrigger)

      const { result } = renderHook(() => useUpdateSession('agent-1'))
      await act(async () => result.current.updateModel('session-1', 'new-model'))

      expect(mockTrigger).toHaveBeenCalledWith({
        params: { agentId: 'agent-1', sessionId: 'session-1' },
        body: { model: 'new-model' }
      })
    })
  })
})
