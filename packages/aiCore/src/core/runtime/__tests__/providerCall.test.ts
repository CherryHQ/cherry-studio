import type { EmbeddingModelV3CallOptions, ImageModelV3CallOptions } from '@ai-sdk/provider'
import {
  createMockEmbeddingModel,
  createMockImageModel,
  createMockProviderV3,
  createMockRerankingModel
} from '@test-utils'
import { describe, expect, it, vi } from 'vitest'

import { RuntimeExecutor } from '../executor'
import type { RuntimeProviderCallEvent } from '../types'

function createTestExecutor() {
  return RuntimeExecutor.create('openai', createMockProviderV3({ provider: 'openai' }), { apiKey: 'test-key' })
}

describe('RuntimeExecutor provider-call observation', () => {
  it('emits one embedding event for every SDK batch', async () => {
    const doEmbed = vi.fn(async ({ values }: EmbeddingModelV3CallOptions) => ({
      embeddings: values.map(() => [0.1, 0.2]),
      usage: { tokens: values.length },
      warnings: []
    }))
    const model = createMockEmbeddingModel({
      provider: 'openai',
      modelId: 'text-embedding',
      maxEmbeddingsPerCall: 2,
      supportsParallelCalls: false,
      doEmbed
    })
    const events: RuntimeProviderCallEvent[] = []

    const result = await createTestExecutor().embedMany({
      model,
      values: ['a', 'b', 'c', 'd', 'e'],
      onProviderCall: (event) => events.push(event)
    })

    expect(result.embeddings).toHaveLength(5)
    expect(doEmbed).toHaveBeenCalledTimes(3)
    expect(events).toHaveLength(3)
    expect(events.map((event) => (event.modality === 'embedding' ? event.usage?.tokens : undefined))).toEqual([2, 2, 1])
    expect(new Set(events.map((event) => event.requestId)).size).toBe(3)
    expect(events).toEqual([
      expect.objectContaining({
        modality: 'embedding',
        providerId: 'openai',
        modelId: 'text-embedding',
        metrics: { timeCompletionMs: expect.any(Number) }
      }),
      expect.any(Object),
      expect.any(Object)
    ])
  })

  it('emits one image event for every SDK batch', async () => {
    const doGenerate = vi.fn(async ({ n }: ImageModelV3CallOptions) => ({
      images: Array.from({ length: n }, () => 'AAAA'),
      warnings: [],
      response: { timestamp: new Date(), modelId: 'image-model', headers: undefined }
    }))
    const model = createMockImageModel({
      provider: 'openai',
      modelId: 'image-model',
      maxImagesPerCall: 2,
      doGenerate
    })
    const events: RuntimeProviderCallEvent[] = []

    const result = await createTestExecutor().generateImage({
      model,
      prompt: 'a cat',
      n: 5,
      onProviderCall: (event) => events.push(event)
    })

    expect(result.images).toHaveLength(5)
    expect(doGenerate).toHaveBeenCalledTimes(3)
    expect(events).toHaveLength(3)
    expect(events.map((event) => (event.modality === 'image' ? event.imageCount : undefined))).toEqual([2, 2, 1])
    expect(new Set(events.map((event) => event.requestId)).size).toBe(3)
  })

  it('emits rerank only after a successful provider result', async () => {
    const events: RuntimeProviderCallEvent[] = []
    const model = createMockRerankingModel({
      provider: 'openai',
      modelId: 'reranker'
    })

    await createTestExecutor().rerank({
      model,
      query: 'query',
      documents: ['a', 'b'],
      onProviderCall: (event) => events.push(event)
    })

    expect(events).toEqual([
      expect.objectContaining({
        modality: 'rerank',
        providerId: 'openai',
        modelId: 'reranker',
        metrics: { timeCompletionMs: expect.any(Number) }
      })
    ])

    events.length = 0
    const failedModel = createMockRerankingModel({
      provider: 'openai',
      modelId: 'reranker',
      doRerank: vi.fn().mockRejectedValue(new Error('provider failed'))
    })
    await expect(
      createTestExecutor().rerank({
        model: failedModel,
        query: 'query',
        documents: ['a'],
        onProviderCall: (event) => events.push(event)
      })
    ).rejects.toThrow('provider failed')
    expect(events).toEqual([])
  })

  it('does not let an observation handler change a successful result', async () => {
    const model = createMockEmbeddingModel({
      doEmbed: vi.fn().mockResolvedValue({
        embeddings: [[0.1]],
        usage: { tokens: 1 },
        warnings: []
      })
    })

    await expect(
      createTestExecutor().embedMany({
        model,
        values: ['a'],
        onProviderCall: () => {
          throw new Error('analytics unavailable')
        }
      })
    ).resolves.toMatchObject({ embeddings: [[0.1]], usage: { tokens: 1 } })
  })
})
