import type { Model as V1Model } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toSharedCompatModel } from '../_bridge'
import { isEmbeddingModel, isRerankModel } from '../embedding'
import {
  isAutoEnableImageGenerationModel as _isAutoEnableImageGenerationModel,
  isDedicatedImageGenerationModel as _isDedicatedImageGenerationModel,
  isGenerateImageModel as _isGenerateImageModel,
  isImageEnhancementModel as _isImageEnhancementModel,
  isPureGenerateImageModel as _isPureGenerateImageModel,
  isTextToImageModel as _isTextToImageModel,
  isVisionModel as _isVisionModel
} from '../vision'

// Adapter: route v1-shape test fixtures through the same id→capability
// inference the registry uses (`toSharedCompatModel`), so the wrappers stay
// pure v2 while every existing assertion keeps its id→behaviour contract.
const adapt =
  <R>(fn: (m: Model) => R) =>
  (m: Partial<V1Model>): R =>
    fn(toSharedCompatModel(m as V1Model))
const isAutoEnableImageGenerationModel = adapt(_isAutoEnableImageGenerationModel)
const isDedicatedImageGenerationModel = adapt(_isDedicatedImageGenerationModel)
const isGenerateImageModel = adapt(_isGenerateImageModel)
const isImageEnhancementModel = adapt(_isImageEnhancementModel)
const isPureGenerateImageModel = adapt(_isPureGenerateImageModel)
const isTextToImageModel = adapt(_isTextToImageModel)
const isVisionModel = adapt(_isVisionModel)

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

vi.mock('../embedding', () => ({
  isEmbeddingModel: vi.fn(),
  isRerankModel: vi.fn()
}))

const createModel = (overrides: Partial<V1Model> = {}): V1Model =>
  ({ id: 'gpt-4o', name: 'gpt-4o', provider: 'openai', group: 'OpenAI', ...overrides }) as V1Model

const embeddingMock = vi.mocked(isEmbeddingModel)
const rerankMock = vi.mocked(isRerankModel)

