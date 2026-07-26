import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateMock = vi.hoisted(() => vi.fn())
const skillMocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => invalidateMock,
  useQuery: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: skillMocks.request } }))

import { useSkillMutationsById } from '../skillAdapter'

describe('skillAdapter mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateMock.mockResolvedValue(undefined)
    skillMocks.request.mockResolvedValue({ success: true, data: undefined })
  })

  it('uninstalls skills through IPC and invalidates DataApi cache', async () => {
    const { result } = renderHook(() => useSkillMutationsById('skill-1'))

    await act(async () => {
      await result.current.uninstallSkill()
    })

    expect(skillMocks.request).toHaveBeenCalledWith('skill.uninstall', { skillId: 'skill-1' })
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })

  it('resolves uninstall when DataApi cache invalidation fails after IPC success', async () => {
    invalidateMock.mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => useSkillMutationsById('skill-1'))

    await act(async () => {
      await result.current.uninstallSkill()
    })

    expect(skillMocks.request).toHaveBeenCalledWith('skill.uninstall', { skillId: 'skill-1' })
    expect(invalidateMock).toHaveBeenCalledWith('/skills')
  })
})
