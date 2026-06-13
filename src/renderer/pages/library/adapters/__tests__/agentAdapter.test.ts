import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentMutationsById } from '../agentAdapter'

const triggerMock = vi.hoisted(() => vi.fn())
const useMutationMock = vi.hoisted(() => vi.fn())

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: useMutationMock,
  useQuery: vi.fn()
}))

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
      refresh: ['/agents', '/agents/*']
    })
    expect(useMutationMock).toHaveBeenCalledWith('DELETE', '/agents/agent-1', {
      refresh: ['/agents', '/agents/*']
    })
  })
})
