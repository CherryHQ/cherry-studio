import { MODALITY } from '@cherrystudio/provider-registry'
import { createUniqueModelId, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPreferenceMock, getByProviderIdMock, getByKeyMock, listModelsMock } = vi.hoisted(() => ({
  getPreferenceMock: vi.fn(),
  getByProviderIdMock: vi.fn(),
  getByKeyMock: vi.fn(),
  listModelsMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (serviceName: string) => {
      if (serviceName === 'PreferenceService') return { get: getPreferenceMock }
      throw new Error(`Unexpected service: ${serviceName}`)
    }
  }
}))

vi.mock('@main/data/services/ModelService', () => ({
  modelService: {
    getByKey: getByKeyMock,
    list: listModelsMock
  }
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: getByProviderIdMock
  }
}))

const { SpeechCapabilityResolver } = await import('../SpeechCapabilityResolver')

function makeChatModel(providerId: string, modelId: string, overrides: Partial<Model> = {}): Model {
  return {
    id: createUniqueModelId(providerId, modelId),
    providerId,
    apiModelId: modelId,
    name: modelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

function makeAudioChatModel(providerId: string, modelId: string): Model {
  return makeChatModel(providerId, modelId, {
    capabilities: [MODEL_CAPABILITY.AUDIO_RECOGNITION],
    inputModalities: [MODALITY.TEXT, MODALITY.AUDIO]
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getByProviderIdMock.mockImplementation((providerId: string) => ({
    id: providerId,
    isEnabled: true,
    authMethods: []
  }))
  listModelsMock.mockReturnValue([])
})

describe('SpeechCapabilityResolver', () => {
  it('prefers the dedicated pronunciation model before the default chat model for audio evaluation', () => {
    const pronunciationModel = makeAudioChatModel('openai', 'gpt-4o-audio-preview')
    const defaultModel = makeAudioChatModel('openai', 'gpt-4o')

    getPreferenceMock.mockImplementation((key: string) => {
      if (key === 'feature.english_learning.model.pronunciation_id') return pronunciationModel.id
      if (key === 'chat.default_model_id') return defaultModel.id
      return null
    })
    getByKeyMock.mockImplementation((providerId: string, modelId: string) => {
      if (providerId === 'openai' && modelId === 'gpt-4o-audio-preview') return pronunciationModel
      if (providerId === 'openai' && modelId === 'gpt-4o') return defaultModel
      throw new Error(`Unexpected model: ${providerId}/${modelId}`)
    })

    const capabilities = new SpeechCapabilityResolver().resolve()

    expect(capabilities.models.audioEvaluation?.uniqueModelId).toBe(pronunciationModel.id)
  })
})
