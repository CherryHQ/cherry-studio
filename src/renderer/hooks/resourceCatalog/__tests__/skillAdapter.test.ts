import { useDataChange, useMutation } from '@data/hooks/useDataApi'
import { act, renderHook as renderHookBase, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invalidateMock = vi.hoisted(() => vi.fn())
const skillMocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => invalidateMock,
  useDataChange: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: skillMocks.request } }))

import { skillAdapter, useSkillMutationsById } from '../skillAdapter'

function renderHook<T>(callback: () => T) {
  const cache = new Map()
  return renderHookBase(callback, {
    wrapper: ({ children }: PropsWithChildren) =>
      createElement(
        SWRConfig,
        {
          value: { provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }
        },
        children
      )
  })
}

describe('skillAdapter mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateMock.mockResolvedValue(undefined)
    skillMocks.request.mockResolvedValue({ success: true, data: undefined })
    vi.mocked(useMutation).mockReturnValue({
      trigger: vi.fn(),
      isLoading: false
    } as unknown as ReturnType<typeof useMutation>)
  })

  it('updates the global enabled state through DataApi', async () => {
    const trigger = vi.fn().mockResolvedValue({ id: 'skill-1', isGlobalEnabled: false })
    vi.mocked(useMutation).mockReturnValue({ trigger, isLoading: false } as unknown as ReturnType<typeof useMutation>)
    const { result } = renderHook(() => useSkillMutationsById('skill-1'))

    await act(async () => {
      await result.current.updateGlobalEnabled(false)
    })

    expect(useMutation).toHaveBeenCalledWith('PATCH', '/skills/skill-1', {
      refresh: ['/skills', '/skills/skill-1']
    })
    expect(trigger).toHaveBeenCalledWith({ body: { isGlobalEnabled: false } })
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

  it('rejects an unsuccessful IPC envelope without invalidating the cache', async () => {
    skillMocks.request.mockResolvedValueOnce({ success: false, error: 'permission denied' })
    const { result } = renderHook(() => useSkillMutationsById('skill-1'))

    await act(async () => {
      await expect(result.current.uninstallSkill()).rejects.toThrow('permission denied')
    })

    expect(invalidateMock).not.toHaveBeenCalled()
  })
})

describe('skillAdapter reconcile-on-open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateMock.mockResolvedValue(undefined)
    skillMocks.request.mockImplementation(async (route) => (route === 'skill.list_catalog' ? [] : undefined))
  })

  it('reconciles the on-disk library and refreshes when the skill view opens', async () => {
    renderHook(() => skillAdapter.useList({ enabled: true }))

    expect(useDataChange).toHaveBeenCalledWith('/skills', expect.any(Function))
    expect(skillMocks.request).toHaveBeenCalledWith('skill.reconcile', {})
    await waitFor(() => expect(invalidateMock).toHaveBeenCalledWith('/skills'))
  })

  it('does not reconcile while the skill view is disabled', async () => {
    renderHook(() => skillAdapter.useList({ enabled: false }))

    expect(useDataChange).toHaveBeenCalledWith([], expect.any(Function))
    expect(skillMocks.request).not.toHaveBeenCalled()
    expect(invalidateMock).not.toHaveBeenCalled()
  })

  it('refetches the catalog after a cross-window data change', async () => {
    const { result } = renderHook(() => skillAdapter.useList({ enabled: true }))
    await waitFor(() => expect(result.current.data).toEqual([]))
    skillMocks.request.mockImplementation(async (route) =>
      route === 'skill.list_catalog' ? [{ id: 'new-skill', scope: 'system' }] : undefined
    )
    const listener = vi.mocked(useDataChange).mock.calls.at(-1)?.[1]
    await act(async () => {
      listener?.([])
    })
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'new-skill', scope: 'system' }]))
  })

  it('refreshes the IPC catalog after uninstall even without a database event', async () => {
    let removed = false
    skillMocks.request.mockImplementation(async (route) => {
      if (route === 'skill.list_catalog') return removed ? [] : [{ id: 'skill-1', scope: 'system' }]
      if (route === 'skill.uninstall') {
        removed = true
        return { success: true }
      }
      return undefined
    })
    const { result } = renderHook(() => ({
      list: skillAdapter.useList({ enabled: true }),
      mutation: useSkillMutationsById('skill-1')
    }))
    await waitFor(() => expect(result.current.list.data).toHaveLength(1))
    await act(async () => {
      await result.current.mutation.uninstallSkill()
    })
    await waitFor(() => expect(result.current.list.data).toEqual([]))
  })
})
