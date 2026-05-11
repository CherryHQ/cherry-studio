import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isGenerateImageModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@shared/utils/model'
import { describe, expect, it } from 'vitest'

const createModel = (capabilities: Model['capabilities'] = []): Model => ({
  id: 'openai::gpt-4o',
  providerId: 'openai',
  apiModelId: 'gpt-4o',
  name: 'gpt-4o',
  capabilities,
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
})

describe('shared model capability helpers', () => {
  it('reads capability state from v2 Model.capabilities', () => {
    const model = createModel([
      MODEL_CAPABILITY.REASONING,
      MODEL_CAPABILITY.FUNCTION_CALL,
      MODEL_CAPABILITY.IMAGE_RECOGNITION,
      MODEL_CAPABILITY.WEB_SEARCH
    ])

    expect(isReasoningModel(model)).toBe(true)
    expect(isFunctionCallingModel(model)).toBe(true)
    expect(isVisionModel(model)).toBe(true)
    expect(isWebSearchModel(model)).toBe(true)
  })

  it('does not infer capabilities from model id or name at runtime', () => {
    const model: Model = {
      ...createModel(),
      id: 'google::gemini-3.1-pro-preview',
      apiModelId: 'gemini-3.1-pro-preview',
      name: 'gemini-3.1-pro-preview'
    }

    expect(isReasoningModel(model)).toBe(false)
    expect(isFunctionCallingModel(model)).toBe(false)
    expect(isVisionModel(model)).toBe(false)
    expect(isWebSearchModel(model)).toBe(false)
  })

  it('keeps embedding, rerank, and image generation as explicit capability checks', () => {
    expect(isEmbeddingModel(createModel([MODEL_CAPABILITY.EMBEDDING]))).toBe(true)
    expect(isRerankModel(createModel([MODEL_CAPABILITY.RERANK]))).toBe(true)
    expect(isGenerateImageModel(createModel([MODEL_CAPABILITY.IMAGE_GENERATION]))).toBe(true)
  })
})
