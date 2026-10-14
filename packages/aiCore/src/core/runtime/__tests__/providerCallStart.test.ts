import { APICallError } from '@ai-sdk/provider'
import { MockEmbeddingModelV3, MockImageModelV3, MockProviderV3, MockRerankingModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'

import { RuntimeExecutor } from '../executor'
import type { RuntimeProviderCallEvent } from '../types'

describe('provider invocation start capture', () => {
  it('freezes each embedding batch before the provider can change the next price', async () => {
    let price = 1
    const records: Array<{ price: number; event: RuntimeProviderCallEvent }> = []
    const model = new MockEmbeddingModelV3({
      maxEmbeddingsPerCall: 1,
      supportsParallelCalls: false,
      doEmbed: async () => {
        price += 1
        return { embeddings: [[1]], usage: { tokens: 10 }, warnings: [] }
      }
    })
    const executor = new RuntimeExecutor({
      providerId: 'openai',
      provider: new MockProviderV3({}),
      providerSettings: {}
    })
    const result = await executor.embedMany({
      model,
      values: ['a', 'b'],
      onProviderCallStart: () => {
        const captured = price
        return (event) => records.push({ price: captured, event })
      }
    })
    expect(result.embeddings).toEqual([[1], [1]])
    expect(records.map((record) => record.price)).toEqual([1, 2])
    expect(records.map((record) => record.event.modality)).toEqual(['embedding', 'embedding'])
  })

  it('captures a fresh context after a retry and records only the successful rerank', async () => {
    let price = 1
    const records: number[] = []
    const model = new MockRerankingModelV3({
      doRerank: async () => {
        if (price === 1) {
          price = 2
          throw new APICallError({
            message: 'retry',
            url: 'https://test.invalid',
            requestBodyValues: {},
            statusCode: 429,
            isRetryable: true
          })
        }
        price = 3
        return { ranking: [{ index: 0, relevanceScore: 1 }] }
      }
    })
    const executor = new RuntimeExecutor({
      providerId: 'openai',
      provider: new MockProviderV3({}),
      providerSettings: {}
    })
    const result = await executor.rerank({
      model,
      query: 'a',
      documents: ['a'],
      maxRetries: 1,
      onProviderCallStart: () => {
        const captured = price
        return () => records.push(captured)
      }
    })
    expect(result.ranking[0].originalIndex).toBe(0)
    expect(records).toEqual([2])
  })

  it('captures each image generation and isolates observation failures', async () => {
    let price = 1
    const records: number[] = []
    const model = new MockImageModelV3({
      maxImagesPerCall: 1,
      doGenerate: async () => {
        price++
        return {
          images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8lUAAAAASUVORK5CYII='],
          warnings: [],
          response: { timestamp: new Date(), modelId: 'image', headers: {} }
        }
      }
    })
    const executor = new RuntimeExecutor({
      providerId: 'openai',
      provider: new MockProviderV3({}),
      providerSettings: {}
    })
    const result = await executor.generateImage({
      model,
      prompt: 'a',
      onProviderCallStart: () => {
        const captured = price
        return () => records.push(captured)
      }
    })
    expect(result.images).toHaveLength(1)
    expect(records).toEqual([1])
    expect(
      (
        await executor.generateImage({
          model,
          prompt: 'a',
          onProviderCallStart: () => {
            throw new Error('observation')
          }
        })
      ).images
    ).toHaveLength(1)
  })
})
