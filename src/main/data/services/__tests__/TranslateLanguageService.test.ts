import type { CreateTranslateLanguageDto } from '@shared/data/api/schemas/translate'
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

const { TranslateLanguageService } = await import('../TranslateLanguageService')

function createMockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001',
    langCode: 'ja',
    value: 'Japanese',
    emoji: '\uD83C\uDDEF\uD83C\uDDF5',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('TranslateLanguageService', () => {
  let service: ReturnType<typeof TranslateLanguageService.getInstance>

  beforeEach(() => {
    vi.clearAllMocks()
    service = TranslateLanguageService.getInstance()
  })

  describe('list', () => {
    it('should return all custom languages ordered by createdAt', async () => {
      const rows = [createMockRow()]
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(rows)
        })
      })

      const result = await service.list()
      expect(result).toHaveLength(1)
      expect(result[0].langCode).toBe('ja')
    })
  })

  describe('getById', () => {
    it('should return a language by id', async () => {
      const row = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      })

      const result = await service.getById(row.id as string)
      expect(result.langCode).toBe('ja')
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
    it('should create a language within transaction', async () => {
      const row = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([row])
        })
      })

      const dto: CreateTranslateLanguageDto = {
        langCode: 'ja',
        value: 'Japanese',
        emoji: '\uD83C\uDDEF\uD83C\uDDF5'
      }

      const result = await service.create(dto)
      expect(result.langCode).toBe('ja')
    })

    it('should reject duplicate langCode', async () => {
      const existing = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([existing])
          })
        })
      })

      const dto: CreateTranslateLanguageDto = {
        langCode: 'ja',
        value: 'Japanese',
        emoji: '\uD83C\uDDEF\uD83C\uDDF5'
      }

      await expect(service.create(dto)).rejects.toThrow()
    })
  })

  describe('update', () => {
    it('should update a language within transaction', async () => {
      const row = createMockRow()
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
            returning: vi.fn().mockResolvedValue([{ ...row, value: 'Updated' }])
          })
        })
      })

      const result = await service.update(row.id as string, { value: 'Updated' })
      expect(result.value).toBe('Updated')
    })

    it('should return existing record on empty update', async () => {
      const row = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      })

      const result = await service.update(row.id as string, {})
      expect(result.langCode).toBe('ja')
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('should reject duplicate langCode on update', async () => {
      const row = createMockRow()
      const other = createMockRow({ id: '550e8400-e29b-41d4-a716-446655440099', langCode: 'ko-kr' })

      let callCount = 0
      mockSelect.mockImplementation(() => {
        callCount++
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([callCount === 1 ? row : other])
            })
          })
        }
      })

      await expect(service.update(row.id as string, { langCode: 'ko-kr' })).rejects.toThrow()
    })
  })

  describe('delete', () => {
    it('should delete an existing language', async () => {
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
})
