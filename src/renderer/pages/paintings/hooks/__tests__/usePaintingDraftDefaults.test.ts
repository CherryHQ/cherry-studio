import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  defaultModelId: 'openai::dall-e-3' as string | null,
  defaultProvider: 'zhipu',
  model: undefined as
    | {
        apiModelId: string
        capabilities: string[]
        id: string
        isEnabled: boolean
        isHidden: boolean
        outputModalities: string[]
        providerId: string
      }
    | undefined,
  setDefaultProvider: vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'feature.paintings.default_model_id') return [mocks.defaultModelId, vi.fn()]
    return [mocks.defaultProvider, mocks.setDefaultProvider]
  }
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: () => ({ model: mocks.model })
}))

const { usePaintingDraftDefaults } = await import('../usePaintingDraftDefaults')

describe('usePaintingDraftDefaults', () => {
  beforeEach(() => {
    mocks.defaultModelId = 'openai::dall-e-3'
    mocks.defaultProvider = 'zhipu'
    mocks.model = undefined
    mocks.setDefaultProvider.mockReset()
  })

  it('derives a new draft provider and model from the configured painting model', () => {
    mocks.model = {
      id: 'openai::dall-e-3',
      providerId: 'openai',
      apiModelId: 'dall-e-3',
      capabilities: ['image-generation'],
      outputModalities: ['image'],
      isEnabled: true,
      isHidden: false
    }
    const { result } = renderHook(() => usePaintingDraftDefaults(['openai', 'zhipu']))

    expect(result.current).toEqual({ providerId: 'openai', modelId: 'dall-e-3' })
  })

  it('falls back to the available provider when the configured model cannot be resolved', () => {
    const { result } = renderHook(() => usePaintingDraftDefaults(['zhipu', 'openai']))

    expect(result.current).toEqual({ providerId: 'zhipu', modelId: undefined })
  })

  it('falls back when the configured model provider is unavailable', () => {
    mocks.model = {
      id: 'openai::dall-e-3',
      providerId: 'openai',
      apiModelId: 'dall-e-3',
      capabilities: ['image-generation'],
      outputModalities: ['image'],
      isEnabled: true,
      isHidden: false
    }

    const { result } = renderHook(() => usePaintingDraftDefaults(['zhipu']))

    expect(result.current).toEqual({ providerId: 'zhipu', modelId: undefined })
  })

  it('skips a preferred provider that is absent from the available provider options', () => {
    mocks.defaultProvider = 'empty-compat'

    const { result } = renderHook(() => usePaintingDraftDefaults(['openai']))

    expect(result.current).toEqual({ providerId: 'openai', modelId: undefined })
  })
})
