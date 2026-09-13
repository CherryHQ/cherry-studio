import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_DOCUMENT_COUNT } from '@main/utils/knowledge'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  type KnowledgeBase,
  type KnowledgeSearchResult
} from '@shared/data/types/knowledge'

const mocks = vi.hoisted(() => ({
  aiRerankMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn()
}))

function apiCallError(statusCode: number, message: string, responseBody?: string): APICallError {
  return new APICallError({
    message,
    url: 'https://api.example/rerank',
    requestBodyValues: {},
    statusCode,
    responseBody
  })
}

const zhipuInputError = () => apiCallError(400, 'Bad Request', JSON.stringify({ error: { code: '1214' } }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiService: {
      rerank: mocks.aiRerankMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: mocks.warnMock,
      error: mocks.errorMock
    })
  }
}))

const { rerankKnowledgeSearchResults } = await import('../rerank')

function createKnowledgeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  const now = new Date().toISOString()

  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Knowledge Base',
    groupId: null,
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    rerankModelId: 'jina::jina-reranker-v2-base-multilingual',
    fileProcessorId: null,
    status: 'completed',
    error: null,
    chunkSize: DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    chunkStrategy: 'structured',
    chunkSeparator: '\\n\\n',
    documentCount: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function createSearchResults(contents: string[] = ['alpha', 'beta']): KnowledgeSearchResult[] {
  return contents.map((pageContent, index) => ({
    pageContent,
    score: (index + 1) / 10,
    scoreKind: 'ranking',
    rank: index + 1,
    metadata: {
      itemId: '0198f3f2-7d1a-7abc-8def-123456789abc',
      itemType: 'note',
      source: `note-${index + 1}`,
      chunkIndex: index,
      tokenCount: 1
    },
    itemId: '0198f3f2-7d1a-7abc-8def-123456789abc',
    chunkId: `chunk-${index + 1}`
  }))
}

