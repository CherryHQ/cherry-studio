import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutoPullOnApiKeyChange } from '../useAutoPullOnApiKeyChange'

const useModelsMock = vi.fn()
const useProviderApiKeysMock = vi.fn()

vi.mock('@renderer/hooks/useProviders', () => ({
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args)
}))

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: any[]) => useModelsMock(...args)
}))

const apiKeys = (...keys: string[]) => ({
  data: { keys: keys.map((key) => ({ key, isEnabled: true })) }
})

describe('useAutoPullOnApiKeyChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useModelsMock.mockReturnValue({ models: [] })
    useProviderApiKeysMock.mockReturnValue({ data: undefined })
  })

  it('does not fire when api-keys resolve after models on cold cache', () => {
    const onTrigger = vi.fn()
    // Cold cache: api-keys undefined, models empty.
    const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

    // models resolve first (0 → N).
    useModelsMock.mockReturnValue({ models: [{ id: 'openai::gpt-4o' }] })
    rerender()

    // api-keys resolve later — this must NOT be treated as a user key change.
    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-real'))
    rerender()

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('fires when the enabled key fingerprint changes after keys are loaded', () => {
    const onTrigger = vi.fn()
    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
    useModelsMock.mockReturnValue({ models: [{ id: 'openai::gpt-4o' }] })

    const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))
    expect(onTrigger).not.toHaveBeenCalled()

    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-two'))
    rerender()

    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('does not fire when no models exist locally yet', () => {
    const onTrigger = vi.fn()
    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
    useModelsMock.mockReturnValue({ models: [] })

    const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-two'))
    rerender()

    expect(onTrigger).not.toHaveBeenCalled()
  })
})
