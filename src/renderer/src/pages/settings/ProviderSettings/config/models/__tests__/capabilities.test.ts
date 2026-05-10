import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { describe, expect, it, vi } from 'vitest'

import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isGenerateImageModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '..'

vi.mock('@renderer/utils', () => ({
  getLowerBaseModelName: (id: string, delimiter = '/') => {
    const normalizedId = id.toLowerCase().startsWith('accounts/fireworks/models/')
      ? id.replace(/(\d)p(?=\d)/g, '$1.')
      : id
    let baseModelName = normalizedId.split(delimiter).at(-1)?.toLowerCase() ?? ''
    if (baseModelName.endsWith(':free')) {
      baseModelName = baseModelName.replace(':free', '')
    }
    if (baseModelName.endsWith('(free)')) {
      baseModelName = baseModelName.replace('(free)', '')
    }
    if (baseModelName.endsWith(':cloud')) {
      baseModelName = baseModelName.replace(':cloud', '')
    }
    return baseModelName
  }
}))

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'openai::gpt-4o',
  providerId: 'openai',
  apiModelId: 'gpt-4o',
  name: 'gpt-4o',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  ...overrides
})

describe('ProviderSettings model capability helpers', () => {
  it.each([
    ['openai::gpt-oss', 'gpt-oss'],
    ['kimi::kimi-k2.5', 'kimi-k2.5'],
    ['minimax::mimo-v2.5', 'mimo-v2.5'],
    ['minimax::mimo-v2.5-pro', 'mimo-v2.5-pro']
  ] as const)('detects function calling support for %s', (id, name) => {
    expect(isFunctionCallingModel(createModel({ id, name }))).toBe(true)
  })

  it.each([
    ['google::gemini-3-flash-image', 'gemini-3-flash-image'],
    ['google::gemini-3.0-pro-image-preview', 'gemini-3.0-pro-image-preview']
  ] as const)('detects modern Gemini image generation support for %s', (id, name) => {
    const model = createModel({
      id,
      name,
      providerId: 'google',
      endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
    })

    expect(isGenerateImageModel(model)).toBe(true)
    expect(isVisionModel(model)).toBe(true)
    expect(isFunctionCallingModel(model)).toBe(false)
  })

  it.each([
    ['moonshot::kimi-k2.5', 'kimi-k2.5'],
    ['google::gemini-3-flash-preview', 'gemini-3-flash-preview'],
    ['minimax::mimo-v2-omni', 'mimo-v2-omni']
  ] as const)('detects reasoning support for %s', (id, name) => {
    expect(isReasoningModel(createModel({ id, name }))).toBe(true)
  })

  it('detects web search support from provider and endpoint semantics', () => {
    expect(
      isWebSearchModel(
        createModel({
          id: 'openai::gpt-5',
          name: 'gpt-5',
          endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
        })
      )
    ).toBe(true)

    expect(
      isWebSearchModel(
        createModel({
          id: 'google::gemini-3-flash-preview',
          providerId: 'google',
          name: 'gemini-3-flash-preview',
          endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
        })
      )
    ).toBe(true)
  })

  it('honors explicit capability flags before regex inference', () => {
    expect(
      isFunctionCallingModel(
        createModel({
          id: 'openai::gpt-oss',
          capabilities: [MODEL_CAPABILITY.EMBEDDING]
        })
      )
    ).toBe(false)

    expect(
      isVisionModel(
        createModel({
          id: 'custom::plain-text-model',
          capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION]
        })
      )
    ).toBe(true)
  })

  it('keeps embedding and rerank classifications mutually exclusive with chat capabilities', () => {
    const embedding = createModel({ id: 'openai::text-embedding-3-large', name: 'text-embedding-3-large' })
    expect(isEmbeddingModel(embedding)).toBe(true)
    expect(isFunctionCallingModel(embedding)).toBe(false)
    expect(isVisionModel(embedding)).toBe(false)

    const rerank = createModel({ id: 'cohere::rerank-v3.5', name: 'rerank-v3.5' })
    expect(isRerankModel(rerank)).toBe(true)
    expect(isEmbeddingModel(rerank)).toBe(false)
    expect(isFunctionCallingModel(rerank)).toBe(false)
  })
})
