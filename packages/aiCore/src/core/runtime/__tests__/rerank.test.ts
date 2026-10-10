import type { RerankingModelV3 } from '@ai-sdk/provider'
import { createMockProviderV3, createMockRerankingModel } from '@test-utils'
import { rerank as aiRerank } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RuntimeExecutor } from '../executor'
import { createExecutor } from '../index'

vi.mock('ai', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    rerank: vi.fn()
  }
})

describe('RuntimeExecutor.rerank', () => {
  let mockRerankingModel: RerankingModelV3
  let mockProvider: ReturnType<typeof createMockProviderV3>
  let executor: RuntimeExecutor

  beforeEach(() => {
    vi.clearAllMocks()

    mockRerankingModel = createMockRerankingModel({
      provider: 'openai-compatible.rerank',
      modelId: 'jina-reranker-v2-base-multilingual'
    })
    mockProvider = createMockProviderV3({
      provider: 'openai-compatible',
      rerankingModel: vi.fn(() => mockRerankingModel)
    })
    executor = RuntimeExecutor.create('openai-compatible', mockProvider, {
      apiKey: 'test-key',
      baseURL: 'https://api.example.com/v1',
      name: 'test'
    })

    vi.mocked(aiRerank).mockResolvedValue({
      originalDocuments: ['alpha', 'beta'],
      rerankedDocuments: ['beta', 'alpha'],
      ranking: [
        { originalIndex: 1, score: 0.9, document: 'beta' },
        { originalIndex: 0, score: 0.2, document: 'alpha' }
      ],
      response: {
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        modelId: 'jina-reranker-v2-base-multilingual'
      }
    })
  })

  it('resolves a string model id through provider.rerankingModel', async () => {
    const abortController = new AbortController()
    const result = await executor.rerank({
      model: 'jina-reranker-v2-base-multilingual',
      query: 'hello',
      documents: ['alpha', 'beta'],
      topN: 2,
      headers: { 'x-test': 'yes' },
      maxRetries: 0,
      providerOptions: { jina: { returnDocuments: false } },
      abortSignal: abortController.signal
    })

    expect(mockProvider.rerankingModel).toHaveBeenCalledWith('jina-reranker-v2-base-multilingual')
    expect(aiRerank).toHaveBeenCalledWith({
      model: mockRerankingModel,
      query: 'hello',
      documents: ['alpha', 'beta'],
      topN: 2,
      headers: { 'x-test': 'yes' },
      maxRetries: 0,
      providerOptions: { jina: { returnDocuments: false } },
      abortSignal: abortController.signal
    })
    expect(result.ranking).toEqual([
      { originalIndex: 1, score: 0.9, document: 'beta' },
      { originalIndex: 0, score: 0.2, document: 'alpha' }
    ])
  })

  it('accepts a pre-created reranking model', async () => {
    await executor.rerank({
      model: mockRerankingModel,
      query: 'hello',
      documents: ['alpha']
    })

    expect(mockProvider.rerankingModel).not.toHaveBeenCalled()
    expect(aiRerank).toHaveBeenCalledWith({
      model: mockRerankingModel,
      query: 'hello',
      documents: ['alpha']
    })
  })

  it('resolves CherryIN rerank models through the provider registry', async () => {
    const cherryInExecutor = await createExecutor('cherryin', {
      apiKey: 'test-key',
      baseURL: 'https://open.cherryin.net/v1',
      endpointType: 'jina-rerank'
    })

    await cherryInExecutor.rerank({
      model: 'BAAI/bge-reranker-v2-m3(free)',
      query: 'test',
      documents: ['test'],
      topN: 1
    })

    expect(aiRerank).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: 'cherryin.rerank',
          modelId: 'BAAI/bge-reranker-v2-m3(free)'
        }),
        query: 'test',
        documents: ['test'],
        topN: 1
      })
    )
  })
})
