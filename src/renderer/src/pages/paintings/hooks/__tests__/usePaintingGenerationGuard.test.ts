import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { usePaintingGenerationGuard } from '../usePaintingGenerationGuard'

function renderGuard(overrides: Partial<Parameters<typeof usePaintingGenerationGuard>[0]> = {}) {
  return renderHook(() =>
    usePaintingGenerationGuard({
      providerId: 'zhipu',
      mode: 'generate',
      modelId: 'cogview-4',
      provider: {
        id: 'zhipu',
        name: 'Zhipu',
        apiHost: 'https://example.com',
        isEnabled: true,
        getApiKey: vi.fn(async () => 'token')
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
  it('blocks disabled providers before generation', async () => {
    const { result } = renderGuard({
      provider: {
        id: 'zhipu',
        name: 'Zhipu',
        apiHost: 'https://example.com',
        isEnabled: false,
        getApiKey: vi.fn(async () => 'token')
      }
    })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({
      ok: false,
      reason: 'provider_disabled'
    })
  })

  it('blocks missing models', async () => {
    const { result } = renderGuard({ modelId: '' })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({
      ok: false,
      reason: 'model_missing'
    })
  })

  it('blocks unavailable or orphan models', async () => {
    const { result } = renderGuard({
      modelId: 'stale-model',
      ensureCurrentCatalog: vi.fn(async () => [{ label: 'CogView 4', value: 'cogview-4' }])
    })

    await expect(result.current.validateBeforeGenerate()).resolves.toEqual({
      ok: false,
      reason: 'model_unavailable'
    })
  })

  it('allows a selected model that resolves through the current catalog load', async () => {
    const { result } = renderGuard({
      modelId: 'async-model',
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
