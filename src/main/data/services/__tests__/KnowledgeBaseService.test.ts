import { ErrorCode } from '@shared/data/api'
import type { CreateKnowledgeBaseDto, UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

vi.mock('@data/db/DbService', () => ({
  dbService: {
    getDb: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete
    }))
  }
}))

const { KnowledgeBaseService } = await import('../KnowledgeBaseService')

function createMockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'kb-1',
    name: 'Knowledge Base',
    description: 'Knowledge base description',
    dimensions: 1536,
    embeddingModelId: 'text-embedding-3-large',
    rerankModelId: 'rerank-v1',
    fileProcessorId: 'processor-1',
    chunkSize: 800,
    chunkOverlap: 120,
    threshold: 0.55,
    documentCount: 5,
    searchMode: 'hybrid',
    hybridAlpha: 0.7,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides
  }
}

describe('KnowledgeBaseService', () => {
  let service: ReturnType<typeof KnowledgeBaseService.getInstance>

  beforeEach(() => {
    mockSelect.mockReset()
    mockInsert.mockReset()
    mockUpdate.mockReset()
    mockDelete.mockReset()
    service = KnowledgeBaseService.getInstance()
  })

  describe('list', () => {
    it('should return mapped knowledge bases', async () => {
      const rows = [createMockRow(), createMockRow({ id: 'kb-2', name: 'Another Base', description: null })]
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(rows)
        })
      })

      const result = await service.list()

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        id: 'kb-1',
        name: 'Knowledge Base',
        embeddingModelId: 'text-embedding-3-large'
      })
      expect(result[1].description).toBeUndefined()
    })
  })

  describe('getById', () => {
    it('should return a knowledge base by id', async () => {
      const row = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      })

      const result = await service.getById('kb-1')

      expect(result).toMatchObject({
        id: 'kb-1',
        name: 'Knowledge Base',
        dimensions: 1536
      })
    })

    it('should throw NotFound when the knowledge base does not exist', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      await expect(service.getById('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })

  describe('create', () => {
    it('should validate required name', async () => {
      await expect(
        service.create({
          name: '   ',
          dimensions: 1536,
          embeddingModelId: 'text-embedding-3-large'
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            name: ['Name is required']
          }
        }
      })
    })

    it('should validate required embedding model id', async () => {
      await expect(
        service.create({
          name: 'Knowledge Base',
          dimensions: 1536,
          embeddingModelId: '   '
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            embeddingModelId: ['Embedding model is required']
          }
        }
      })
    })

    it('should create a knowledge base with trimmed identifiers', async () => {
      const row = createMockRow({ name: 'New Base', embeddingModelId: 'embed-model' })
      const values = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row])
      })
      mockInsert.mockReturnValue({ values })

      const dto: CreateKnowledgeBaseDto = {
        name: '  New Base  ',
        description: 'desc',
        dimensions: 1024,
        embeddingModelId: '  embed-model  ',
        rerankModelId: 'rerank-model',
        fileProcessorId: 'processor-1',
        chunkSize: 512,
        chunkOverlap: 64,
        threshold: 0.5,
        documentCount: 3,
        searchMode: 'default',
        hybridAlpha: 0.6
      }

      const result = await service.create(dto)

      expect(values).toHaveBeenCalledWith({
        name: 'New Base',
        description: 'desc',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        rerankModelId: 'rerank-model',
        fileProcessorId: 'processor-1',
        chunkSize: 512,
        chunkOverlap: 64,
        threshold: 0.5,
        documentCount: 3,
        searchMode: 'default',
        hybridAlpha: 0.6
      })
      expect(result).toMatchObject({
        id: 'kb-1',
        name: 'New Base',
        embeddingModelId: 'embed-model'
      })
    })
  })

  describe('update', () => {
    it('should reject updating dimensions', async () => {
      await expect(
        service.update('kb-1', { dimensions: 3072 } as UpdateKnowledgeBaseDto & { dimensions: number })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            dimensions: ['dimensions cannot be updated via PATCH; use a dedicated re-embed endpoint']
          }
        }
      })
    })

    it('should reject updating embeddingModelId', async () => {
      await expect(
        service.update('kb-1', { embeddingModelId: 'new-model' } as UpdateKnowledgeBaseDto & {
          embeddingModelId: string
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            embeddingModelId: ['embeddingModelId cannot be updated via PATCH; use a dedicated re-embed endpoint']
          }
        }
      })
    })

    it('should validate non-empty name when provided', async () => {
      await expect(service.update('kb-1', { name: '   ' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            name: ['Name is required']
          }
        }
      })
    })

    it('should return the existing knowledge base when update is empty', async () => {
      const row = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      })

      const result = await service.update('kb-1', {})

      expect(result.id).toBe('kb-1')
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('should update and return the knowledge base', async () => {
      const existing = createMockRow()
      const updated = createMockRow({
        name: 'Updated Base',
        description: null,
        chunkSize: null,
        hybridAlpha: 0.9
      })
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([existing])
          })
        })
      })
      const set = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated])
        })
      })
      mockUpdate.mockReturnValue({ set })

      const result = await service.update('kb-1', {
        name: '  Updated Base  ',
        description: null,
        chunkSize: null,
        hybridAlpha: 0.9
      })

      expect(set).toHaveBeenCalledWith({
        name: 'Updated Base',
        description: null,
        chunkSize: null,
        hybridAlpha: 0.9
      })
      expect(result).toMatchObject({
        id: 'kb-1',
        name: 'Updated Base',
        hybridAlpha: 0.9
      })
      expect(result.description).toBeUndefined()
    })
  })

  describe('delete', () => {
    it('should delete an existing knowledge base', async () => {
      const row = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      })
      const where = vi.fn().mockResolvedValue(undefined)
      mockDelete.mockReturnValue({ where })

      await expect(service.delete('kb-1')).resolves.toBeUndefined()
      expect(where).toHaveBeenCalled()
    })

    it('should throw NotFound when deleting a missing knowledge base', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      await expect(service.delete('missing')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })
  })
})
