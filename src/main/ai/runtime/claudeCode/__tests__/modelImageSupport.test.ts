import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MODALITY, MODEL_CAPABILITY } from '@shared/data/types/model'

const mocks = vi.hoisted(() => ({
  getByKey: vi.fn(),
  resolveModel: vi.fn(),
  getReasoningContextsByProviderIdsTx: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  all: vi.fn()
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: mocks.getByKey }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: { resolveModel: mocks.resolveModel },
  mergePresetModel: vi.fn((preset) => ({
    id: 'claude-code::claude-sonnet-5-5',
    providerId: 'claude-code',
    apiModelId: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    capabilities: preset.capabilities,
    inputModalities: preset.inputModalities,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }))
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getReasoningContextsByProviderIdsTx: mocks.getReasoningContextsByProviderIdsTx
  }
}))

vi.mock('@application', () => ({
  application: {
    get: () => ({
      getDb: () => ({
        select: mocks.select
      })
    })
  }
}))

const { resolveModelNativeImageSupport } = await import('../modelImageSupport')

describe('resolveModelNativeImageSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getReasoningContextsByProviderIdsTx.mockReturnValue(new Map([['claude-code', { id: 'claude-code' }]]))
    mocks.select.mockReturnValue({ from: mocks.from })
    mocks.from.mockReturnValue({ where: mocks.where })
    mocks.where.mockReturnValue({ limit: mocks.limit })
    mocks.limit.mockReturnValue({ all: mocks.all })
    mocks.all.mockReturnValue([{ inputModalities: null, inputModalitiesExplicit: false }])
    mocks.resolveModel.mockReturnValue({
      presetModel: {
        id: 'claude-sonnet-5-5',
        name: 'Claude Sonnet 5.5',
        capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION],
        inputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
      },
      registryOverride: null,
      reasoningProfile: { wire: { type: 'none' }, support: undefined },
      serviceTierControl: undefined
    })
  })

  it('returns true when the hydrated model is vision-capable', () => {
    mocks.getByKey.mockReturnValue({ capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION] })

    expect(resolveModelNativeImageSupport('claude-code::claude-sonnet-5-5')).toBe(true)
    expect(mocks.resolveModel).not.toHaveBeenCalled()
  })

  it('falls back to the registry when the stored row lacks synced vision metadata', () => {
    mocks.getByKey.mockReturnValue({
      capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL],
      inputModalities: [MODALITY.TEXT]
    })

    expect(resolveModelNativeImageSupport('claude-code::claude-sonnet-5-5')).toBe(true)
    expect(mocks.resolveModel).toHaveBeenCalledWith({ id: 'claude-code' }, 'claude-sonnet-5-5')
  })

  it('respects an explicit user disable of image input modalities', () => {
    mocks.getByKey.mockReturnValue({
      capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION],
      inputModalities: [MODALITY.TEXT]
    })
    mocks.all.mockReturnValue([{ inputModalities: [MODALITY.TEXT], inputModalitiesExplicit: true }])

    expect(resolveModelNativeImageSupport('claude-code::claude-sonnet-5-5')).toBe(false)
    expect(mocks.resolveModel).not.toHaveBeenCalled()
  })

  it('assumes vision-capable when the model row cannot be resolved', () => {
    mocks.getByKey.mockImplementation(() => {
      throw new Error('not found')
    })

    expect(resolveModelNativeImageSupport('claude-code::missing')).toBe(true)
  })
})
