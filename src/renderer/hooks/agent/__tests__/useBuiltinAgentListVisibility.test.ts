import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cachedIds: ['agent-a'] as string[] | undefined,
  currentIds: ['agent-a'] as string[],
  renderedIds: ['agent-a'] as string[],
  setPreference: vi.fn<(ids: string[]) => Promise<void>>()
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [mocks.renderedIds, mocks.setPreference]
}))

vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    getCachedValue: () => mocks.cachedIds,
    update: async (_key: string, updater: (currentIds: string[]) => string[]) => {
      mocks.currentIds = updater(mocks.currentIds)
    }
  }
}))

import { useBuiltinAgentListVisibility } from '../useBuiltinAgentListVisibility'

describe('useBuiltinAgentListVisibility', () => {
  beforeEach(() => {
    mocks.cachedIds = ['agent-a']
    mocks.currentIds = ['agent-a']
    mocks.renderedIds = ['agent-a']
    mocks.setPreference.mockReset()
    mocks.setPreference.mockImplementation(async (ids) => {
      mocks.currentIds = ids
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

    expect(mocks.currentIds).toEqual(['agent-b'])
  })

  it('reports unresolved visibility preferences so task lists can fail closed', () => {
    mocks.cachedIds = undefined
    mocks.renderedIds = []
    const { result, rerender } = renderHook(() => useBuiltinAgentListVisibility())

    expect(result.current.isLoading).toBe(true)

    mocks.cachedIds = []
    rerender()

    expect(result.current.isLoading).toBe(false)
  })
})
