import { DataApiError, ErrorCode } from '@shared/data/api'
import type { KnowledgeBase, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import type { Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ValidationRequest } from '../validators/zodValidator'

const knowledgeBaseListMock = vi.fn()
const knowledgeBaseGetByIdMock = vi.fn()
const orchestratorSearchMock = vi.fn()

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    list: knowledgeBaseListMock,
    getById: knowledgeBaseGetByIdMock
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'KnowledgeOrchestrationService') {
        return { search: orchestratorSearchMock }
      }
      throw new Error(`Unexpected service: ${name}`)
    })
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

const { getKnowledgeBase, listKnowledgeBases, searchKnowledge } = await import('../handlers')

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: '01900000-0000-7000-8000-000000000001',
  name: 'Test Knowledge Base',
  groupId: null,
  dimensions: 3,
  embeddingModelId: 'provider::embed',
  status: 'completed',
  error: null,
  rerankModelId: null,
  fileProcessorId: null,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: 0.5,
  documentCount: 10,
  searchMode: 'hybrid',
  hybridAlpha: 0.5,
  createdAt: '2026-06-05T00:00:00.000Z',
  updatedAt: '2026-06-05T00:00:00.000Z',
  ...overrides
})

const createSearchResult = (overrides: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult => ({
  pageContent: 'matched content',
  score: 0.8,
  scoreKind: 'relevance',
  rank: 1,
  metadata: {
    itemId: '01900000-0000-7000-8000-000000000101',
    itemType: 'note',
    source: 'note',
    chunkIndex: 0,
    tokenCount: 10
  },
  itemId: '01900000-0000-7000-8000-000000000101',
  chunkId: 'chunk-1',
  ...overrides
})

describe('Knowledge API handlers', () => {
  let req: ValidationRequest
  let res: Partial<Response>
  let jsonMock: ReturnType<typeof vi.fn>
  let statusMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    jsonMock = vi.fn()
    statusMock = vi.fn(() => ({ json: jsonMock }))
    req = {} as ValidationRequest
    res = {
      status: statusMock,
      json: jsonMock
    }

    vi.clearAllMocks()
  })

  describe('listKnowledgeBases', () => {
    it('returns v2 paginated knowledge bases', async () => {
      const response = { items: [{ ...createKnowledgeBase(), itemCount: 2 }], total: 1, page: 1 }
      knowledgeBaseListMock.mockResolvedValue(response)
      req.validatedQuery = { limit: 20, offset: 0 }

      await listKnowledgeBases(req, res as Response)

      expect(knowledgeBaseListMock).toHaveBeenCalledWith({ page: 1, limit: 20 })
      expect(jsonMock).toHaveBeenCalledWith(response)
    })

    it('maps v2 errors to API error responses', async () => {
      knowledgeBaseListMock.mockRejectedValue(new DataApiError(ErrorCode.DATABASE_ERROR, 'database unavailable', 500))

      await listKnowledgeBases(req, res as Response)

      expect(statusMock).toHaveBeenCalledWith(500)
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          message: 'database unavailable',
          type: 'server_error',
          code: ErrorCode.DATABASE_ERROR,
          details: undefined
        }
      })
    })
  })

  describe('getKnowledgeBase', () => {
    it('returns a v2 knowledge base', async () => {
      const base = createKnowledgeBase()
      knowledgeBaseGetByIdMock.mockResolvedValue(base)
      req.validatedParams = { id: base.id }

      await getKnowledgeBase(req, res as Response)

      expect(knowledgeBaseGetByIdMock).toHaveBeenCalledWith(base.id)
      expect(jsonMock).toHaveBeenCalledWith(base)
    })

    it('returns 404 when v2 base lookup fails with not found', async () => {
      knowledgeBaseGetByIdMock.mockRejectedValue(new DataApiError(ErrorCode.NOT_FOUND, 'KnowledgeBase not found', 404))
      req.validatedParams = { id: 'missing' }

      await getKnowledgeBase(req, res as Response)

      expect(statusMock).toHaveBeenCalledWith(404)
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          message: 'KnowledgeBase not found',
          type: 'invalid_request_error',
          code: ErrorCode.NOT_FOUND,
          details: undefined
        }
      })
    })
  })

  describe('searchKnowledge', () => {
    it('returns a v2-native empty result when no bases exist', async () => {
      knowledgeBaseListMock.mockResolvedValue({ items: [], total: 0, page: 1 })
      req.validatedBody = { query: 'test query', document_count: 5 }

      await searchKnowledge(req, res as Response)

      expect(jsonMock).toHaveBeenCalledWith({
        query: 'test query',
        results: [],
        total: 0,
        searchedBases: [],
        warnings: ['No knowledge bases configured. Please add knowledge bases in Cherry Studio.']
      })
    })

    it('searches selected v2 bases and sorts merged results by score', async () => {
      const firstBase = createKnowledgeBase({ id: '01900000-0000-7000-8000-000000000001', name: 'First' })
      const secondBase = createKnowledgeBase({ id: '01900000-0000-7000-8000-000000000002', name: 'Second' })
      knowledgeBaseListMock.mockResolvedValue({ items: [firstBase, secondBase], total: 2, page: 1 })
      orchestratorSearchMock
        .mockResolvedValueOnce([createSearchResult({ score: 0.4, chunkId: 'low' })])
        .mockResolvedValueOnce([createSearchResult({ score: 0.9, chunkId: 'high' })])

      req.validatedBody = {
        query: 'test query',
        knowledge_base_ids: [firstBase.id, secondBase.id],
        document_count: 1
      }

      await searchKnowledge(req, res as Response)

      expect(orchestratorSearchMock).toHaveBeenCalledWith(firstBase.id, 'test query')
      expect(orchestratorSearchMock).toHaveBeenCalledWith(secondBase.id, 'test query')
      expect(jsonMock).toHaveBeenCalledWith({
        query: 'test query',
        results: [createSearchResult({ score: 0.9, chunkId: 'high' })],
        total: 1,
        searchedBases: [
          { id: firstBase.id, name: firstBase.name },
          { id: secondBase.id, name: secondBase.name }
        ]
      })
    })

    it('searches every v2 base across paginated list results', async () => {
      const firstPageBase = createKnowledgeBase({ id: '01900000-0000-7000-8000-000000000001', name: 'First page' })
      const secondPageBase = createKnowledgeBase({ id: '01900000-0000-7000-8000-000000000002', name: 'Second page' })
      knowledgeBaseListMock
        .mockResolvedValueOnce({ items: [firstPageBase], total: 101, page: 1 })
        .mockResolvedValueOnce({ items: [secondPageBase], total: 101, page: 2 })
      orchestratorSearchMock.mockResolvedValue([])

      req.validatedBody = { query: 'test query', document_count: 5 }

      await searchKnowledge(req, res as Response)

      expect(knowledgeBaseListMock).toHaveBeenNthCalledWith(1, { page: 1, limit: 100 })
      expect(knowledgeBaseListMock).toHaveBeenNthCalledWith(2, { page: 2, limit: 100 })
      expect(orchestratorSearchMock).toHaveBeenCalledWith(firstPageBase.id, 'test query')
      expect(orchestratorSearchMock).toHaveBeenCalledWith(secondPageBase.id, 'test query')
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          searchedBases: [
            { id: firstPageBase.id, name: firstPageBase.name },
            { id: secondPageBase.id, name: secondPageBase.name }
          ]
        })
      )
    })

    it('returns 404 when requested bases are not found', async () => {
      knowledgeBaseListMock.mockResolvedValue({ items: [createKnowledgeBase()], total: 1, page: 1 })
      req.validatedBody = {
        query: 'test query',
        knowledge_base_ids: ['missing'],
        document_count: 5
      }

      await searchKnowledge(req, res as Response)

      expect(statusMock).toHaveBeenCalledWith(404)
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          message: 'None of the specified knowledge bases were found',
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
      expect(orchestratorSearchMock).not.toHaveBeenCalled()
    })

    it('returns partial failure warnings when one base search fails', async () => {
      const brokenBase = createKnowledgeBase({ id: '01900000-0000-7000-8000-000000000001', name: 'Broken' })
      const goodBase = createKnowledgeBase({ id: '01900000-0000-7000-8000-000000000002', name: 'Good' })
      const result = createSearchResult()
      knowledgeBaseListMock.mockResolvedValue({ items: [brokenBase, goodBase], total: 2, page: 1 })
      orchestratorSearchMock.mockRejectedValueOnce(new Error('embed failed')).mockResolvedValueOnce([result])

      req.validatedBody = { query: 'test query', document_count: 5 }

      await searchKnowledge(req, res as Response)

      expect(jsonMock).toHaveBeenCalledWith({
        query: 'test query',
        results: [result],
        total: 1,
        searchedBases: [
          { id: brokenBase.id, name: brokenBase.name },
          { id: goodBase.id, name: goodBase.name }
        ],
        warnings: ['Knowledge base "Broken" search failed: embed failed']
      })
    })

    it('returns 502 when all base searches fail', async () => {
      const base = createKnowledgeBase({ name: 'Broken' })
      knowledgeBaseListMock.mockResolvedValue({ items: [base], total: 1, page: 1 })
      orchestratorSearchMock.mockRejectedValue(new Error('embed failed'))

      req.validatedBody = { query: 'test query', document_count: 5 }

      await searchKnowledge(req, res as Response)

      expect(statusMock).toHaveBeenCalledWith(502)
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          message: 'All knowledge base searches failed. Check embedding provider configuration.',
          type: 'upstream_error',
          code: 'SEARCH_ALL_FAILED',
          failedBases: [{ id: base.id, name: base.name, error: 'embed failed' }]
        }
      })
    })
  })
})
