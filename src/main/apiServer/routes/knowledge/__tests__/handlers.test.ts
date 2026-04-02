import type { Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ValidationRequest } from '../../agents/validators/zodValidator'

const {
  listWithOffsetMock,
  listAllMock,
  getKnowledgeBaseByIdMock,
  createKnowledgeItemsMock,
  updateKnowledgeItemMock,
  reduxSelectMock,
  knowledgeAddMock,
  knowledgeSearchMock
} = vi.hoisted(() => ({
  listWithOffsetMock: vi.fn(),
  listAllMock: vi.fn(),
  getKnowledgeBaseByIdMock: vi.fn(),
  createKnowledgeItemsMock: vi.fn(),
  updateKnowledgeItemMock: vi.fn(),
  reduxSelectMock: vi.fn(),
  knowledgeAddMock: vi.fn(),
  knowledgeSearchMock: vi.fn()
}))

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    listWithOffset: listWithOffsetMock,
    listAll: listAllMock,
    getById: getKnowledgeBaseByIdMock
  }
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    createMany: createKnowledgeItemsMock,
    update: updateKnowledgeItemMock
  }
}))

vi.mock('@main/services/ReduxService', () => ({
  reduxService: {
    select: reduxSelectMock
  }
}))

vi.mock('@main/services/KnowledgeService', () => ({
  knowledgeService: {
    add: knowledgeAddMock,
    search: knowledgeSearchMock
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }))
  }
}))

import { createKnowledgeItems, getKnowledgeBase, listKnowledgeBases, searchKnowledge } from '../handlers'

function createMockKnowledgeBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'kb-1',
    name: 'Test Knowledge Base',
    description: 'Knowledge description',
    dimensions: 1536,
    embeddingModelId: 'openai::text-embedding-3-small',
    rerankModelId: 'jina::jina-reranker-v1',
    fileProcessorId: 'mineru',
    chunkSize: 500,
    chunkOverlap: 50,
    threshold: 0.5,
    documentCount: 10,
    searchMode: 'default',
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T01:00:00.000Z',
    ...overrides
  }
}

function createMockKnowledgeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    baseId: 'kb-1',
    groupId: null,
    type: 'note',
    data: { content: 'hello world' },
    status: 'idle',
    error: null,
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T01:00:00.000Z',
    ...overrides
  }
}

function createMockProviders() {
  return [
    {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      apiKey: 'sk-openai',
      apiHost: 'https://api.openai.com/v1',
      models: [{ id: 'text-embedding-3-small', provider: 'openai', name: 'text-embedding-3-small', group: 'embed' }]
    },
    {
      id: 'jina',
      type: 'openai',
      name: 'Jina',
      apiKey: 'sk-jina',
      apiHost: 'https://api.jina.ai/v1',
      models: [{ id: 'jina-reranker-v1', provider: 'jina', name: 'jina-reranker-v1', group: 'rerank' }]
    }
  ]
}

