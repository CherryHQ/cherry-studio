import { preferenceService } from '@data/PreferenceService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  renderedIds: ['agent-a'] as string[],
  state: { 'agent.session.hidden_builtin_ids': ['agent-a'] as string[] | undefined },
  setPreference: vi.fn<(ids: string[]) => Promise<void>>()
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [mocks.renderedIds, mocks.setPreference]
}))

vi.mock('@data/PreferenceService', async () => {
  const { createMockPreferenceService } = await import('@test-mocks/renderer/PreferenceService')
  return { preferenceService: createMockPreferenceService({}, mocks.state) }
})

import { useBuiltinAgentListVisibility } from '../useBuiltinAgentListVisibility'

describe('useBuiltinAgentListVisibility', () => {
  beforeEach(() => {
    mocks.state['agent.session.hidden_builtin_ids'] = ['agent-a']
    mocks.renderedIds = ['agent-a']
    vi.mocked(preferenceService.update).mockClear()
    mocks.setPreference.mockReset()
    mocks.setPreference.mockImplementation(async (ids) => {
      mocks.state['agent.session.hidden_builtin_ids'] = ids
    })
  })

  it('preserves concurrent visibility changes from separately mounted consumers', async () => {
    const first = renderHook(() => useBuiltinAgentListVisibility())
    const second = renderHook(() => useBuiltinAgentListVisibility())

    await act(async () => {
      await Promise.all([
        first.result.current.showBuiltinAgent('agent-a'),
        second.result.current.hideBuiltinAgent('agent-b')
      ])
    })

    expect(mocks.state['agent.session.hidden_builtin_ids']).toEqual(['agent-b'])
    expect(preferenceService.update).toHaveBeenCalledTimes(2)
  })

  it('reports unresolved visibility preferences so task lists can fail closed', () => {
    mocks.state['agent.session.hidden_builtin_ids'] = undefined
    mocks.renderedIds = []
    const { result, rerender } = renderHook(() => useBuiltinAgentListVisibility())

    expect(result.current.isLoading).toBe(true)

    mocks.state['agent.session.hidden_builtin_ids'] = []
    rerender()

    expect(result.current.isLoading).toBe(false)
  })
})
