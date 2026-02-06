import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}

const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockRmSync = vi.fn()

const mockBuildBaseParams = vi.fn()
const mockEmbedQuery = vi.fn()
const mockRerank = vi.fn()

type MockStore = {
  clearCollection: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  deleteByExternalId: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
  config: Record<string, unknown>
}

const storeInstances: MockStore[] = []
const mockLibSQLVectorStore = vi.fn().mockImplementation((config: Record<string, unknown>) => {
  const store: MockStore = {
    clearCollection: vi.fn(),
    add: vi.fn(),
    deleteByExternalId: vi.fn(),
    query: vi.fn(),
    config
  }
  storeInstances.push(store)
  return store
})

const mockEmbeddingsClass = vi.fn().mockImplementation(() => ({
  embedQuery: mockEmbedQuery
}))

const mockRerankerClass = vi.fn().mockImplementation(() => ({
  rerank: mockRerank
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mockLogger
  }
}))

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  rmSync: mockRmSync
}))

vi.mock('@main/utils', () => ({
  getDataPath: () => '/mock-data'
}))

vi.mock('@main/utils/file', () => ({
  sanitizeFilename: (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_')
}))

vi.mock('@vectorstores/libsql', () => ({
  LibSQLVectorStore: mockLibSQLVectorStore
}))

vi.mock('../embeddings', () => ({
  default: mockEmbeddingsClass
}))

vi.mock('../KnowledgeProviderAdapter', () => ({
  knowledgeProviderAdapter: {
    buildBaseParams: mockBuildBaseParams
  }
}))

vi.mock('../reranker/Reranker', () => ({
  default: mockRerankerClass
}))

function createBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'base-1',
    name: 'Base',
    embeddingModelId: 'openai:text-embedding-3-small',
    embeddingModelMeta: {
      id: 'text-embedding-3-small',
      name: 'text-embedding-3-small',
      provider: 'openai',
      dimensions: 1536
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

function pathExists(path: string): boolean {
  if (path === '/mock-data/KnowledgeBase') return true
  if (path === '/mock-data/KnowledgeBase/base-1') return true
  return false
}

async function loadService() {
  const module = await import('../KnowledgeServiceV2')
  return module.knowledgeServiceV2
}

describe('KnowledgeServiceV2', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    storeInstances.length = 0

    mockExistsSync.mockImplementation(pathExists)
    mockBuildBaseParams.mockResolvedValue({
      embedApiClient: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'secret',
        baseURL: 'https://api.openai.com/v1'
      },
      dimensions: 1536
    })
    mockEmbedQuery.mockResolvedValue([0.1, 0.2, 0.3])
    mockRerank.mockImplementation(async (_query: string, results: unknown[]) => results)
  })

  it('creates and caches store instances by base id', async () => {
    const service = await loadService()
    const base = createBase()

    await service.create(base)
    await service.create(base)

    expect(mockLibSQLVectorStore).toHaveBeenCalledTimes(1)
    expect(storeInstances[0].config).toMatchObject({
      clientConfig: { url: 'file:/mock-data/KnowledgeBase/base-1' },
      dimensions: 1536,
      collection: ''
    })
  })

  it('returns early when addNodes input is empty', async () => {
    const service = await loadService()

    await service.addNodes({ base: createBase(), nodes: [] })

    expect(mockLibSQLVectorStore).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('empty nodes array'))
  })

  it('adds nodes to vector store', async () => {
    const service = await loadService()
    const nodes = [{ id_: 'n1' }] as any[]

    await service.addNodes({ base: createBase(), nodes: nodes as any })

    expect(mockLibSQLVectorStore).toHaveBeenCalledTimes(1)
    expect(storeInstances[0].add).toHaveBeenCalledWith(nodes)
  })

  it('throws when remove is called for missing database', async () => {
    const service = await loadService()
    mockExistsSync.mockImplementation((path: string) => path === '/mock-data/KnowledgeBase')

    await expect(
      service.remove({
        base: createBase(),
        item: { id: 'item-1' } as any
      })
    ).rejects.toThrow('Knowledge base database not found for id: base-1')
  })

  it('deletes vectors by external id when remove succeeds', async () => {
    const service = await loadService()

    await service.remove({
      base: createBase(),
      item: { id: 'item-1' } as any
    })

    expect(storeInstances[0].deleteByExternalId).toHaveBeenCalledWith('item-1')
  })

  it('returns empty array when search database is missing', async () => {
    const service = await loadService()
    mockExistsSync.mockImplementation((path: string) => path === '/mock-data/KnowledgeBase')

    await expect(service.search({ base: createBase(), search: 'hello' })).resolves.toEqual([])
  })

  it('maps vector query results to knowledge search results', async () => {
    const service = await loadService()

    const node1 = {
      metadata: { source: 'a.txt' },
      getContent: vi.fn().mockReturnValue('chunk-1')
    }
    const node2 = {
      metadata: undefined,
      getContent: vi.fn().mockReturnValue('chunk-2')
    }

    await service.create(createBase())
    storeInstances[0].query.mockResolvedValue({
      nodes: [node1, node2],
      similarities: [0.91]
    })

    const results = await service.search({ base: createBase(), search: 'test query' })

    expect(mockEmbedQuery).toHaveBeenCalledWith('test query')
    expect(storeInstances[0].query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryStr: 'test query',
        similarityTopK: 6,
        mode: 'default'
      })
    )
    expect(results).toEqual([
      { pageContent: 'chunk-1', score: 0.91, metadata: { source: 'a.txt' } },
      { pageContent: 'chunk-2', score: 0, metadata: {} }
    ])
  })

  it('invokes rerank flow when rerank model is configured', async () => {
    const service = await loadService()

    const base = createBase({
      rerankModelId: 'openai:rerank-model',
      rerankModelMeta: { id: 'rerank-model', name: 'rerank-model', provider: 'openai' }
    })

    mockBuildBaseParams.mockImplementation(async (_base: KnowledgeBase, field: string) => {
      if (field === 'rerankModelId') {
        return {
          embedApiClient: {
            provider: 'openai',
            model: 'text-embedding-3-small',
            apiKey: 'secret',
            baseURL: 'https://api.openai.com/v1'
          },
          rerankApiClient: {
            provider: 'openai',
            model: 'rerank-model',
            apiKey: 'secret',
            baseURL: 'https://api.openai.com/v1'
          },
          dimensions: 1536
        }
      }

      return {
        embedApiClient: {
          provider: 'openai',
          model: 'text-embedding-3-small',
          apiKey: 'secret',
          baseURL: 'https://api.openai.com/v1'
        },
        dimensions: 1536
      }
    })

    await service.create(base)
    storeInstances[0].query.mockResolvedValue({
      nodes: [
        {
          metadata: { source: 'a.txt' },
          getContent: vi.fn().mockReturnValue('chunk-1')
        }
      ],
      similarities: [0.8]
    })

    mockRerank.mockResolvedValue([{ pageContent: 'reranked', score: 0.95, metadata: { source: 'a.txt' } }])

    const results = await service.search({ base, search: 'query' })

    expect(mockRerankerClass).toHaveBeenCalledTimes(1)
    expect(mockRerank).toHaveBeenCalledWith('query', [
      { pageContent: 'chunk-1', score: 0.8, metadata: { source: 'a.txt' } }
    ])
    expect(results).toEqual([{ pageContent: 'reranked', score: 0.95, metadata: { source: 'a.txt' } }])
  })

  it('short-circuits rerank when results are empty', async () => {
    const service = await loadService()

    const results = await service.rerank({
      search: 'query',
      base: createBase(),
      results: []
    })

    expect(results).toEqual([])
    expect(mockBuildBaseParams).not.toHaveBeenCalled()
    expect(mockRerankerClass).not.toHaveBeenCalled()
  })

  it('deletes database file and clears cache', async () => {
    const service = await loadService()
    const base = createBase()

    await service.create(base)
    await service.delete(base.id)
    await service.create(base)

    expect(mockRmSync).toHaveBeenCalledWith('/mock-data/KnowledgeBase/base-1', { recursive: true })
    expect(mockLibSQLVectorStore).toHaveBeenCalledTimes(2)
  })

  it('throws when deleting a missing database', async () => {
    const service = await loadService()
    mockExistsSync.mockImplementation((path: string) => path === '/mock-data/KnowledgeBase')

    await expect(service.delete('base-1')).rejects.toThrow('Knowledge base file not found for id: base-1')
  })
})
