import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import {
  inferEmbeddingFromModelId,
  inferFunctionCallingFromModelId,
  inferImageGenerationFromModelId,
  inferReasoningFromModelId,
  inferRerankFromModelId,
  inferVisionFromModelId,
  inferWebSearchFromModelId,
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

  it('covers known capability inference regression ids', () => {
    expect(inferFunctionCallingFromModelId('gpt-oss')).toBe(true)
    expect(inferFunctionCallingFromModelId('gpt-oss-120b')).toBe(true)

    expect(inferVisionFromModelId('kimi-k2.6')).toBe(true)
    expect(inferVisionFromModelId('kimi-k2.6-preview')).toBe(true)
    expect(inferVisionFromModelId('kimi-k2X5')).toBe(false)

    expect(inferVisionFromModelId('gemini-3-flash-image')).toBe(true)
    expect(inferImageGenerationFromModelId('gemini-3-flash-image')).toBe(true)
  })

  it.each([
    'claude-3.7-sonnet',
    'claude-sonnet-4-5',
    'gemini-2.5-flash',
    'gemini-3-pro-preview',
    'gpt-5.1',
    'gpt-oss',
    'o3-mini',
    'qwen-plus',
    'qwen3.5-plus',
    'deepseek-r1',
    'hunyuan-a13b',
    'kimi-k2.5'
  ])('infers reasoning capability for %s', (modelId) => {
    expect(inferReasoningFromModelId(modelId)).toBe(true)
  })

  it.each(['gpt-5.1-chat', 'gemini-3-flash-image', 'text-embedding-3-small', 'bge-reranker-v2'])(
    'does not infer reasoning capability for %s',
    (modelId) => {
      expect(inferReasoningFromModelId(modelId)).toBe(false)
    }
  )

  it.each([
    'gpt-4o-mini',
    'gpt-5.2',
    'o4-mini',
    'claude-opus-4.1',
    'gemini-3.1-pro-preview',
    'gemini-flash-latest',
    'qwen3-vl',
    'qwen3.5-plus',
    'doubao-seed-2.0',
    'gemma4:31b',
    'kimi-k2.6-preview',
    'mistral-small-latest'
  ])('infers vision capability for %s', (modelId) => {
    expect(inferVisionFromModelId(modelId)).toBe(true)
  })

  it.each(['gpt-4-32k', 'o1-mini', 'text-embedding-3-large', 'jina-embeddings-v4', 'bge-reranker-v2'])(
    'does not infer vision capability for %s',
    (modelId) => {
      expect(inferVisionFromModelId(modelId)).toBe(false)
    }
  )

  it.each([
    'gpt-4o',
    'gpt-oss',
    'gpt-oss-120b',
    'o3',
    'claude-3-5-sonnet-latest',
    'gemini-2.5-pro',
    'gemma-4-31b',
    'grok-4-fast',
    'qwen3-max',
    'kimi-k2'
  ])('infers function-calling capability for %s', (modelId) => {
    expect(inferFunctionCallingFromModelId(modelId)).toBe(true)
  })

  it.each(['text-embedding-3-small', 'bge-reranker-large', 'dall-e-3', 'gemini-3-pro-image', 'gpt-5-chat'])(
    'does not infer function-calling capability for %s',
    (modelId) => {
      expect(inferFunctionCallingFromModelId(modelId)).toBe(false)
    }
  )

  it.each(['text-embedding-3-small', 'bge-m3', 'e5-large-v2', 'jina-embeddings-v4', 'voyage-3-large'])(
    'infers embedding capability for %s',
    (modelId) => {
      expect(inferEmbeddingFromModelId(modelId)).toBe(true)
    }
  )

  it.each(['bge-reranker-v2-m3', 'jina-reranker-v2-base-multilingual', 'cohere-rerank-english-v3.0'])(
    'infers rerank capability for %s',
    (modelId) => {
      expect(inferRerankFromModelId(modelId)).toBe(true)
    }
  )

  it.each([
    'gpt-4o-search-preview',
    'gpt-4.1',
    'o3',
    'gpt-5.1',
    'claude-3-5-sonnet-latest',
    'claude-sonnet-4-5',
    'gemini-2.5-pro',
    'gemini-3-flash-preview'
  ])('infers web-search capability for %s', (modelId) => {
    expect(inferWebSearchFromModelId(modelId)).toBe(true)
  })

  it.each(['gpt-4.1-nano', 'gpt-4o-image', 'gpt-5-chat'])('does not infer web-search capability for %s', (modelId) => {
    expect(inferWebSearchFromModelId(modelId)).toBe(false)
  })

  it.each(['dall-e-3', 'gpt-image-1', 'qwen-image-edit', 'gemini-3-pro-image', 'gemini-3-flash-image'])(
    'infers image-generation capability for %s',
    (modelId) => {
      expect(inferImageGenerationFromModelId(modelId)).toBe(true)
    }
  )
})
