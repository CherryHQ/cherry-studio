import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearLastWrittenEndpointConfigs,
  getLastWrittenEndpointConfigs,
  setLastWrittenEndpointConfigs
} from '../../hooks/providerSetting/endpointConfigsWriteCoordinator'
import { useProviderDelete } from '../useProviderDelete'

const useProviderActionsMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderActions: (...args: any[]) => useProviderActionsMock(...args)
}))

const deleteProviderByIdMock = vi.fn()
const providerId = 'openai'

describe('useProviderDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteProviderByIdMock.mockResolvedValue(undefined)
    useProviderActionsMock.mockReturnValue({
      deleteProviderById: deleteProviderByIdMock
    })
    clearLastWrittenEndpointConfigs(providerId)
  })

  it('calls deleteProviderById (the logo lives on the row and is deleted with it)', async () => {
    const { result } = renderHook(() => useProviderDelete())

    await act(async () => {
      await result.current.deleteProvider(providerId)
    })

    expect(deleteProviderByIdMock).toHaveBeenCalledWith('openai')
  })

  it('clears the coordinated endpoint snapshot so a recreated provider starts clean', async () => {
    setLastWrittenEndpointConfigs(providerId, {
      'openai-chat-completions': { baseUrl: 'https://old-host/v1' }
    } as never)
    const { result } = renderHook(() => useProviderDelete())

    await act(async () => {
      await result.current.deleteProvider(providerId)
    })

    expect(getLastWrittenEndpointConfigs(providerId)).toBeUndefined()
  })
})
