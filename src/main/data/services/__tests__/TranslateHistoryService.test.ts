import type { CreateTranslateHistoryDto, UpdateTranslateHistoryDto } from '@shared/data/api/schemas/translate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dbService - tx shares the same mocks since transaction passes tx to callback
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

const mockTx = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete
}

vi.mock('@data/db/DbService', () => ({
  dbService: {
    getDb: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
      transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx))
    }))
  }
}))

// Import after mocking
const { TranslateHistoryService } = await import('../TranslateHistoryService')

function createMockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    sourceText: 'Hello',
    targetText: 'Bonjour',
    sourceLanguage: 'en-us',
    targetLanguage: 'fr-fr',
    star: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('TranslateHistoryService', () => {
  let service: ReturnType<typeof TranslateHistoryService.getInstance>

  beforeEach(() => {
    vi.clearAllMocks()
    service = TranslateHistoryService.getInstance()
  })

  describe('list', () => {
    function setupListMocks(rows: Record<string, unknown>[], count: number) {
      // items query (first call)
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
      // count query (second call)
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count }])
        })
      })
    }

    it('should return paginated results with defaults', async () => {
      const rows = [createMockRow()]
      setupListMocks(rows, 1)

      const result = await service.list()
      expect(result.items).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
    })

    it('should return empty results', async () => {
      setupListMocks([], 0)

      const result = await service.list()
      expect(result.items).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('should pass custom page and limit', async () => {
      setupListMocks([], 0)

      const result = await service.list({ page: 2, limit: 10 })
      expect(result.page).toBe(2)
    })
  })

  describe('getById', () => {
    it('should return a translate history by id', async () => {
      const row = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      })

      const result = await service.getById(row.id as string)
      expect(result.id).toBe(row.id)
      expect(result.sourceText).toBe('Hello')
      expect(result.targetText).toBe('Bonjour')
    })

    it('should throw NotFound for non-existent id', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      await expect(service.getById('non-existent')).rejects.toThrow()
    })
  })

  describe('create', () => {
    it('should validate and create a translate history', async () => {
      const row = createMockRow()
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([row])
        })
      })

      const dto: CreateTranslateHistoryDto = {
        sourceText: 'Hello',
        targetText: 'Bonjour',
        sourceLanguage: 'en-us',
        targetLanguage: 'fr-fr'
      }

      const result = await service.create(dto)
      expect(result.sourceText).toBe('Hello')
      expect(mockInsert).toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('should update a translate history', async () => {
      const row = createMockRow()
      // Mock getById
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      })
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...row, star: true }])
          })
        })
      })

      const dto: UpdateTranslateHistoryDto = { star: true }
      const result = await service.update(row.id as string, dto)
      expect(result.star).toBe(true)
    })
  })

  describe('delete', () => {
    it('should delete an existing translate history', async () => {
      const row = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      })
      mockDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      })

      await expect(service.delete(row.id as string)).resolves.toBeUndefined()
    })
  })

  describe('clearAll', () => {
    it('should clear all translate histories', async () => {
      mockDelete.mockResolvedValue(undefined)

      await expect(service.clearAll()).resolves.toBeUndefined()
    })
  })
})
