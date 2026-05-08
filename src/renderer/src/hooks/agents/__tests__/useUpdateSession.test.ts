import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useUpdateSession } from '../useSessionDataApi'

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
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/sessions/:sessionId', mockTrigger)

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
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/sessions/:sessionId', mockTrigger)

    const { result } = renderHook(() => useUpdateSession('agent-1'))
    await act(async () => result.current.updateSession({ id: 'session-1' }, { showSuccessToast: false }))

    expect(mockToast.success).not.toHaveBeenCalled()
  })

  it('shows error toast and returns undefined on failure', async () => {
    const mockTrigger = vi.fn().mockRejectedValue(new Error('Update failed'))
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/sessions/:sessionId', mockTrigger)

    const { result } = renderHook(() => useUpdateSession('agent-1'))
    const updated = await act(async () => result.current.updateSession({ id: 'session-1' }))

    expect(updated).toBeUndefined()
    expect(mockToast.error).toHaveBeenCalled()
  })
})