describe('Knowledge Handlers', () => {
  let req: Partial<ValidationRequest>
  let res: Partial<Response>
  let jsonMock: ReturnType<typeof vi.fn>
  let statusMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    jsonMock = vi.fn()
    statusMock = vi.fn(() => ({ json: jsonMock }))

    req = {}
    res = {
      status: statusMock,
      json: jsonMock
    }

    vi.clearAllMocks()
  })

  describe('listKnowledgeBases', () => {
    it('should return v2 knowledge bases with public API shape', async () => {
      listWithOffsetMock.mockResolvedValue({
        items: [createMockKnowledgeBase()],
        total: 1
      })

      req.validatedQuery = { limit: 20, offset: 0 }

      await listKnowledgeBases(req as ValidationRequest, res as Response)

      expect(listWithOffsetMock).toHaveBeenCalledWith({ limit: 20, offset: 0 })
      expect(jsonMock).toHaveBeenCalledWith({
        knowledge_bases: [
          expect.objectContaining({
            id: 'kb-1',
            version: 2,
            model: {
              id: 'text-embedding-3-small',
              provider: 'openai'
            }
          })
        ],
        total: 1
      })
    })
  })

  describe('getKnowledgeBase', () => {
    it('should return a single v2 knowledge base', async () => {
      getKnowledgeBaseByIdMock.mockResolvedValue(createMockKnowledgeBase())

      req.validatedParams = { id: 'kb-1' }

      await getKnowledgeBase(req as ValidationRequest, res as Response)

      expect(getKnowledgeBaseByIdMock).toHaveBeenCalledWith('kb-1')
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'kb-1',
          version: 2,
          preprocessProvider: {
            type: 'preprocess',
            provider: 'mineru'
          }
        })
      )
    })
  })

  describe('searchKnowledge', () => {
    it('should return warnings when no knowledge bases are configured in v2', async () => {
      listAllMock.mockResolvedValue([])

      req.validatedBody = { query: 'test query', document_count: 5 }

      await searchKnowledge(req as ValidationRequest, res as Response)

      expect(jsonMock).toHaveBeenCalledWith({
        query: 'test query',
        results: [],
        total: 0,
        searched_bases: [],
        warnings: ['No knowledge bases configured. Please add knowledge bases in Cherry Studio.']
      })
    })

    it('should return 404 when specified knowledge bases are not found in v2', async () => {
      listAllMock.mockResolvedValue([createMockKnowledgeBase({ id: 'kb-1' })])

      req.validatedBody = {
        query: 'test query',
        knowledge_base_ids: ['missing'],
        document_count: 5
      }

      await searchKnowledge(req as ValidationRequest, res as Response)

      expect(statusMock).toHaveBeenCalledWith(404)
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          message: 'None of the specified knowledge bases were found',
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    })

    it('should search knowledge bases using v2 metadata and legacy vector service', async () => {
      listAllMock.mockResolvedValue([createMockKnowledgeBase()])
      reduxSelectMock.mockResolvedValue(createMockProviders())
      knowledgeSearchMock.mockResolvedValue([
        {
          pageContent: 'knowledge chunk',
          score: 0.91,
          metadata: {
            source: 'note'
          }
        }
      ])

      req.validatedBody = { query: 'knowledge', document_count: 5 }

      await searchKnowledge(req as ValidationRequest, res as Response)

      expect(knowledgeSearchMock).toHaveBeenCalledTimes(1)
      expect(jsonMock).toHaveBeenCalledWith({
        query: 'knowledge',
        results: [
          {
            pageContent: 'knowledge chunk',
            score: 0.91,
            metadata: {
              source: 'note'
            },
            knowledge_base_id: 'kb-1',
            knowledge_base_name: 'Test Knowledge Base'
          }
        ],
        total: 1,
        searched_bases: [{ id: 'kb-1', name: 'Test Knowledge Base' }]
      })
    })
  })

  describe('createKnowledgeItems', () => {
    it('should create items and persist ingestion metadata on success', async () => {
      getKnowledgeBaseByIdMock.mockResolvedValue(createMockKnowledgeBase())
      reduxSelectMock.mockResolvedValue(createMockProviders())
      createKnowledgeItemsMock.mockResolvedValue({
        items: [createMockKnowledgeItem()]
      })
      updateKnowledgeItemMock
        .mockResolvedValueOnce(createMockKnowledgeItem({ status: 'pending' }))
        .mockResolvedValueOnce(
          createMockKnowledgeItem({
            status: 'completed',
            data: {
              content: 'hello world',
              ingestion: {
                loaderId: 'loader-1',
                loaderIds: ['loader-1']
              }
            }
          })
        )
      knowledgeAddMock.mockResolvedValue({
        entriesAdded: 1,
        uniqueId: 'loader-1',
        uniqueIds: ['loader-1'],
        loaderType: 'NoteLoader'
      })

      req.validatedParams = { id: 'kb-1' }
      req.validatedBody = {
        items: [
          {
            type: 'note',
            data: {
              content: 'hello world'
            }
          }
        ]
      }

      await createKnowledgeItems(req as ValidationRequest, res as Response)

      expect(createKnowledgeItemsMock).toHaveBeenCalledWith('kb-1', {
        items: [
          {
            type: 'note',
            data: {
              content: 'hello world'
            }
          }
        ]
      })
      expect(updateKnowledgeItemMock).toHaveBeenNthCalledWith(1, 'item-1', {
        status: 'pending',
        error: null
      })
      expect(updateKnowledgeItemMock).toHaveBeenNthCalledWith(2, 'item-1', {
        data: {
          content: 'hello world',
          ingestion: {
            loaderId: 'loader-1',
            loaderIds: ['loader-1']
          }
        },
        status: 'completed',
        error: null
      })
      expect(statusMock).toHaveBeenCalledWith(201)
      expect(jsonMock).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            id: 'item-1',
            status: 'completed'
          })
        ]
      })
    })

    it('should mark items as failed when vector ingest does not return loader ids', async () => {
      getKnowledgeBaseByIdMock.mockResolvedValue(createMockKnowledgeBase())
      reduxSelectMock.mockResolvedValue(createMockProviders())
      createKnowledgeItemsMock.mockResolvedValue({
        items: [createMockKnowledgeItem()]
      })
      updateKnowledgeItemMock
        .mockResolvedValueOnce(createMockKnowledgeItem({ status: 'pending' }))
        .mockResolvedValueOnce(
          createMockKnowledgeItem({
            status: 'failed',
            error: 'Knowledge item ingest failed'
          })
        )
      knowledgeAddMock.mockResolvedValue({
        entriesAdded: 0,
        uniqueId: '',
        uniqueIds: [''],
        loaderType: 'NoteLoader'
      })

      req.validatedParams = { id: 'kb-1' }
      req.validatedBody = {
        items: [
          {
            type: 'note',
            data: {
              content: 'hello world'
            }
          }
        ]
      }

      await createKnowledgeItems(req as ValidationRequest, res as Response)

      expect(updateKnowledgeItemMock).toHaveBeenNthCalledWith(2, 'item-1', {
        status: 'failed',
        error: 'Knowledge item ingest failed'
      })
      expect(statusMock).toHaveBeenCalledWith(201)
      expect(jsonMock).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            id: 'item-1',
            status: 'failed'
          })
        ]
      })
    })
  })
})
