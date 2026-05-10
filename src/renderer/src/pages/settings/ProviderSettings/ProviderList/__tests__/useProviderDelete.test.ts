import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderDelete } from '../useProviderDelete'

const removeProviderLogoMock = vi.fn()
const useProviderActionsMock = vi.fn()

vi.mock('@renderer/hooks/useProviders', () => ({
  useProviderActions: (...args: any[]) => useProviderActionsMock(...args)
}))

vi.mock('../../hooks/useProviderLogo', () => ({
  removeProviderLogo: (...args: any[]) => removeProviderLogoMock(...args)
}))

const deleteProviderByIdMock = vi.fn()
const providerId = 'openai'

describe('useProviderDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteProviderByIdMock.mockResolvedValue(undefined)
    removeProviderLogoMock.mockResolvedValue(undefined)
    useProviderActionsMock.mockReturnValue({
      deleteProviderById: deleteProviderByIdMock
    })
  })

  it('removes logo then calls deleteProviderById', async () => {
    const { result } = renderHook(() => useProviderDelete())

    await act(async () => {
      await result.current.deleteProvider(providerId)
    })

    expect(removeProviderLogoMock).toHaveBeenCalledWith('openai')
    expect(deleteProviderByIdMock).toHaveBeenCalledWith('openai')
  })

  it('still calls deleteProviderById even if removeProviderLogo throws', async () => {
    removeProviderLogoMock.mockRejectedValue(new Error('storage error'))
    const { result } = renderHook(() => useProviderDelete())

    await act(async () => {
      await result.current.deleteProvider(providerId)
    })

    expect(deleteProviderByIdMock).toHaveBeenCalledWith('openai')
  })
})