describe('knowledge rerank runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips rerank when the base has no rerank model id', async () => {
    const searchResults = createSearchResults()

    await expect(
      rerankKnowledgeSearchResults(createKnowledgeBase({ rerankModelId: null }), 'hello', searchResults)
    ).resolves.toBe(searchResults)
    expect(mocks.aiRerankMock).not.toHaveBeenCalled()
  })

  it('calls AiService.rerank and sorts by rerank score', async () => {
    mocks.aiRerankMock.mockResolvedValueOnce({
      ranking: [
        { originalIndex: 0, score: 0.2, document: 'alpha' },
        { originalIndex: 1, score: 0.9, document: 'beta' }
      ]
    })

    const result = await rerankKnowledgeSearchResults(createKnowledgeBase(), 'hello', createSearchResults())

    expect(mocks.aiRerankMock).toHaveBeenCalledWith({
      uniqueModelId: 'jina::jina-reranker-v2-base-multilingual',
      query: 'hello',
      documents: ['alpha', 'beta'],
      topN: 2
    })
    expect(
      result.map((item) => ({
        chunkId: item.chunkId,
        score: item.score,
        scoreKind: item.scoreKind,
        rank: item.rank
      }))
    ).toEqual([
      { chunkId: 'chunk-2', score: 0.9, scoreKind: 'relevance', rank: 1 },
      { chunkId: 'chunk-1', score: 0.2, scoreKind: 'relevance', rank: 2 }
    ])
  })

  it('preserves an explicit rerank relevance score of zero', async () => {
    mocks.aiRerankMock.mockResolvedValueOnce({
      ranking: [
        { originalIndex: 0, score: 0, document: 'alpha' },
        { originalIndex: 1, score: 0.9, document: 'beta' }
      ]
    })

    const result = await rerankKnowledgeSearchResults(createKnowledgeBase(), 'hello', createSearchResults())

    expect(
      result.map((item) => ({
        chunkId: item.chunkId,
        score: item.score,
        scoreKind: item.scoreKind,
        rank: item.rank
      }))
    ).toEqual([
      { chunkId: 'chunk-2', score: 0.9, scoreKind: 'relevance', rank: 1 },
      { chunkId: 'chunk-1', score: 0, scoreKind: 'relevance', rank: 2 }
    ])
  })

  it('keeps only candidates returned by rerank', async () => {
    mocks.aiRerankMock.mockResolvedValueOnce({
      ranking: [{ originalIndex: 1, score: 0.9, document: 'beta' }]
    })

    const result = await rerankKnowledgeSearchResults(createKnowledgeBase(), 'hello', createSearchResults())

    expect(result.map((item) => item.chunkId)).toEqual(['chunk-2'])
  })

  it('uses the default document count as rerank topN when the base has no document count', async () => {
    mocks.aiRerankMock.mockResolvedValueOnce({ ranking: [] })

    await rerankKnowledgeSearchResults(
      createKnowledgeBase({ documentCount: undefined }),
      'hello',
      createSearchResults()
    )

    expect(mocks.aiRerankMock).toHaveBeenCalledWith(expect.objectContaining({ topN: DEFAULT_DOCUMENT_COUNT }))
  })

  it('skips rerank when the rerank model id is invalid', async () => {
    const searchResults = createSearchResults()

    const result = await rerankKnowledgeSearchResults(
      createKnowledgeBase({ rerankModelId: 'invalid-model' }),
      'hello',
      searchResults
    )
    expect(result).toEqual(
      searchResults.map((item) => ({ ...item, warning: { kind: 'rerank_failed', reason: 'provider_error' } }))
    )
    expect(mocks.aiRerankMock).not.toHaveBeenCalled()
    expect(mocks.errorMock).toHaveBeenCalledWith('Skipping knowledge rerank because rerank model id is invalid', {
      baseId: '11111111-1111-4111-8111-111111111111',
      rerankModelId: 'invalid-model'
    })
  })

  it('keeps a transient rerank failure at warn level and returns vector search results', async () => {
    const searchResults = createSearchResults()
    mocks.aiRerankMock.mockRejectedValueOnce(new Error('upstream unavailable'))

    await expect(rerankKnowledgeSearchResults(createKnowledgeBase(), 'hello', searchResults)).resolves.toEqual(
      searchResults.map((item) => ({ ...item, warning: { kind: 'rerank_failed', reason: 'provider_error' } }))
    )
    // The Error instance itself is logged (stack/cause preserved), with the
    // structured context alongside.
    expect(mocks.warnMock).toHaveBeenCalledWith(
      'Knowledge rerank failed, returning vector search results',
      expect.objectContaining({ message: 'upstream unavailable' }),
      {
        baseId: '11111111-1111-4111-8111-111111111111',
        rerankModelId: 'jina::jina-reranker-v2-base-multilingual',
        topN: 2
      }
    )
    expect(mocks.warnMock.mock.calls[0][1]).toBeInstanceOf(Error)
    expect(mocks.errorMock).not.toHaveBeenCalled()
  })

  it('keeps a transient 5xx rerank failure at warn level', async () => {
    const searchResults = createSearchResults()
    mocks.aiRerankMock.mockRejectedValueOnce(apiCallError(503, 'Service Unavailable'))

    await expect(rerankKnowledgeSearchResults(createKnowledgeBase(), 'hello', searchResults)).resolves.toEqual(
      searchResults.map((item) => ({ ...item, warning: { kind: 'rerank_failed', reason: 'provider_error' } }))
    )
    expect(mocks.warnMock).toHaveBeenCalledTimes(1)
    expect(mocks.errorMock).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
    [404, 'Model not found']
  ])('escalates a persistent %i rerank misconfiguration to error', async (statusCode, message) => {
    const searchResults = createSearchResults()
    mocks.aiRerankMock.mockRejectedValueOnce(apiCallError(statusCode, message))

    await expect(rerankKnowledgeSearchResults(createKnowledgeBase(), 'hello', searchResults)).resolves.toEqual(
      searchResults.map((item) => ({ ...item, warning: { kind: 'rerank_failed', reason: 'provider_error' } }))
    )
    expect(mocks.errorMock).toHaveBeenCalledWith(
      'Knowledge rerank failed, returning vector search results',
      expect.objectContaining({ message }),
      {
        baseId: '11111111-1111-4111-8111-111111111111',
        rerankModelId: 'jina::jina-reranker-v2-base-multilingual',
        topN: 2
      }
    )
    expect(mocks.errorMock.mock.calls[0][1]).toBeInstanceOf(Error)
    expect(mocks.warnMock).not.toHaveBeenCalled()
  })

  it('keeps a successful 90-document Zhipu payload in one request', async () => {
    const searchResults = createSearchResults(
      Array.from({ length: 90 }, (_, index) => `${index}:`.padEnd(index === 89 ? 1386 : 1354, 'x'))
    )
    expect(searchResults.reduce((sum, result) => sum + result.pageContent.length, 0)).toBe(121_892)
    mocks.aiRerankMock.mockResolvedValueOnce({ ranking: [{ originalIndex: 0, score: 0.9 }] })

    await rerankKnowledgeSearchResults(createKnowledgeBase({ rerankModelId: 'zhipu::rerank' }), 'query', searchResults)

    expect(mocks.aiRerankMock).toHaveBeenCalledTimes(1)
    expect(mocks.aiRerankMock.mock.calls[0][0].documents).toHaveLength(90)
  })

  it('splits a rejected 100-document Zhipu payload and merges global indexes before topN', async () => {
    const searchResults = createSearchResults(
      Array.from({ length: 100 }, (_, index) => `${index}:`.padEnd(index === 99 ? 1339 : 1364, 'x'))
    )
    expect(searchResults.reduce((sum, result) => sum + result.pageContent.length, 0)).toBe(136_375)
    mocks.aiRerankMock
      .mockRejectedValueOnce(zhipuInputError())
      .mockResolvedValueOnce({ ranking: [{ originalIndex: 0, score: 0.9 }] })
      .mockResolvedValueOnce({ ranking: [{ originalIndex: 49, score: 1 }] })

    const result = await rerankKnowledgeSearchResults(
      createKnowledgeBase({ rerankModelId: 'zhipu::rerank', documentCount: 2 }),
      'query',
      searchResults
    )

    expect(mocks.aiRerankMock).toHaveBeenCalledTimes(3)
    expect(mocks.aiRerankMock.mock.calls.map(([request]) => request.documents.length)).toEqual([100, 50, 50])
    expect(result.map((item) => [item.chunkId, item.score, item.rank])).toEqual([
      ['chunk-100', 1, 1],
      ['chunk-1', 0.9, 2]
    ])
  })

  it('pre-splits 129 Zhipu documents before calling the provider', async () => {
    const searchResults = createSearchResults(Array.from({ length: 129 }, (_, index) => `document-${index}`))
    mocks.aiRerankMock.mockResolvedValue({ ranking: [] })

    await rerankKnowledgeSearchResults(createKnowledgeBase({ rerankModelId: 'zhipu::rerank' }), 'query', searchResults)

    const batchSizes = mocks.aiRerankMock.mock.calls.map(([request]) => request.documents.length)
    expect(batchSizes).toHaveLength(2)
    expect(batchSizes.every((size) => size <= 128)).toBe(true)
    expect(batchSizes.reduce((sum, size) => sum + size, 0)).toBe(129)
  })

  it('splits a rejected Zhipu payload near half of its cumulative characters', async () => {
    const searchResults = createSearchResults(['a'.repeat(3000), 'b'.repeat(1000), 'c'.repeat(1000)])
    mocks.aiRerankMock
      .mockRejectedValueOnce(zhipuInputError())
      .mockResolvedValueOnce({ ranking: [] })
      .mockResolvedValueOnce({ ranking: [] })

    await rerankKnowledgeSearchResults(createKnowledgeBase({ rerankModelId: 'zhipu::rerank' }), 'query', searchResults)

    expect(
      mocks.aiRerankMock.mock.calls.map(([request]) => request.documents.map((document: string) => document[0]))
    ).toEqual([['a', 'b', 'c'], ['a'], ['b', 'c']])
  })

  it.each([
    ['query', 'q'.repeat(4097), ['document']],
    ['document', 'query', ['d'.repeat(4097)]]
  ])('preflights an oversized Zhipu %s without sending a request', async (_kind, query, documents) => {
    const searchResults = createSearchResults(documents)

    const result = await rerankKnowledgeSearchResults(
      createKnowledgeBase({ rerankModelId: 'zhipu::rerank' }),
      query,
      searchResults
    )

    expect(mocks.aiRerankMock).not.toHaveBeenCalled()
    expect(result[0].warning).toEqual({ kind: 'rerank_failed', reason: 'input_too_large' })
  })

  it('does not recursively split one Zhipu document rejected with 400/1214', async () => {
    const searchResults = createSearchResults(['document'])
    mocks.aiRerankMock.mockRejectedValueOnce(zhipuInputError())

    const result = await rerankKnowledgeSearchResults(
      createKnowledgeBase({ rerankModelId: 'zhipu::rerank' }),
      'query',
      searchResults
    )

    expect(mocks.aiRerankMock).toHaveBeenCalledTimes(1)
    expect(result[0].warning).toEqual({ kind: 'rerank_failed', reason: 'input_too_large' })
  })

  it.each([400, 401, 429])('does not recursively split an ordinary Zhipu HTTP %i error', async (statusCode) => {
    const searchResults = createSearchResults(['alpha', 'beta'])
    mocks.aiRerankMock.mockRejectedValueOnce(apiCallError(statusCode, 'Provider error'))

    const result = await rerankKnowledgeSearchResults(
      createKnowledgeBase({ rerankModelId: 'zhipu::rerank' }),
      'query',
      searchResults
    )

    expect(mocks.aiRerankMock).toHaveBeenCalledTimes(1)
    expect(result.every((item) => item.warning?.reason === 'provider_error')).toBe(true)
  })

  it('discards every rerank score when a later split batch fails', async () => {
    const searchResults = createSearchResults(['a'.repeat(2000), 'b'.repeat(2000), 'c'.repeat(2000)])
    mocks.aiRerankMock
      .mockRejectedValueOnce(zhipuInputError())
      .mockResolvedValueOnce({ ranking: [{ originalIndex: 0, score: 1 }] })
      .mockRejectedValueOnce(new Error('second batch failed'))

    const result = await rerankKnowledgeSearchResults(
      createKnowledgeBase({ rerankModelId: 'zhipu::rerank' }),
      'query',
      searchResults
    )

    expect(result.map((item) => [item.score, item.scoreKind, item.rank])).toEqual(
      searchResults.map((item) => [item.score, item.scoreKind, item.rank])
    )
    expect(result.every((item) => item.warning?.reason === 'provider_error')).toBe(true)
  })

  it('uses original order as the stable tie-breaker across split batches', async () => {
    const searchResults = createSearchResults(['a'.repeat(2000), 'b'.repeat(2000), 'c'.repeat(2000)])
    mocks.aiRerankMock
      .mockRejectedValueOnce(zhipuInputError())
      .mockResolvedValueOnce({ ranking: [{ originalIndex: 0, score: 0.5 }] })
      .mockResolvedValueOnce({ ranking: [{ originalIndex: 0, score: 0.5 }] })

    const result = await rerankKnowledgeSearchResults(
      createKnowledgeBase({ rerankModelId: 'zhipu::rerank' }),
      'query',
      searchResults
    )

    expect(result.map((item) => item.chunkId)).toEqual(['chunk-1', 'chunk-2'])
  })
})
