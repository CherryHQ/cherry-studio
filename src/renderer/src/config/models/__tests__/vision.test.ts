import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useStore', () => ({
  getStoreProviders: vi.fn(() => [])
}))

vi.mock('@renderer/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      llm: { providers: [] },
      settings: {}
    })
  },
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn()
}))

vi.mock('@renderer/store/settings', () => {
  const noop = vi.fn()
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'initialState') {
          return {}
        }
        return noop
      }
    }
  )
})

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({})),
  useNavbarPosition: vi.fn(() => ({ navbarPosition: 'left' })),
  useMessageStyle: vi.fn(() => ({ isBubbleStyle: false })),
  getStoreSetting: vi.fn()
}))

import { isEmbeddingModel, isRerankModel } from '../embedding'
import {
  isAutoEnableImageGenerationModel,
  isDedicatedImageGenerationModel,
  isGenerateImageModel,
  isImageEnhancementModel,
  isNotSupportedImageSizeModel,
  isPureGenerateImageModel,
  isTextToImageModel,
  isVisionModel
} from '../vision'

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: vi.fn()
}))

vi.mock('../embedding', () => ({
  isEmbeddingModel: vi.fn(),
  isRerankModel: vi.fn()
}))

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'gpt-4o',
  name: 'gpt-4o',
  provider: 'openai',
  group: 'OpenAI',
  ...overrides
})

const providerMock = vi.mocked(getProviderByModel)
const embeddingMock = vi.mocked(isEmbeddingModel)
const rerankMock = vi.mocked(isRerankModel)

describe('vision helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerMock.mockReturnValue({ type: 'openai-response' } as any)
    embeddingMock.mockReturnValue(false)
    rerankMock.mockReturnValue(false)
  })

  describe('isGenerateImageModel', () => {
    it('returns false for embedding/rerank models or missing providers', () => {
      embeddingMock.mockReturnValueOnce(true)
      expect(isGenerateImageModel(createModel({ id: 'gpt-image-1' }))).toBe(false)

      embeddingMock.mockReturnValue(false)
      rerankMock.mockReturnValueOnce(true)
      expect(isGenerateImageModel(createModel({ id: 'gpt-image-1' }))).toBe(false)

      rerankMock.mockReturnValue(false)
      providerMock.mockReturnValueOnce(undefined as any)
      expect(isGenerateImageModel(createModel({ id: 'gpt-image-1' }))).toBe(false)
    })

    it('detects OpenAI and third-party generative image models', () => {
      expect(isGenerateImageModel(createModel({ id: 'gpt-4o-mini' }))).toBe(true)

      providerMock.mockReturnValue({ type: 'custom' } as any)
      expect(isGenerateImageModel(createModel({ id: 'gemini-2.5-flash-image' }))).toBe(true)
    })

    it('returns false when openai-response model is not on allow list', () => {
      expect(isGenerateImageModel(createModel({ id: 'gpt-4.2-experimental' }))).toBe(false)
    })
  })

  describe('isPureGenerateImageModel', () => {
    it('requires both generate and text-to-image support', () => {
      expect(isPureGenerateImageModel(createModel({ id: 'gpt-image-1' }))).toBe(true)
      expect(isPureGenerateImageModel(createModel({ id: 'gpt-4o' }))).toBe(false)
    })
  })

  describe('text-to-image helpers', () => {
    it('matches predefined keywords', () => {
      expect(isTextToImageModel(createModel({ id: 'midjourney-v6' }))).toBe(true)
      expect(isTextToImageModel(createModel({ id: 'gpt-4o' }))).toBe(false)
    })

    it('detects models with restricted image size support and enhancement', () => {
      expect(isNotSupportedImageSizeModel(createModel({ id: 'grok-2-image-latest' }))).toBe(true)
      expect(isImageEnhancementModel(createModel({ id: 'qwen-image-edit' }))).toBe(true)
      expect(isImageEnhancementModel(createModel({ id: 'gpt-4o' }))).toBe(false)
    })

    it('identifies dedicated and auto-enabled image generation models', () => {
      expect(isDedicatedImageGenerationModel(createModel({ id: 'grok-2-image-1212' }))).toBe(true)
      expect(isAutoEnableImageGenerationModel(createModel({ id: 'gemini-2.5-flash-image-ultra' }))).toBe(true)
    })

    it('returns false when models are not in dedicated or auto-enable sets', () => {
      expect(isDedicatedImageGenerationModel(createModel({ id: 'gpt-4o' }))).toBe(false)
      expect(isAutoEnableImageGenerationModel(createModel({ id: 'gpt-4o' }))).toBe(false)
    })
  })

  describe('isVisionModel', () => {
    it('returns false for embedding/rerank models and honors overrides', () => {
      embeddingMock.mockReturnValueOnce(true)
      expect(isVisionModel(createModel({ id: 'gpt-4o' }))).toBe(false)

      embeddingMock.mockReturnValue(false)
      const disabled = createModel({
        id: 'gpt-4o',
        capabilities: [{ type: 'vision', isUserSelected: false }]
      })
      expect(isVisionModel(disabled)).toBe(false)

      const forced = createModel({
        id: 'gpt-4o',
        capabilities: [{ type: 'vision', isUserSelected: true }]
      })
      expect(isVisionModel(forced)).toBe(true)
    })

    it('matches doubao models by name and general regexes by id', () => {
      const doubao = createModel({
        id: 'custom-id',
        provider: 'doubao',
        name: 'Doubao-Seed-1-6-Lite-251015'
      })
      expect(isVisionModel(doubao)).toBe(true)

      expect(isVisionModel(createModel({ id: 'gpt-4o-mini' }))).toBe(true)
    })

    it('leverages image enhancement regex when standard vision regex does not match', () => {
      expect(isVisionModel(createModel({ id: 'qwen-image-edit' }))).toBe(true)
    })

    it('returns false for doubao models that fail regex checks', () => {
      const doubao = createModel({ id: 'doubao-standard', provider: 'doubao', name: 'basic' })
      expect(isVisionModel(doubao)).toBe(false)
    })
  })
})
