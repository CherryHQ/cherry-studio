import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  type KnowledgeBase,
  type KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

const { getRerankAdapter } = await import('../adapters')
const { executeRerankRequest, rerankKnowledgeSearchResults, resolveRerankRuntime } = await import('../rerank')

function createKnowledgeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  const now = new Date().toISOString()

  return {
    ...overrides,
    id: overrides.id ?? 'kb-1',
    name: overrides.name ?? 'Knowledge Base',
    emoji: overrides.emoji ?? '📁',
    dimensions: overrides.dimensions ?? 1024,
    embeddingModelId: overrides.embeddingModelId ?? 'ollama::nomic-embed-text',
    chunkSize: overrides.chunkSize ?? DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: overrides.chunkOverlap ?? DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now
  }
}

function createSearchResults(): KnowledgeSearchResult[] {
  return [
    {
      pageContent: 'alpha',
      score: 0.1,
      metadata: {
        itemId: 'item-1',
        itemType: 'note',
        source: 'note-1',
        chunkIndex: 0,
        tokenCount: 1
      },
      chunkId: 'chunk-1'
    },
    {
      pageContent: 'beta',
      score: 0.2,
      metadata: {
        itemId: 'item-2',
        itemType: 'note',
        source: 'note-2',
        chunkIndex: 1,
        tokenCount: 1
      },
      chunkId: 'chunk-2'
    }
  ]
}

describe('knowledge rerank adapters', () => {
  it('passes text documents to jina rerank requests', () => {
    const adapter = getRerankAdapter('jina')

    expect(
      adapter.buildBody({
        modelId: 'jina-reranker-m0',
        query: 'hello',
        documents: ['alpha', 'beta'],
        topN: 3
      })
    ).toEqual({
      model: 'jina-reranker-m0',
      query: 'hello',
      documents: ['alpha', 'beta'],
      top_n: 3
    })
  })

  it('maps tei-style providers to the tei request shape', () => {
    const adapter = getRerankAdapter('tei-local')

    expect(
      adapter.buildBody({
        modelId: 'ignored',
        query: 'hello',
        documents: ['alpha', 'beta'],
        topN: 3
      })
    ).toEqual({
      query: 'hello',
      texts: ['alpha', 'beta'],
      return_text: true
    })
  })

  it('uses the bailian fixed rerank endpoint', () => {
    const adapter = getRerankAdapter('bailian')

    expect(adapter.buildUrl('https://example.com/ignored')).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank'
    )
  })

  it('throws when object-based rerank payloads do not contain an array of results', () => {
    const adapter = getRerankAdapter('jina')

    expect(() => adapter.parseResponse({ results: 'bad-payload' })).toThrow()
  })

  it('throws when array-based rerank payloads are malformed', () => {
    const adapter = getRerankAdapter('tei-local')

    expect(() => adapter.parseResponse({ results: [] })).toThrow()
  })
})

describe('knowledge rerank runtime', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('returns null runtime config until provider runtime integration lands', async () => {
    await expect(
      resolveRerankRuntime(createKnowledgeBase({ rerankModelId: 'jina::jina-reranker-v2-base-multilingual' }))
    ).resolves.toBeNull()
  })

  it('skips rerank when the base has no rerank model id', async () => {
    const searchResults = createSearchResults()

    await expect(rerankKnowledgeSearchResults(createKnowledgeBase(), 'hello', searchResults)).resolves.toBe(
      searchResults
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('executes rerank requests and sorts by rerank score', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { index: 0, relevance_score: 0.2 },
            { index: 1, relevance_score: 0.9 }
          ]
        }),
        { status: 200 }
      )
    )

    const result = await executeRerankRequest(
      {
        providerId: 'jina',
        modelId: 'jina-reranker-v2-base-multilingual',
        baseUrl: 'https://api.jina.ai',
        apiKey: 'secret'
      },
      'hello',
      createSearchResults(),
      2
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.jina.ai/v1/rerank',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json'
        }
      })
    )
    expect(result.map((item) => ({ chunkId: item.chunkId, score: item.score }))).toEqual([
      { chunkId: 'chunk-2', score: 0.9 },
      { chunkId: 'chunk-1', score: 0.2 }
    ])
  })

  it('throws when rerank upstream responds with a non-ok status', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad request' }), { status: 400, statusText: 'Bad Request' })
    )

    await expect(
      executeRerankRequest(
        {
          providerId: 'jina',
          modelId: 'jina-reranker-v2-base-multilingual',
          baseUrl: 'https://api.jina.ai',
          apiKey: 'secret'
        },
        'hello',
        createSearchResults(),
        2
      )
    ).rejects.toThrow('HTTP 400: Bad Request')
  })
})
