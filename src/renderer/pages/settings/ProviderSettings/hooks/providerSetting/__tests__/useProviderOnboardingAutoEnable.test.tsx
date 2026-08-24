import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderOnboardingAutoEnable } from '../useProviderOnboardingAutoEnable'

const updateProviderMock = vi.fn().mockResolvedValue(undefined)
const providerState: { provider: { id: string; isEnabled: boolean } } = {
  provider: { id: 'openai', isEnabled: false }
}
const apiKeysState: { data: { keys: Array<{ id: string; key: string; isEnabled: boolean }> } | undefined } = {
  data: undefined
}

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => providerState,
  useProviderApiKeys: () => apiKeysState,
  useProviderMutations: () => ({ updateProvider: updateProviderMock })
}))

describe('useProviderOnboardingAutoEnable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerState.provider = { id: 'openai', isEnabled: false }
    apiKeysState.data = undefined
  })

  it('does not auto-enable a disabled provider that already had an API key', () => {
    apiKeysState.data = { keys: [{ id: 'key-1', key: 'sk-existing', isEnabled: true }] }

    renderHook(() => useProviderOnboardingAutoEnable({ providerId: 'openai', isOnboarding: true }))

    expect(updateProviderMock).not.toHaveBeenCalled()
  })

  it('auto-enables only when an API key is added and does not override a later manual disable', async () => {
    apiKeysState.data = { keys: [] }
    const { rerender } = renderHook(() => useProviderOnboardingAutoEnable({ providerId: 'openai', isOnboarding: true }))

    apiKeysState.data = { keys: [{ id: 'key-1', key: 'sk-new', isEnabled: true }] }
    rerender()

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledTimes(1))
    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })

    providerState.provider = { id: 'openai', isEnabled: true }
    rerender()
    providerState.provider = { id: 'openai', isEnabled: false }
    rerender()

    expect(updateProviderMock).toHaveBeenCalledTimes(1)
  })
})
