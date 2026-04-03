import type { EmbeddingModelV3 } from '@ai-sdk/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const textEmbeddingModelMock = vi.hoisted(() => vi.fn())
const createOllamaMock = vi.hoisted(() => vi.fn(() => ({ textEmbeddingModel: textEmbeddingModelMock })))

vi.mock('ollama-ai-provider-v2', () => ({
  createOllama: createOllamaMock
}))

import { EmbeddingModelFactory } from '../EmbeddingModelFactory'

function createEmbeddingModel(modelId: string): EmbeddingModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'ollama',
    modelId,
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: true,
    doEmbed: vi.fn()
  } as EmbeddingModelV3
}

describe('EmbeddingModelFactory (ollama only)', () => {
  beforeEach(() => {
    createOllamaMock.mockClear()
    textEmbeddingModelMock.mockReset()
  })

  it('builds an ollama embedding model from providerId and modelId', () => {
    const model = createEmbeddingModel('nomic-embed-text')
    textEmbeddingModelMock.mockReturnValue(model)

    const result = EmbeddingModelFactory.create({
      providerId: 'ollama',
      modelId: 'nomic-embed-text'
    })

    expect(createOllamaMock).toHaveBeenCalled()
    expect(textEmbeddingModelMock).toHaveBeenCalledWith('nomic-embed-text')
    expect(result).toBe(model)
  })

  it('parses ollama::modelId and builds the embedding model', () => {
    const model = createEmbeddingModel('nomic-embed-text')
    textEmbeddingModelMock.mockReturnValue(model)

    const result = EmbeddingModelFactory.createFromCompositeModelId('ollama::nomic-embed-text')

    expect(textEmbeddingModelMock).toHaveBeenCalledWith('nomic-embed-text')
    expect(result).toBe(model)
  })

  it('throws for non-ollama providers', () => {
    expect(() =>
      EmbeddingModelFactory.create({
        providerId: 'openai',
        modelId: 'text-embedding-3-small'
      })
    ).toThrow('Unsupported embedding provider: openai')
  })
})
