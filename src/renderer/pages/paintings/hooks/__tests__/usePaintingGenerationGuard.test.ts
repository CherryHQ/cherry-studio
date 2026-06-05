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

  it('exempts keyless local providers (OVMS) from the enable / API key checks', async () => {
    // A running OVMS provider is selectable with no API key and may report
    // `isEnabled: false`; the guard must defer to the model availability check
    // instead of rejecting it with provider_disabled / no_api_key.
    vi.mocked(usePaintingProviderRuntime).mockReturnValue({
      provider: {
        id: 'ovms',
        name: 'OpenVINO Model Server',
        apiHost: 'http://localhost:8000',
        isEnabled: false,
        getApiKey: vi.fn(async () => '')
      },
      isLoading: false
    })
    const { result } = renderGuard({
      painting: { providerId: 'ovms', mode: 'generate', model: 'ovms-model' },
      ensureCurrentCatalog: vi.fn(async () => [{ label: 'OVMS Model', value: 'ovms-model' }])
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
