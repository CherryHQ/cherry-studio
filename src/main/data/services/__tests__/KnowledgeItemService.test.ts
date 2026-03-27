import { ErrorCode } from '@shared/data/api'
import type { CreateKnowledgeItemsDto, UpdateKnowledgeItemDto } from '@shared/data/api/schemas/knowledges'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getKnowledgeBaseByIdMock } = vi.hoisted(() => ({
  getKnowledgeBaseByIdMock: vi.fn()
}))

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

vi.mock('../KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    getById: getKnowledgeBaseByIdMock
  }
}))

const { KnowledgeItemService } = await import('../KnowledgeItemService')

function createMockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    baseId: 'kb-1',
    parentId: null,
    type: 'note',
    data: { content: 'hello world' },
    status: 'idle',
    error: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides
  }
}

describe('KnowledgeItemService', () => {
  let service: ReturnType<typeof KnowledgeItemService.getInstance>

  beforeEach(() => {
    mockSelect.mockReset()
    mockInsert.mockReset()
    mockUpdate.mockReset()
    mockDelete.mockReset()
    getKnowledgeBaseByIdMock.mockReset()
    getKnowledgeBaseByIdMock.mockResolvedValue({ id: 'kb-1' })
    service = KnowledgeItemService.getInstance()
  })

  describe('list', () => {
    function setupListMocks(rows: Record<string, unknown>[], count: number) {
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(rows)
              })
            })
          })
        })
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count }])
        })
      })
    }

    it('should return paginated root items', async () => {
      setupListMocks([createMockRow({ data: JSON.stringify({ content: 'hello world' }) })], 1)

      const result = await service.list('kb-1', { page: 1, limit: 20 })

      expect(getKnowledgeBaseByIdMock).toHaveBeenCalledWith('kb-1')
      expect(result).toMatchObject({
        total: 1,
        page: 1
      })
      expect(result.items[0]).toMatchObject({
        id: 'item-1',
        baseId: 'kb-1',
        type: 'note',
        data: {
          content: 'hello world'
        }
      })
    })

    it('should return paginated child items when parentId is provided', async () => {
      setupListMocks([createMockRow({ id: 'item-2', parentId: 'parent-1' })], 1)

      const result = await service.list('kb-1', { page: 2, limit: 10, parentId: 'parent-1' })

      expect(result.page).toBe(2)
      expect(result.items[0]).toMatchObject({
        id: 'item-2',
        parentId: 'parent-1'
      })
    })
  })

  describe('create', () => {
    it('should validate that at least one item is provided', async () => {
      await expect(service.create('kb-1', { items: [] })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            items: ['At least one item is required']
          }
        }
      })
    })

    it('should throw NotFound when parent item does not exist', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      const dto: CreateKnowledgeItemsDto = {
        items: [
          {
            parentId: 'missing-parent',
            type: 'note',
            data: { content: 'child note' }
          }
        ]
      }

      await expect(service.create('kb-1', dto)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404
      })
    })

    it('should reject parent items from another knowledge base', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow({ id: 'parent-1', baseId: 'kb-2' })])
          })
        })
      })

      const dto: CreateKnowledgeItemsDto = {
        items: [
          {
            parentId: 'parent-1',
            type: 'note',
            data: { content: 'child note' }
          }
        ]
      }

      await expect(service.create('kb-1', dto)).rejects.toMatchObject({
        code: ErrorCode.INVALID_OPERATION,
        details: {
          operation: 'create knowledge item',
          reason: 'Parent item does not belong to this knowledge base'
        }
      })
    })

    it('should create and return knowledge items', async () => {
      const values = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          createMockRow({
            id: 'item-1',
            type: 'directory',
            data: { path: '/tmp/files', recursive: true }
          }),
          createMockRow({
            id: 'item-2',
            type: 'note',
            data: { content: 'child note' }
          })
        ])
      })
      mockInsert.mockReturnValue({ values })

      const dto: CreateKnowledgeItemsDto = {
        items: [
          {
            type: 'directory',
            data: { path: '/tmp/files', recursive: true }
          },
          {
            type: 'note',
            data: { content: 'child note' }
          }
        ]
      }

      const result = await service.create('kb-1', dto)

      expect(values).toHaveBeenCalledWith([
        {
          baseId: 'kb-1',
          parentId: null,
          type: 'directory',
          data: { path: '/tmp/files', recursive: true },
          status: 'idle',
          error: null
        },
        {
          baseId: 'kb-1',
          parentId: null,
          type: 'note',
          data: { content: 'child note' },
          status: 'idle',
          error: null
        }
      ])
      expect(result.items).toHaveLength(2)
      expect(result.items[1]).toMatchObject({
        id: 'item-2',
        parentId: null,
        type: 'note'
      })
    })
  })

  describe('getById', () => {
    it('should return a knowledge item by id', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow({ data: JSON.stringify({ content: 'stored note' }) })])
          })
        })
      })

      const result = await service.getById('item-1')

      expect(result).toMatchObject({
        id: 'item-1',
        data: {
          content: 'stored note'
        }
      })
    })

    it('should throw NotFound when the knowledge item does not exist', async () => {
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

  describe('update', () => {
    it('should return the existing item when update is empty', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow()])
          })
        })
      })

      const result = await service.update('item-1', {})

      expect(result.id).toBe('item-1')
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('should reject data that does not match the existing item type', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow({ type: 'note', data: { content: 'stored note' } })])
          })
        })
      })

      await expect(
        service.update('item-1', {
          data: { path: '/tmp/files', recursive: true }
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        details: {
          fieldErrors: {
            data: ["Data payload does not match the existing knowledge item type 'note'"]
          }
        }
      })

      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('should update and return the knowledge item', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow()])
          })
        })
      })
      const set = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            createMockRow({
              status: 'completed',
              error: null,
              data: { content: 'updated note' }
            })
          ])
        })
      })
      mockUpdate.mockReturnValue({ set })

      const dto: UpdateKnowledgeItemDto = {
        status: 'completed',
        error: null,
        data: { content: 'updated note' }
      }

      const result = await service.update('item-1', dto)

      expect(set).toHaveBeenCalledWith({
        data: { content: 'updated note' },
        status: 'completed',
        error: null
      })
      expect(result).toMatchObject({
        id: 'item-1',
        status: 'completed',
        data: {
          content: 'updated note'
        }
      })
    })
  })

  describe('delete', () => {
    it('should delete an existing knowledge item', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([createMockRow()])
          })
        })
      })
      const where = vi.fn().mockResolvedValue(undefined)
      mockDelete.mockReturnValue({ where })

      await expect(service.delete('item-1')).resolves.toBeUndefined()
      expect(where).toHaveBeenCalled()
    })

    it('should throw NotFound when deleting a missing knowledge item', async () => {
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
