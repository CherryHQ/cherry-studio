import { describe, expect, it } from 'vitest'

import { MODEL_CAPABILITY, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { DEFAULT_PROVIDER_SETTINGS } from '@shared/data/types/provider'
import {
  isForceTextExtractionProvider,
  isVideoVisionSelectableModel,
  supportsGenerateTextAudioInput,
  supportsVisionFileInput
} from '@shared/utils/nativeFileSupport'

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    apiModelId: 'gpt-4o',
    name: 'gpt-4o',
    capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'openai',
    name: 'OpenAI',
    apiKeys: [],
    authType: 'api-key',
    reportsActualCost: false,
    settings: { ...DEFAULT_PROVIDER_SETTINGS },
    isEnabled: true,
    ...overrides
  }
}

describe('supportsVisionFileInput', () => {
  it('keeps a vision chat model on a normal provider', () => {
    expect(supportsVisionFileInput(createProvider(), createModel())).toBe(true)
  })

  it('rejects non-vision models', () => {
    expect(supportsVisionFileInput(createProvider(), createModel({ capabilities: [] }))).toBe(false)
  })

  it('rejects force-text providers such as qiniu', () => {
    expect(supportsVisionFileInput(createProvider({ id: 'qiniu' }), createModel())).toBe(false)
    expect(isForceTextExtractionProvider(createProvider({ id: 'qiniu' }))).toBe(true)
  })

  it('rejects custom providers that clone a force-text preset', () => {
    expect(
      supportsVisionFileInput(createProvider({ id: 'my-qiniu-clone', presetProviderId: 'qiniu' }), createModel())
    ).toBe(false)
  })
})

describe('supportsGenerateTextAudioInput', () => {
  it('keeps google/openrouter and rejects force-text / anthropic-family hosts', () => {
    expect(supportsGenerateTextAudioInput(createProvider({ id: 'google' }))).toBe(true)
    expect(supportsGenerateTextAudioInput(createProvider({ id: 'openrouter' }))).toBe(true)
    expect(supportsGenerateTextAudioInput(createProvider({ id: 'openai' }))).toBe(true)
    expect(supportsGenerateTextAudioInput(createProvider({ id: 'qiniu' }))).toBe(false)
    expect(supportsGenerateTextAudioInput(createProvider({ id: 'anthropic' }))).toBe(false)
    expect(supportsGenerateTextAudioInput(createProvider({ id: 'custom', presetProviderId: 'bedrock' }))).toBe(false)
  })
})

describe('isVideoVisionSelectableModel', () => {
  it('keeps a vision chat model when its provider can take image parts', () => {
    expect(isVideoVisionSelectableModel(createModel(), createProvider())).toBe(true)
  })

  it('rejects dedicated speech / embedding / generation models even when vision-tagged', () => {
    expect(
      isVideoVisionSelectableModel(
        createModel({ capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION, MODEL_CAPABILITY.AUDIO_TRANSCRIPT] }),
        createProvider()
      )
    ).toBe(false)
    expect(
      isVideoVisionSelectableModel(
        createModel({ capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION, MODEL_CAPABILITY.EMBEDDING] }),
        createProvider()
      )
    ).toBe(false)
    expect(
      isVideoVisionSelectableModel(
        createModel({ capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION, MODEL_CAPABILITY.IMAGE_GENERATION] }),
        createProvider()
      )
    ).toBe(false)
  })

  it('rejects force-text providers and missing provider metadata', () => {
    expect(isVideoVisionSelectableModel(createModel(), createProvider({ id: 'qiniu' }))).toBe(false)
    expect(isVideoVisionSelectableModel(createModel())).toBe(false)
    expect(isVideoVisionSelectableModel(createModel(), null)).toBe(false)
  })
})
