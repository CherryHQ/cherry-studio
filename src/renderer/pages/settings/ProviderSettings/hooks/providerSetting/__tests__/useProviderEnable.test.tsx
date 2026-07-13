import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderEnable } from '../useProviderEnable'

const useProviderMock = vi.fn()
const useProviderMutationsMock = vi.fn()
const updateProviderMock = vi.fn().mockResolvedValue(undefined)
const enableProviderMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderMutations: (...args: any[]) => useProviderMutationsMock(...args)
}))

describe('useProviderEnable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: true }
    })
    useProviderMutationsMock.mockReturnValue({
      updateProvider: updateProviderMock,
      enableProvider: enableProviderMock
    })
  })

  it('updates only isEnabled when disabling a provider', async () => {
    const { result } = renderHook(() => useProviderEnable('openai'))

    await act(async () => {
      await result.current.toggleProviderEnabled(false)
    })

    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: false })
    expect(enableProviderMock).not.toHaveBeenCalled()
  })

  it('enables and moves the provider to the top through the atomic mutation', async () => {
    const { result } = renderHook(() => useProviderEnable('openai'))

    await act(async () => {
      await result.current.toggleProviderEnabled(true)
    })

    expect(enableProviderMock).toHaveBeenCalledTimes(1)
    expect(updateProviderMock).not.toHaveBeenCalled()
  })

  it('does nothing when the provider is missing', async () => {
    useProviderMock.mockReturnValue({
      provider: undefined
    })

    const { result } = renderHook(() => useProviderEnable('openai'))

    await act(async () => {
      await result.current.toggleProviderEnabled(true)
    })

    expect(updateProviderMock).not.toHaveBeenCalled()
    expect(enableProviderMock).not.toHaveBeenCalled()
  })

  it('surfaces atomic enable-and-pin failures without stale rollback', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: false }
    })
    const enableError = new Error('enable and pin failed')
    enableProviderMock.mockRejectedValueOnce(enableError)

    const { result } = renderHook(() => useProviderEnable('openai'))

    let thrown: unknown = null
    await act(async () => {
      try {
        await result.current.toggleProviderEnabled(true)
      } catch (error) {
        thrown = error
      }
    })

    expect(thrown).toBe(enableError)
    expect(enableProviderMock).toHaveBeenCalledTimes(1)
    expect(updateProviderMock).not.toHaveBeenCalled()
  })
})
