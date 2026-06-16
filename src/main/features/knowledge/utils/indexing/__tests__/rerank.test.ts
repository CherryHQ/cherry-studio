import { DEFAULT_DOCUMENT_COUNT } from '@main/utils/knowledge'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  type KnowledgeBase,
  type KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  aiRerankMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn()
}))

function apiCallError(statusCode: number, message: string): APICallError {
  return new APICallError({ message, url: 'https://api.example/rerank', requestBodyValues: {}, statusCode })
}

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
    threshold: undefined,
    documentCount: 2,
    searchMode: 'hybrid',
    hybridAlpha: undefined,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function createSearchResults(): KnowledgeSearchResult[] {
  return [
    {
      pageContent: 'alpha',
      score: 0.1,
      scoreKind: 'ranking',
      rank: 1,
      metadata: {
        itemId: '0198f3f2-7d1a-7abc-8def-123456789abc',
        itemType: 'note',
        source: 'note-1',
        chunkIndex: 0,
        tokenCount: 1
      },
      itemId: '0198f3f2-7d1a-7abc-8def-123456789abc',
      chunkId: 'chunk-1'
    },
    {
      pageContent: 'beta',
      score: 0.2,
      scoreKind: 'ranking',
      rank: 2,
      metadata: {
        itemId: '0198f3f2-7d1b-7abc-8def-123456789abc',
        itemType: 'note',
        source: 'note-2',
        chunkIndex: 1,
        tokenCount: 1
      },
      itemId: '0198f3f2-7d1b-7abc-8def-123456789abc',
      chunkId: 'chunk-2'
    }
  ]
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

    await expect(
      rerankKnowledgeSearchResults(createKnowledgeBase({ rerankModelId: 'invalid-model' }), 'hello', searchResults)
    ).resolves.toBe(searchResults)
    expect(mocks.aiRerankMock).not.toHaveBeenCalled()
    expect(mocks.errorMock).toHaveBeenCalledWith('Skipping knowledge rerank because rerank model id is invalid', {
      baseId: '11111111-1111-4111-8111-111111111111',
      rerankModelId: 'invalid-model'
    })
  })

  it('keeps a transient rerank failure at warn level and returns vector search results', async () => {
    const searchResults = createSearchResults()
    mocks.aiRerankMock.mockRejectedValueOnce(new Error('upstream unavailable'))

    await expect(rerankKnowledgeSearchResults(createKnowledgeBase(), 'hello', searchResults)).resolves.toBe(
      searchResults
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

    await expect(rerankKnowledgeSearchResults(createKnowledgeBase(), 'hello', searchResults)).resolves.toBe(
      searchResults
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

    await expect(rerankKnowledgeSearchResults(createKnowledgeBase(), 'hello', searchResults)).resolves.toBe(
      searchResults
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
})
