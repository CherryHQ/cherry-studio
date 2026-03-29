import type { CreateTranslateLanguageDto } from '@shared/data/api/schemas/translate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock db - tx shares the same mocks since transaction passes tx to callback
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

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx))
}

vi.mock('@main/core/application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    DbService: { getDb: () => mockDb }
  })
})

const { TranslateLanguageService } = await import('../TranslateLanguageService')

function createMockRow(overrides: Record<string, unknown> = {}) {
  return {
    langCode: 'ja-jp',
    value: 'Japanese',
    emoji: '\uD83C\uDDEF\uD83C\uDDF5',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('TranslateLanguageService', () => {
  let service: InstanceType<typeof TranslateLanguageService>

  beforeEach(() => {
    vi.clearAllMocks()
    service = new TranslateLanguageService()
  })

  describe('list', () => {
    it('should return all languages ordered by createdAt', async () => {
      const rows = [createMockRow()]
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(rows)
        })
      })

      const result = await service.list()
      expect(result).toHaveLength(1)
      expect(result[0].langCode).toBe('ja-jp')
    })
  })

  describe('getByLangCode', () => {
    it('should return a language by langCode', async () => {
      const row = createMockRow()
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([row])
          })
        })
      })

      const result = await service.getByLangCode('ja-jp')
      expect(result.langCode).toBe('ja-jp')
    })

    it('should throw NotFound for non-existent langCode', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      await expect(service.getByLangCode('xx-xx')).rejects.toThrow()
    })
  })

  describe('create', () => {
    it('should create a language', async () => {
      const row = createMockRow()
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([row])
        })
      })

      const dto: CreateTranslateLanguageDto = {
        langCode: 'ja-jp',
        value: 'Japanese',
        emoji: '\uD83C\uDDEF\uD83C\uDDF5'
      }

      const result = await service.create(dto)
      expect(result.langCode).toBe('ja-jp')
    })

    it('should reject duplicate langCode via UNIQUE constraint', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(new Error('UNIQUE constraint failed: translate_language.lang_code'))
        })
      })

      const dto: CreateTranslateLanguageDto = {
        langCode: 'ja-jp',
        value: 'Japanese',
        emoji: '\uD83C\uDDEF\uD83C\uDDF5'
      }

      await expect(service.create(dto)).rejects.toThrow(/already exists/)
    })
  })

  describe('update', () => {
    it('should update value/emoji', async () => {
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

      const result = await service.update('ja-jp', { value: 'Updated' })
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

      const result = await service.update('ja-jp', {})
      expect(result.langCode).toBe('ja-jp')
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('should throw NotFound for non-existent langCode', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      await expect(service.update('xx-xx', { value: 'Test' })).rejects.toThrow()
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

      await expect(service.delete('ja-jp')).resolves.toBeUndefined()
    })

    it('should throw NotFound for non-existent langCode', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      })

      await expect(service.delete('xx-xx')).rejects.toThrow()
    })
  })
})
