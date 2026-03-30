import { ErrorCode } from '@shared/data/api'
import type { CreateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn(() => ({
      getDb: vi.fn(() => ({
        select: mockSelect,
        insert: mockInsert,
        update: mockUpdate,
        delete: mockDelete
      }))
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
  let service: InstanceType<typeof KnowledgeBaseService>

  beforeEach(() => {
    mockSelect.mockReset()
    mockInsert.mockReset()
    mockUpdate.mockReset()
    mockDelete.mockReset()
    service = new KnowledgeBaseService()
  })

  describe('list', () => {
    it('should return paginated knowledge bases', async () => {
      const rows = [createMockRow({ id: 'kb-2', name: 'Another Base', description: null })]
      const offset = vi.fn().mockResolvedValue(rows)
      const limit = vi.fn().mockReturnValue({ offset })
      const orderBy = vi.fn().mockReturnValue({ limit })
      const from = vi.fn().mockReturnValue({ orderBy })
      const countFrom = vi.fn().mockResolvedValue([{ count: 2 }])

      mockSelect.mockReturnValueOnce({
        from
      })
      mockSelect.mockReturnValueOnce({
        from: countFrom
      })

      const result = await service.list({ page: 2, limit: 1 })

      expect(limit).toHaveBeenCalledWith(1)
      expect(offset).toHaveBeenCalledWith(1)
      expect(result).toMatchObject({
        total: 2,
        page: 2
      })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        id: 'kb-2',
        name: 'Another Base',
        embeddingModelId: 'text-embedding-3-large'
      })
      expect(result.items[0].description).toBeUndefined()
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
        searchMode: 'hybrid',
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
        searchMode: 'hybrid',
        hybridAlpha: 0.6
      })
      expect(result).toMatchObject({
        id: 'kb-1',
        name: 'New Base',
        embeddingModelId: 'embed-model'
      })
    })

    it('should reject invalid runtime config before insert', async () => {
      const dto: CreateKnowledgeBaseDto = {
        name: 'Invalid Base',
        dimensions: 1024,
        embeddingModelId: 'embed-model',
        chunkSize: 256,
        chunkOverlap: 256
      }

      await expect(service.create(dto)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkOverlap: ['Chunk overlap must be smaller than chunk size']
          }
        }
      })

      expect(mockInsert).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
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
        chunkOverlap: null,
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
        chunkOverlap: null,
        hybridAlpha: 0.9
      })

      expect(set).toHaveBeenCalledWith({
        name: 'Updated Base',
        description: null,
        chunkSize: null,
        chunkOverlap: null,
        hybridAlpha: 0.9
      })
      expect(result).toMatchObject({
        id: 'kb-1',
        name: 'Updated Base',
        hybridAlpha: 0.9
      })
      expect(result.description).toBeUndefined()
    })

    it('should clear stale dependent config fields during update', async () => {
      const existing = createMockRow({
        chunkSize: 256,
        chunkOverlap: 120,
        searchMode: 'hybrid',
        hybridAlpha: 0.7
      })
      const updated = createMockRow({
        chunkSize: 100,
        chunkOverlap: null,
        searchMode: 'default',
        hybridAlpha: null
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
        chunkSize: 100,
        searchMode: 'default'
      })

      expect(set).toHaveBeenCalledWith({
        chunkSize: 100,
        chunkOverlap: null,
        searchMode: 'default',
        hybridAlpha: null
      })
      expect(result).toMatchObject({
        chunkSize: 100,
        searchMode: 'default'
      })
      expect(result.chunkOverlap).toBeUndefined()
      expect(result.hybridAlpha).toBeUndefined()
    })

    it('should reject explicitly provided hybridAlpha when search mode is not hybrid', async () => {
      const existing = createMockRow({
        searchMode: 'hybrid',
        hybridAlpha: 0.7
      })
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([existing])
          })
        })
      })

      await expect(
        service.update('kb-1', {
          searchMode: 'default',
          hybridAlpha: 0.7
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            hybridAlpha: ['Hybrid alpha requires hybrid search mode']
          }
        }
      })

      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('should not silently clean stale dependent fields during unrelated updates', async () => {
      const existing = createMockRow({
        searchMode: 'default',
        hybridAlpha: 0.7
      })
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([existing])
          })
        })
      })

      await expect(
        service.update('kb-1', {
          name: 'Renamed Base'
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            hybridAlpha: ['Hybrid alpha requires hybrid search mode']
          }
        }
      })

      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('should reject explicitly provided chunkOverlap when it no longer fits chunkSize', async () => {
      const existing = createMockRow({
        chunkSize: 256,
        chunkOverlap: 64
      })
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([existing])
          })
        })
      })

      await expect(
        service.update('kb-1', {
          chunkSize: 100,
          chunkOverlap: 120
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            chunkOverlap: ['Chunk overlap must be smaller than chunk size']
          }
        }
      })

      expect(mockUpdate).not.toHaveBeenCalled()
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
