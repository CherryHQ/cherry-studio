import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateMock = vi.hoisted(() => vi.fn())
const uninstallSkillMock = vi.hoisted(() => vi.fn())

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => invalidateMock,
  useQuery: vi.fn()
}))

import { useSkillMutationsById } from '../skillAdapter'

describe('skillAdapter mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateMock.mockResolvedValue(undefined)
    uninstallSkillMock.mockResolvedValue({ success: true, data: undefined })

    vi.stubGlobal('api', {
      skill: {
        uninstall: uninstallSkillMock
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uninstalls skills through IPC and invalidates DataApi cache', async () => {
    const { result } = renderHook(() => useSkillMutationsById('skill-1'))

    await act(async () => {
      await result.current.uninstallSkill()
    })

    expect(uninstallSkillMock).toHaveBeenCalledWith('skill-1')
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('resolves uninstall when DataApi cache invalidation fails after IPC success', async () => {
    invalidateMock.mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => useSkillMutationsById('skill-1'))

    await act(async () => {
      await result.current.uninstallSkill()
    })

    expect(uninstallSkillMock).toHaveBeenCalledWith('skill-1')
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })
})
