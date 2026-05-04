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
      selectorData: {
        providers: [],
        models: [
          {
            id: 'zhipu::cogview-4',
            providerId: 'zhipu',
            apiModelId: 'cogview-4',
            name: 'CogView 4',
            capabilities: ['image-generation'],
            supportsStreaming: false,
            isEnabled: true,
            isHidden: false
          }
        ],
        selectedModelId: 'zhipu::cogview-4'
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

  it('allows a selected model that resolves through the current catalog load', async () => {
    const { result } = renderGuard({
      painting: {
        providerId: 'zhipu',
        mode: 'generate',
        model: 'async-model'
      },
      selectorData: {
        providers: [],
        models: [],
        selectedModelId: 'zhipu::async-model'
      },
      ensureCurrentCatalog: vi.fn(async () => [{ label: 'Async Model', value: 'async-model' }])
    })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({ ok: true })
  })
})
