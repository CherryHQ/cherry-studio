import type { EmbeddingModelV3 } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { EmbeddingModelFactory } from '../EmbeddingModelFactory'

function createEmbeddingModel(modelId: string): EmbeddingModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'test-provider',
    modelId,
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: true,
    doEmbed: vi.fn()
  } as EmbeddingModelV3
}

describe('EmbeddingModelFactory', () => {
  it('builds an embedding model from providerId and modelId', () => {
    const embeddingModel = createEmbeddingModel('nomic-embed-text')
    const provider = {
      textEmbeddingModel: vi.fn(() => embeddingModel)
    }

    const factory = EmbeddingModelFactory.fromProvider('ollama', provider)
    const result = factory.create({
      providerId: 'ollama',
      modelId: 'nomic-embed-text'
    })

    expect(provider.textEmbeddingModel).toHaveBeenCalledWith('nomic-embed-text')
    expect(result).toBe(embeddingModel)
  })

  it('parses providerId::modelId before resolving the registry model', () => {
    const embeddingModel = createEmbeddingModel('nomic-embed-text')
    const provider = {
      textEmbeddingModel: vi.fn(() => embeddingModel)
    }

    const factory = EmbeddingModelFactory.fromProvider('ollama', provider)
    const result = factory.createFromCompositeModelId('ollama::nomic-embed-text')

    expect(provider.textEmbeddingModel).toHaveBeenCalledWith('nomic-embed-text')
    expect(result).toBe(embeddingModel)
  })
})
