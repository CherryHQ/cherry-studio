import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutoPullOnApiKeyChange } from '../useAutoPullOnApiKeyChange'

const useModelsMock = vi.fn()
const useProviderApiKeysMock = vi.fn()
const useProviderMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: any[]) => useModelsMock(...args)
}))

const apiKeys = (...keys: string[]) => ({
  data: { keys: keys.map((key) => ({ key, isEnabled: true })) }
})

const providerWithHost = (baseUrl: string, providerId = 'openai') => {
  const endpoint = providerId === 'ollama' ? 'ollama_chat' : 'openai_chat_completions'

  return {
    provider: {
      id: providerId,
      // ollama is credential-free — carried on the merged Provider from the registry
      authOptional: providerId === 'ollama',
      defaultChatEndpoint: endpoint,
      endpointConfigs: { [endpoint]: { baseUrl } }
    }
  }
}

const emptyApiKeys = () => ({
  data: { keys: [] }
})

const keyEntries = (entries: Array<{ key: string; isEnabled: boolean }>) => ({
  data: { keys: entries }
})

describe('useAutoPullOnApiKeyChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useModelsMock.mockReturnValue({ models: [] })
    useProviderApiKeysMock.mockReturnValue({ data: undefined })
    useProviderMock.mockReturnValue(providerWithHost('https://api.openai.com/v1'))
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

  it('fires when the host (baseUrl) changes after the first render (models present)', () => {
    const onTrigger = vi.fn()
    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
    useModelsMock.mockReturnValue({ models: [{ id: 'openai::gpt-4o' }] })
    useProviderMock.mockReturnValue(providerWithHost('https://api.openai.com/v1'))

    const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))
    expect(onTrigger).not.toHaveBeenCalled()

    useProviderMock.mockReturnValue(providerWithHost('https://proxy.example.com/v1'))
    rerender()

    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('fires when an API-key-exempt provider host changes without enabled keys', () => {
    const onTrigger = vi.fn()
    useProviderApiKeysMock.mockReturnValue(emptyApiKeys())
    useModelsMock.mockReturnValue({ models: [{ id: 'ollama::llama3.2' }] })
    useProviderMock.mockReturnValue(providerWithHost('http://localhost:11434', 'ollama'))

    const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('ollama', onTrigger))
    expect(onTrigger).not.toHaveBeenCalled()

    useProviderMock.mockReturnValue(providerWithHost('http://localhost:11435', 'ollama'))
    rerender()

    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('does not fire when an API-key-required provider host changes without enabled keys', () => {
    const onTrigger = vi.fn()
    useProviderApiKeysMock.mockReturnValue(emptyApiKeys())
    useModelsMock.mockReturnValue({ models: [{ id: 'openai::gpt-4o' }] })
    useProviderMock.mockReturnValue(providerWithHost('https://api.openai.com/v1'))

    const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

    useProviderMock.mockReturnValue(providerWithHost('https://proxy.example.com/v1'))
    rerender()

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('fires on first render + key change for API-key providers with no models (auto-sync is disabled)', () => {
    const onTrigger = vi.fn()
    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
    useModelsMock.mockReturnValue({ models: [] })

    const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

    // First render with keys + no models: opens pull reconcile.
    expect(onTrigger).toHaveBeenCalledTimes(1)

    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-two'))
    rerender()

    // Key change with no models: opens pull reconcile again.
    expect(onTrigger).toHaveBeenCalledTimes(2)
  })

  it('does not fire for non-key providers when no models exist (auto-sync handles bootstrap)', () => {
    const onTrigger = vi.fn()
    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
    useModelsMock.mockReturnValue({ models: [] })
    useProviderMock.mockReturnValue(providerWithHost('http://localhost:11434', 'ollama'))

    const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('ollama', onTrigger))

    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-two'))
    rerender()

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('fires on first render for API-key providers with no models and enabled keys', () => {
    const onTrigger = vi.fn()
    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
    useModelsMock.mockReturnValue({ models: [] })

    renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('does not fire on first render for API-key providers that already have models', () => {
    const onTrigger = vi.fn()
    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
    useModelsMock.mockReturnValue({ models: [{ id: 'openai::gpt-4o' }] })

    renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('does not fire on first render for API-key providers without enabled keys', () => {
    const onTrigger = vi.fn()
    useProviderApiKeysMock.mockReturnValue(emptyApiKeys())
    useModelsMock.mockReturnValue({ models: [] })

    renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('does not fire on first render for non-key providers with no models (auto-sync handles it)', () => {
    const onTrigger = vi.fn()
    useProviderApiKeysMock.mockReturnValue(emptyApiKeys())
    useModelsMock.mockReturnValue({ models: [] })
    useProviderMock.mockReturnValue(providerWithHost('http://localhost:11434', 'ollama'))

    renderHook(() => useAutoPullOnApiKeyChange('ollama', onTrigger))

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('waits for models to finish loading before deciding first-render pull reconcile', () => {
    const onTrigger = vi.fn()
    // api-keys resolve first, models are still loading.
    useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
    useModelsMock.mockReturnValue({ models: [], isLoading: true })

    const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

    expect(onTrigger).not.toHaveBeenCalled()

    // models resolve later — the provider already has local models.
    useModelsMock.mockReturnValue({ models: [{ id: 'openai::gpt-4o' }], isLoading: false })
    rerender()

    expect(onTrigger).not.toHaveBeenCalled()
  })

  describe('key-set transitions (models already present)', () => {
    beforeEach(() => {
      useModelsMock.mockReturnValue({ models: [{ id: 'openai::gpt-4o' }] })
    })

    it('fires when a key is added', () => {
      const onTrigger = vi.fn()
      useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
      const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

      useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one', 'sk-two'))
      rerender()

      expect(onTrigger).toHaveBeenCalledTimes(1)
    })

    it('fires when a key is removed (others remain enabled)', () => {
      const onTrigger = vi.fn()
      useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one', 'sk-two'))
      const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

      useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
      rerender()

      expect(onTrigger).toHaveBeenCalledTimes(1)
    })

    it('fires when disabling one of several keys (signature stays non-empty)', () => {
      const onTrigger = vi.fn()
      useProviderApiKeysMock.mockReturnValue(
        keyEntries([
          { key: 'sk-one', isEnabled: true },
          { key: 'sk-two', isEnabled: true }
        ])
      )
      const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

      useProviderApiKeysMock.mockReturnValue(
        keyEntries([
          { key: 'sk-one', isEnabled: true },
          { key: 'sk-two', isEnabled: false }
        ])
      )
      rerender()

      expect(onTrigger).toHaveBeenCalledTimes(1)
    })

    it('does not fire when disabling the only key (signature becomes empty)', () => {
      const onTrigger = vi.fn()
      useProviderApiKeysMock.mockReturnValue(keyEntries([{ key: 'sk-one', isEnabled: true }]))
      const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

      useProviderApiKeysMock.mockReturnValue(keyEntries([{ key: 'sk-one', isEnabled: false }]))
      rerender()

      expect(onTrigger).not.toHaveBeenCalled()
    })

    it('does not fire when the same key value is re-pasted (signature unchanged)', () => {
      const onTrigger = vi.fn()
      useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
      const { rerender } = renderHook(() => useAutoPullOnApiKeyChange('openai', onTrigger))

      // New object identity, identical enabled-key fingerprint.
      useProviderApiKeysMock.mockReturnValue(apiKeys('sk-one'))
      rerender()

      expect(onTrigger).not.toHaveBeenCalled()
    })
  })
})
