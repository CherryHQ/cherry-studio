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