describe('vision helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    embeddingMock.mockReturnValue(false)
    rerankMock.mockReturnValue(false)
  })

  describe('isGenerateImageModel', () => {
    it('detects third-party generative image models via capability', () => {
      expect(isGenerateImageModel(createModel({ id: 'gemini-2.5-flash-image' }))).toBe(true)
    })

    it('returns false for non-image models', () => {
      expect(isGenerateImageModel(createModel({ id: 'gpt-4.2-experimental' }))).toBe(false)
    })
  })

  describe('isPureGenerateImageModel', () => {
    it('requires both generate and text-to-image support', () => {
      expect(isPureGenerateImageModel(createModel({ id: 'gpt-image-1' }))).toBe(true)
      expect(isPureGenerateImageModel(createModel({ id: 'gpt-4o' }))).toBe(false)
      expect(isPureGenerateImageModel(createModel({ id: 'gemini-2.5-flash-image-preview' }))).toBe(true)
    })
  })

  describe('text-to-image helpers', () => {
    it('matches predefined keywords', () => {
      expect(isTextToImageModel(createModel({ id: 'midjourney-v6' }))).toBe(true)
      expect(isTextToImageModel(createModel({ id: 'gpt-4o' }))).toBe(false)
    })

    it('detects models with restricted image size support and enhancement', () => {
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
})

describe('isVisionModel', () => {
  it('reads the authoritative v2 capabilities array', () => {
    const disabled: Model = {
      ...toSharedCompatModel(createModel({ id: 'gpt-4o' })),
      capabilities: [],
      inputModalities: []
    }
    expect(_isVisionModel(disabled)).toBe(false)

    const forced: Model = {
      ...toSharedCompatModel(createModel({ id: 'gpt-4o' })),
      capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION]
    }
    expect(_isVisionModel(forced)).toBe(true)
  })

  it('detects vision via id', () => {
    expect(isVisionModel(createModel({ id: 'gpt-4o-mini' }))).toBe(true)
  })

  it('leverages image enhancement regex when standard vision regex does not match', () => {
    expect(isVisionModel(createModel({ id: 'qwen-image-edit' }))).toBe(true)
  })

  describe('Gemini Models', () => {
    it('should return true for gemini 1.5 models', () => {
      expect(
        isVisionModel({
          id: 'gemini-1.5-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-1.5-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini 2.x models', () => {
      expect(
        isVisionModel({
          id: 'gemini-2.0-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-2.0-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-2.5-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-2.5-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini latest models', () => {
      expect(
        isVisionModel({
          id: 'gemini-flash-latest',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-pro-latest',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-flash-lite-latest',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini 3 models', () => {
      // Preview versions
      expect(
        isVisionModel({
          id: 'gemini-3-pro-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      // Future stable versions
      expect(
        isVisionModel({
          id: 'gemini-3-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-3-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini 3.1 models', () => {
      // Preview versions
      expect(
        isVisionModel({
          id: 'gemini-3.1-pro-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      // Stable versions
      expect(
        isVisionModel({
          id: 'gemini-3.1-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isVisionModel({
          id: 'gemini-3.1-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini exp models', () => {
      expect(
        isVisionModel({
          id: 'gemini-exp-1206',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return false for gemini 1.0 models', () => {
      expect(
        isVisionModel({
          id: 'gemini-1.0-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })
  })

  describe('Kimi Models', () => {
    it('should return true for kimi models', () => {
      expect(isVisionModel(createModel({ id: 'kimi-k2.5' }))).toBe(true)
      expect(isVisionModel(createModel({ id: 'moonshot/kimi-k2.5' }))).toBe(true)
      expect(isVisionModel(createModel({ id: 'kimi-k2.6' }))).toBe(true)
      expect(isVisionModel(createModel({ id: 'moonshot/kimi-k2.6' }))).toBe(true)
    })
    it('should return false for kimi non-vision models', () => {
      expect(isVisionModel(createModel({ id: 'kimi-k2-thinking' }))).toBe(false)
    })
  })

  describe('MiMo Models', () => {
    it('should identify only the full-modal V2.5 chat model as vision-capable', () => {
      expect(isVisionModel(createModel({ id: 'mimo-v2.5' }))).toBe(true)
      expect(isVisionModel(createModel({ id: 'xiaomi/mimo-v2.5' }))).toBe(true)
      expect(isVisionModel(createModel({ id: 'mimo-v2.5-pro' }))).toBe(false)
      expect(isVisionModel(createModel({ id: 'mimo-v2.5-tts' }))).toBe(false)
    })
  })

  describe('Qwen Models', () => {
    it('should return true for Qwen vision models', () => {
      expect(isVisionModel(createModel({ id: 'qwen-vl-max' }))).toBe(true)
      expect(isVisionModel(createModel({ id: 'qwen3-vl' }))).toBe(true)
      expect(isVisionModel(createModel({ id: 'qwen3.5-plus' }))).toBe(true)
      expect(isVisionModel(createModel({ id: 'qwen3.5-plus-2026-02-15' }))).toBe(true)
      expect(isVisionModel(createModel({ id: 'qwen3.5-397b-a17b' }))).toBe(true)
    })
  })
})

describe('Doubao Seed 2.0 Models', () => {
  it('should identify doubao-seed-2-0-pro-260215 as vision model', () => {
    const model = createModel({
      id: 'doubao-seed-2-0-pro-260215',
      name: 'doubao-seed-2-0-pro',
      provider: 'doubao',
      group: 'Doubao-Seed-2.0'
    })
    expect(isVisionModel(model)).toBe(true)
  })

  it('should identify doubao-seed-2-0-lite-260215 as vision model', () => {
    const model = createModel({
      id: 'doubao-seed-2-0-lite-260215',
      name: 'doubao-seed-2-0-lite',
      provider: 'doubao',
      group: 'Doubao-Seed-2.0'
    })
    expect(isVisionModel(model)).toBe(true)
  })

  it('should identify doubao-seed-2-0-code-preview-260215 as vision model', () => {
    const model = createModel({
      id: 'doubao-seed-2-0-code-preview-260215',
      name: 'doubao-seed-2-0-code-preview',
      provider: 'doubao',
      group: 'Doubao-Seed-2.0'
    })
    expect(isVisionModel(model)).toBe(true)
  })

  it('should identify doubao-seed-2-0-mini-260215 as vision model', () => {
    const model = createModel({
      id: 'doubao-seed-2-0-mini-260215',
      name: 'doubao-seed-2-0-mini',
      provider: 'doubao',
      group: 'Doubao-Seed-2.0'
    })
    expect(isVisionModel(model)).toBe(true)
  })
})

describe('Gemma 4 Models', () => {
  it('detects Gemma 4 GenAI format as vision', () => {
    expect(isVisionModel(createModel({ id: 'gemma-4-e2b' }))).toBe(true)
    expect(isVisionModel(createModel({ id: 'gemma-4-e4b' }))).toBe(true)
    expect(isVisionModel(createModel({ id: 'gemma-4-26b-moe' }))).toBe(true)
    expect(isVisionModel(createModel({ id: 'gemma-4-31b' }))).toBe(true)
  })

  it('detects Gemma 4 Ollama format as vision', () => {
    expect(isVisionModel(createModel({ id: 'gemma4' }))).toBe(true)
    expect(isVisionModel(createModel({ id: 'gemma4:e2b' }))).toBe(true)
    expect(isVisionModel(createModel({ id: 'gemma4:31b' }))).toBe(true)
    expect(isVisionModel(createModel({ id: 'gemma4:latest' }))).toBe(true)
  })

  it('detects Gemma 4 with provider prefix', () => {
    expect(isVisionModel(createModel({ id: 'google/gemma-4-31b' }))).toBe(true)
  })

  it('still detects Gemma 3 as vision (no regression)', () => {
    expect(isVisionModel(createModel({ id: 'gemma-3-27b' }))).toBe(true)
    expect(isVisionModel(createModel({ id: 'gemma-3-4b' }))).toBe(true)
    expect(isVisionModel(createModel({ id: 'gemma3' }))).toBe(true)
    expect(isVisionModel(createModel({ id: 'gemma3:latest' }))).toBe(true)
  })

  it('does NOT detect Gemma 2 as vision (no regression)', () => {
    expect(isVisionModel(createModel({ id: 'gemma-2b' }))).toBe(false)
    expect(isVisionModel(createModel({ id: 'gemma-2-27b-it' }))).toBe(false)
  })
})

describe('Mistral Models', () => {
  // Regression test for mistral-small-2603 vision support (broken in previous implementation)
  it('should return true for mistral-small-2603', () => {
    expect(isVisionModel(createModel({ id: 'mistral-small-2603' }))).toBe(true)
  })

  it('should return true for mistral-small-2603 with provider prefix', () => {
    expect(isVisionModel(createModel({ id: 'mistralai/mistral-small-2603' }))).toBe(true)
  })

  // Regression check for existing mistral-small variants
  it('should return true for mistral-small-latest', () => {
    expect(isVisionModel(createModel({ id: 'mistral-small-latest' }))).toBe(true)
  })

  it('should return true for mistral-small-2506', () => {
    expect(isVisionModel(createModel({ id: 'mistral-small-2506' }))).toBe(true)
  })

  // Regression check for pixtral models (dedicated vision models)
  it('should return true for pixtral models', () => {
    expect(isVisionModel(createModel({ id: 'pixtral-12b' }))).toBe(true)
    expect(isVisionModel(createModel({ id: 'pixtral-large' }))).toBe(true)
  })
})
