import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePaintingGenerationGuard } from '../usePaintingGenerationGuard'
import { usePaintingProviderRuntime } from '../usePaintingProviderRuntime'

vi.mock('../usePaintingProviderRuntime', () => ({
  usePaintingProviderRuntime: vi.fn()
}))

function createRuntimeProvider(isEnabled = true) {
  return {
    id: 'zhipu',
    name: 'Zhipu',
    apiHost: 'https://example.com',
    isEnabled,
    getApiKey: vi.fn(async () => 'token')
  }
}

function renderGuard(overrides: Partial<Parameters<typeof usePaintingGenerationGuard>[0]> = {}) {
  return renderHook(() =>
    usePaintingGenerationGuard({
      painting: {
        providerId: 'zhipu',
        mode: 'generate',
        model: 'cogview-4'
      },
      ensureCurrentCatalog: vi.fn(async () => [{ label: 'CogView 4', value: 'cogview-4' }]),
      ...overrides
    })
  )
}

describe('usePaintingGenerationGuard', () => {
  beforeEach(() => {
    vi.mocked(usePaintingProviderRuntime).mockReturnValue({
      provider: createRuntimeProvider(),
      isLoading: false
    })
  })

  it('blocks disabled providers before generation', async () => {
    vi.mocked(usePaintingProviderRuntime).mockReturnValue({
      provider: createRuntimeProvider(false),
      isLoading: false
    })
    const { result } = renderGuard()

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({
      ok: false,
      reason: 'provider_disabled'
    })
  })

  it('blocks providers with an empty or whitespace-only API key', async () => {
    vi.mocked(usePaintingProviderRuntime).mockReturnValue({
      provider: {
        ...createRuntimeProvider(),
        getApiKey: vi.fn(async () => '   ')
      },
      isLoading: false
    })
    const { result } = renderGuard()

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({
      ok: false,
      reason: 'no_api_key'
    })
  })

  it('allows providers with a non-empty API key through the API key check', async () => {
    vi.mocked(usePaintingProviderRuntime).mockReturnValue({
      provider: {
        ...createRuntimeProvider(),
        getApiKey: vi.fn(async () => 'real-token')
      },
      isLoading: false
    })
    const { result } = renderGuard()

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({ ok: true })
  })

  it('blocks missing models', async () => {
    const { result } = renderGuard({
      painting: {
        providerId: 'zhipu',
        mode: 'generate',
        model: ''
      }
    })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({
      ok: false,
      reason: 'model_missing'
    })
  })

  it('blocks unavailable or orphan models', async () => {
    const { result } = renderGuard({
      painting: {
        providerId: 'zhipu',
        mode: 'generate',
        model: 'stale-model'
      },
      ensureCurrentCatalog: vi.fn(async () => [{ label: 'CogView 4', value: 'cogview-4' }])
    })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({
      ok: false,
      reason: 'model_unavailable'
    })
  })

  it.each([
    { id: 'ovms', name: 'OpenVINO Model Server', apiHost: 'http://localhost:8000', model: 'ovms-model' },
    { id: 'ollama', name: 'Ollama', apiHost: 'http://localhost:11434', model: 'x/z-image-turbo:latest' }
  ])(
    'still blocks a disabled keyless local provider ($id) with provider_disabled',
    async ({ id, name, apiHost, model }) => {
      // Keyless-local status only exempts the API key check — a disabled provider must still block.
      vi.mocked(usePaintingProviderRuntime).mockReturnValue({
        provider: { id, name, apiHost, isEnabled: false, getApiKey: vi.fn(async () => '') },
        isLoading: false
      })
      const { result } = renderGuard({
        painting: { providerId: id, mode: 'generate', model },
        ensureCurrentCatalog: vi.fn(async () => [{ label: name, value: model }])
      })

      await expect(result.current.validateBeforeGenerate()).resolves.toEqual({
        ok: false,
        reason: 'provider_disabled'
      })
    }
  )

  it.each([
    { id: 'ovms', name: 'OpenVINO Model Server', apiHost: 'http://localhost:8000', model: 'ovms-model' },
    { id: 'ollama', name: 'Ollama', apiHost: 'http://localhost:11434', model: 'x/z-image-turbo:latest' }
  ])('exempts an enabled keyless local provider ($id) from the API key check', async ({ id, name, apiHost, model }) => {
    vi.mocked(usePaintingProviderRuntime).mockReturnValue({
      provider: { id, name, apiHost, isEnabled: true, getApiKey: vi.fn(async () => '') },
      isLoading: false
    })
    const { result } = renderGuard({
      painting: { providerId: id, mode: 'generate', model },
      ensureCurrentCatalog: vi.fn(async () => [{ label: name, value: model }])
    })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({ ok: true })
  })

  it('still blocks a disabled provider copied from the Ollama preset (matched via presetProviderId, not id) with provider_disabled', async () => {
    vi.mocked(usePaintingProviderRuntime).mockReturnValue({
      provider: {
        id: 'ollama-2',
        name: 'Ollama (copy)',
        presetProviderId: 'ollama',
        apiHost: 'http://localhost:11434',
        isEnabled: false,
        getApiKey: vi.fn(async () => '')
      },
      isLoading: false
    })
    const { result } = renderGuard({
      painting: { providerId: 'ollama-2', mode: 'generate', model: 'x/z-image-turbo:latest' },
      ensureCurrentCatalog: vi.fn(async () => [{ label: 'x/z-image-turbo', value: 'x/z-image-turbo:latest' }])
    })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({
      ok: false,
      reason: 'provider_disabled'
    })
  })

  it('exempts a provider copied from the Ollama preset (matched via presetProviderId, not id) from the API key check', async () => {
    vi.mocked(usePaintingProviderRuntime).mockReturnValue({
      provider: {
        id: 'ollama-2',
        name: 'Ollama (copy)',
        presetProviderId: 'ollama',
        apiHost: 'http://localhost:11434',
        isEnabled: true,
        getApiKey: vi.fn(async () => '')
      },
      isLoading: false
    })
    const { result } = renderGuard({
      painting: { providerId: 'ollama-2', mode: 'generate', model: 'x/z-image-turbo:latest' },
      ensureCurrentCatalog: vi.fn(async () => [{ label: 'x/z-image-turbo', value: 'x/z-image-turbo:latest' }])
    })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({ ok: true })
  })

  it('still blocks a disabled endpoint-only Ollama provider (no matching id or presetProviderId, matched via defaultChatEndpoint) with provider_disabled', async () => {
    vi.mocked(usePaintingProviderRuntime).mockReturnValue({
      provider: {
        id: 'custom-local',
        name: 'Local Ollama',
        defaultChatEndpoint: ENDPOINT_TYPE.OLLAMA_CHAT,
        apiHost: 'http://localhost:11434',
        isEnabled: false,
        getApiKey: vi.fn(async () => '')
      },
      isLoading: false
    })
    const { result } = renderGuard({
      painting: { providerId: 'custom-local', mode: 'generate', model: 'x/z-image-turbo:latest' },
      ensureCurrentCatalog: vi.fn(async () => [{ label: 'x/z-image-turbo', value: 'x/z-image-turbo:latest' }])
    })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({
      ok: false,
      reason: 'provider_disabled'
    })
  })

  it('exempts an enabled endpoint-only Ollama provider (created via Provider editor / deep link) from the API key check', async () => {
    vi.mocked(usePaintingProviderRuntime).mockReturnValue({
      provider: {
        id: 'custom-local',
        name: 'Local Ollama',
        defaultChatEndpoint: ENDPOINT_TYPE.OLLAMA_CHAT,
        apiHost: 'http://localhost:11434',
        isEnabled: true,
        getApiKey: vi.fn(async () => '')
      },
      isLoading: false
    })
    const { result } = renderGuard({
      painting: { providerId: 'custom-local', mode: 'generate', model: 'x/z-image-turbo:latest' },
      ensureCurrentCatalog: vi.fn(async () => [{ label: 'x/z-image-turbo', value: 'x/z-image-turbo:latest' }])
    })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({ ok: true })
  })

  it('allows a selected model that resolves through the current catalog load', async () => {
    const { result } = renderGuard({
      painting: {
        providerId: 'zhipu',
        mode: 'generate',
        model: 'async-model'
      },
      ensureCurrentCatalog: vi.fn(async () => [{ label: 'Async Model', value: 'async-model' }])
    })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({ ok: true })
  })
})
