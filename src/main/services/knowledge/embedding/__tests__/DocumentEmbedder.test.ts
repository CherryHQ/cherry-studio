import type { EmbeddingModelV3 } from '@ai-sdk/provider'
import { Document } from '@vectorstores/core'
import { describe, expect, it, vi } from 'vitest'

import { DocumentEmbedder } from '../DocumentEmbedder'
import { EmbeddingModelFactory } from '../EmbeddingModelFactory'

function createEmbeddingModel(): EmbeddingModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'ollama',
    modelId: 'nomic-embed-text',
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: true,
    doEmbed: vi.fn(async ({ values }) => ({
      embeddings: values.map((_, index) => [index + 0.1, index + 0.2]),
      usage: {
        tokens: 10
      },
      warnings: [],
      rawResponse: { headers: {} }
    }))
  } as EmbeddingModelV3
}

describe('DocumentEmbedder', () => {
  it('embeds documents into TextNode instances', async () => {
    const embeddingModel = createEmbeddingModel()
    const provider = {
      textEmbeddingModel: vi.fn(() => embeddingModel)
    }

    const factory = EmbeddingModelFactory.fromProvider('ollama', provider)
    const embedder = new DocumentEmbedder(factory)
    const documents = [
      new Document({
        text: 'first chunk',
        metadata: { itemId: 'item-1', chunkIndex: 0 }
      }),
      new Document({
        text: 'second chunk',
        metadata: { itemId: 'item-1', chunkIndex: 1 }
      })
    ]

    const nodes = await embedder.embed(
      {
        embeddingModelId: 'ollama::nomic-embed-text'
      },
      documents
    )

    expect(provider.textEmbeddingModel).toHaveBeenCalledWith('nomic-embed-text')
    expect(nodes).toHaveLength(2)
    expect(nodes[0].getText()).toBe('first chunk')
    expect(nodes[0].metadata).toMatchObject({ itemId: 'item-1', chunkIndex: 0 })
    expect(nodes[0].getEmbedding()).toEqual([0.1, 0.2])
    expect(nodes[1].getEmbedding()).toEqual([1.1, 1.2])
  })

  it('returns an empty array for empty document input', async () => {
    const embeddingModel = createEmbeddingModel()
    const provider = {
      textEmbeddingModel: vi.fn(() => embeddingModel)
    }

    const factory = EmbeddingModelFactory.fromProvider('ollama', provider)
    const embedder = new DocumentEmbedder(factory)

    const nodes = await embedder.embed(
      {
        embeddingModelId: 'ollama::nomic-embed-text'
      },
      []
    )

    expect(nodes).toEqual([])
    expect(provider.textEmbeddingModel).not.toHaveBeenCalled()
  })
})
