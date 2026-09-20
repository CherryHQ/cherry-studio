import { describe, expect, it } from 'vitest'

import { MODEL_CAPABILITY, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { DEFAULT_PROVIDER_SETTINGS } from '@shared/data/types/provider'
import { isOpenAiTranscriptionModel, isProviderMediaTranscriptionModel } from '@shared/utils/mediaTranscriptionModels'

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::model',
    providerId: 'openai',
    apiModelId: 'model',
    name: 'model',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'google',
    name: 'Google',
    apiKeys: [],
    authType: 'api-key',
    reportsActualCost: false,
    settings: { ...DEFAULT_PROVIDER_SETTINGS },
    isEnabled: true,
    ...overrides
  }
}

describe('media transcription model filters', () => {
  const multimodalAudioChat = createModel({
    id: 'google::gemini',
    providerId: 'google',
    apiModelId: 'gemini-2.0-flash',
    name: 'gemini-2.0-flash',
    capabilities: [MODEL_CAPABILITY.AUDIO_RECOGNITION, MODEL_CAPABILITY.IMAGE_RECOGNITION],
    inputModalities: ['text', 'audio', 'image'],
    outputModalities: ['text']
  })

  const dedicatedAsr = createModel({
    id: 'openai::whisper-1',
    apiModelId: 'whisper-1',
    name: 'whisper-1',
    capabilities: [MODEL_CAPABILITY.AUDIO_TRANSCRIPT]
  })

  const audioOnlySpeech = createModel({
    id: 'openai::asr',
    apiModelId: 'asr',
    name: 'asr',
    capabilities: [MODEL_CAPABILITY.AUDIO_RECOGNITION],
    inputModalities: ['audio'],
    outputModalities: ['text']
  })

  const plainChat = createModel({
    id: 'openai::gpt-4o',
    apiModelId: 'gpt-4o',
    name: 'gpt-4o',
    capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION],
    inputModalities: ['text', 'image'],
    outputModalities: ['text']
  })

  it('keeps multimodal audio chat models for provider-media and excludes dedicated ASR', () => {
    const google = createProvider({ id: 'google' })
    expect(isProviderMediaTranscriptionModel(multimodalAudioChat, google)).toBe(true)
    expect(isProviderMediaTranscriptionModel(dedicatedAsr, google)).toBe(false)
    expect(isProviderMediaTranscriptionModel(audioOnlySpeech, google)).toBe(false)
    expect(isProviderMediaTranscriptionModel(plainChat, google)).toBe(false)
  })

  it('rejects force-text and known no-audio first-party providers for provider-media', () => {
    expect(isProviderMediaTranscriptionModel(multimodalAudioChat, createProvider({ id: 'qiniu' }))).toBe(false)
    expect(isProviderMediaTranscriptionModel(multimodalAudioChat, createProvider({ id: 'anthropic' }))).toBe(false)
    expect(isProviderMediaTranscriptionModel(multimodalAudioChat, createProvider({ id: 'xai' }))).toBe(false)
    expect(isProviderMediaTranscriptionModel(multimodalAudioChat)).toBe(false)
  })

  it('keeps openai/openrouter hosts selectable when the model can hear (chat path may accept audio)', () => {
    expect(
      isProviderMediaTranscriptionModel(multimodalAudioChat, createProvider({ id: 'openai', name: 'OpenAI' }))
    ).toBe(true)
    expect(
      isProviderMediaTranscriptionModel(multimodalAudioChat, createProvider({ id: 'openrouter', name: 'OpenRouter' }))
    ).toBe(true)
  })

  it('keeps dedicated ASR for openai-transcription and excludes generic multimodal chat', () => {
    expect(isOpenAiTranscriptionModel(dedicatedAsr)).toBe(true)
    expect(isOpenAiTranscriptionModel(audioOnlySpeech)).toBe(true)
    expect(isOpenAiTranscriptionModel(multimodalAudioChat)).toBe(false)
    expect(isOpenAiTranscriptionModel(plainChat)).toBe(false)
  })
})
