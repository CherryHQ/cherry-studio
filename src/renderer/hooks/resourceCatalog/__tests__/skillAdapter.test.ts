import { useQuery } from '@data/hooks/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateMock = vi.hoisted(() => vi.fn())
const skillMocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => invalidateMock,
  useQuery: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: skillMocks.request } }))

import { skillAdapter, useSkillMutationsById } from '../skillAdapter'

function mockSkillQuery() {
  vi.mocked(useQuery).mockReturnValue({
    data: [],
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn()
  } as unknown as ReturnType<typeof useQuery>)
}

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

describe('skillAdapter reconcile-on-open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateMock.mockResolvedValue(undefined)
    skillMocks.request.mockResolvedValue(undefined)
    mockSkillQuery()
  })

  it('reconciles the on-disk library and refreshes when the skill view opens', async () => {
    renderHook(() => skillAdapter.useList({ enabled: true }))

    expect(skillMocks.request).toHaveBeenCalledWith('skill.reconcile', {})
    await waitFor(() => expect(invalidateMock).toHaveBeenCalledWith('/skills'))
  })

  it('does not reconcile while the skill view is disabled', async () => {
    renderHook(() => skillAdapter.useList({ enabled: false }))

    expect(skillMocks.request).not.toHaveBeenCalled()
    expect(invalidateMock).not.toHaveBeenCalled()
  })
})
