import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderEnable } from '../useProviderEnable'

const useProviderMock = vi.fn()
const useProviderMutationsMock = vi.fn()
const useReorderMock = vi.fn()
const updateProviderMock = vi.fn().mockResolvedValue(undefined)
const moveMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderMutations: (...args: any[]) => useProviderMutationsMock(...args)
}))

vi.mock('@data/hooks/useReorder', () => ({
  useReorder: (...args: any[]) => useReorderMock(...args)
}))

describe('useProviderEnable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: true }
    })
    useProviderMutationsMock.mockReturnValue({
      updateProvider: updateProviderMock
    })
    useReorderMock.mockReturnValue({
      move: moveMock
    })
  })

  it('updates only isEnabled when disabling a provider', async () => {
    const { result } = renderHook(() => useProviderEnable('openai'))

    await act(async () => {
      await result.current.toggleProviderEnabled(false)
    })

    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: false })
    expect(moveMock).not.toHaveBeenCalled()
  })

  it('moves the provider to the top after enabling it', async () => {
    const { result } = renderHook(() => useProviderEnable('openai'))

    await act(async () => {
      await result.current.toggleProviderEnabled(true)
    })

    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })
    expect(moveMock).toHaveBeenCalledWith('openai', { position: 'first' })
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
    expect(moveMock).not.toHaveBeenCalled()
  })

  it('rolls the enable state back when pin-to-top fails after enabling', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: false }
    })
    const moveError = new Error('move failed')
    moveMock.mockRejectedValueOnce(moveError)

    const { result } = renderHook(() => useProviderEnable('openai'))

    await expect(
      act(async () => {
        await result.current.toggleProviderEnabled(true)
      })
    ).rejects.toThrow('move failed')

    expect(updateProviderMock).toHaveBeenNthCalledWith(1, { isEnabled: true })
    expect(moveMock).toHaveBeenCalledWith('openai', { position: 'first' })
    expect(updateProviderMock).toHaveBeenNthCalledWith(2, { isEnabled: false })
  })
})
