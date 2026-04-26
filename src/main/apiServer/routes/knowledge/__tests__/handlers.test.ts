import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ValidationRequest } from '../../agents/validators/zodValidator'

vi.mock('@application', () => ({
  application: {
    get: vi.fn()
  }
}))

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    list: vi.fn(),
    getById: vi.fn()
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

import { getKnowledgeBase, listKnowledgeBases, searchKnowledge } from '../handlers'

function createMockKnowledgeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'kb-test-id',
    name: 'Test Knowledge Base',
    description: 'Test description',
    groupId: null,
    emoji: '📁',
    dimensions: 1536,
    embeddingModelId: 'ollama:nomic-embed-text',
    chunkSize: 500,
    chunkOverlap: 50,
    documentCount: 10,
    searchMode: 'hybrid',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('Knowledge Handlers', () => {
  let req: Partial<ValidationRequest>
  let res: Partial<Response>
  let jsonMock: ReturnType<typeof vi.fn>
  let statusMock: ReturnType<typeof vi.fn>
  let runtimeSearchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    jsonMock = vi.fn()
    statusMock = vi.fn(() => ({ json: jsonMock }))
    runtimeSearchMock = vi.fn()

    req = {}
    res = {
      status: statusMock,
      json: jsonMock
    }

    vi.mocked(application.get).mockReturnValue({ search: runtimeSearchMock } as never)
    vi.clearAllMocks()
  })

  describe('listKnowledgeBases', () => {
    it('should return paginated knowledge bases from v2 storage', async () => {
      const mockBases = [
        createMockKnowledgeBase({ id: 'kb-1', name: 'KB 1' }),
        createMockKnowledgeBase({ id: 'kb-2', name: 'KB 2' })
      ]
      vi.mocked(knowledgeBaseService.list).mockResolvedValue({ items: mockBases, total: 3, page: 1 })

      req.validatedQuery = { limit: 2, offset: 0 }

      await listKnowledgeBases(req as ValidationRequest, res as Response)

      expect(knowledgeBaseService.list).toHaveBeenCalledWith({ page: 1, limit: 2 })
      expect(jsonMock).toHaveBeenCalledWith({
        knowledge_bases: mockBases,
        total: 3
      })
    })

    it('should not depend on Redux availability', async () => {
      vi.mocked(knowledgeBaseService.list).mockResolvedValue({ items: [], total: 0, page: 1 })

      req.validatedQuery = { limit: 20, offset: 0 }

      await listKnowledgeBases(req as ValidationRequest, res as Response)

      expect(statusMock).not.toHaveBeenCalledWith(503)
      expect(jsonMock).toHaveBeenCalledWith({ knowledge_bases: [], total: 0 })
    })
  })

  describe('getKnowledgeBase', () => {
    it('should return a single knowledge base from v2 storage', async () => {
      const mockBase = createMockKnowledgeBase({ id: 'kb-1' })
      vi.mocked(knowledgeBaseService.getById).mockResolvedValue(mockBase)

      req.validatedParams = { id: 'kb-1' }

      await getKnowledgeBase(req as ValidationRequest, res as Response)

      expect(knowledgeBaseService.getById).toHaveBeenCalledWith('kb-1')
      expect(jsonMock).toHaveBeenCalledWith(mockBase)
    })

    it('should return 404 when knowledge base not found', async () => {
      vi.mocked(knowledgeBaseService.getById).mockRejectedValue(
        DataApiErrorFactory.notFound('KnowledgeBase', 'non-existent')
      )

      req.validatedParams = { id: 'non-existent' }

      await getKnowledgeBase(req as ValidationRequest, res as Response)

      expect(statusMock).toHaveBeenCalledWith(404)
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          message: 'Knowledge base not found: non-existent',
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    })
  })

  describe('searchKnowledge', () => {
    it('should return warnings when no knowledge bases configured', async () => {
      vi.mocked(knowledgeBaseService.list).mockResolvedValue({ items: [], total: 0, page: 1 })

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

    it('should return 404 when specified knowledge bases not found', async () => {
      vi.mocked(knowledgeBaseService.list).mockResolvedValue({
        items: [createMockKnowledgeBase({ id: 'kb-1' })],
        total: 1,
        page: 1
      })

      req.validatedBody = {
        query: 'test query',
        knowledge_base_ids: ['non-existent'],
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

    it('should search v2 runtime and annotate results with knowledge base metadata', async () => {
      const mockBase = createMockKnowledgeBase({ id: 'kb-1', name: 'KB 1' })
      vi.mocked(knowledgeBaseService.list).mockResolvedValue({ items: [mockBase], total: 1, page: 1 })
      runtimeSearchMock.mockResolvedValue([
        {
          pageContent: 'result',
          score: 0.9,
          metadata: { itemId: 'item-1', itemType: 'note', source: 'note', name: 'Note', chunkIndex: 0, tokenCount: 3 },
          itemId: 'item-1',
          chunkId: 'chunk-1'
        }
      ])

      req.validatedBody = { query: 'test query', document_count: 5 }

      await searchKnowledge(req as ValidationRequest, res as Response)

      expect(application.get).toHaveBeenCalledWith('KnowledgeRuntimeService')
      expect(runtimeSearchMock).toHaveBeenCalledWith(mockBase, 'test query')
      expect(jsonMock).toHaveBeenCalledWith({
        query: 'test query',
        results: [
          expect.objectContaining({
            pageContent: 'result',
            knowledge_base_id: 'kb-1',
            knowledge_base_name: 'KB 1'
          })
        ],
        total: 1,
        searched_bases: [{ id: 'kb-1', name: 'KB 1' }]
      })
    })
  })
})
