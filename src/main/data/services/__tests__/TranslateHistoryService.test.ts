import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { translateHistoryService } from '@data/services/TranslateHistoryService'
import type { CreateTranslateHistoryDto, UpdateTranslateHistoryDto } from '@shared/data/api/schemas/translate'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('TranslateHistoryService', () => {
  const dbh = setupTestDatabase()

  async function seedHistory(overrides: Partial<typeof translateHistoryTable.$inferInsert> = {}) {
    const values: typeof translateHistoryTable.$inferInsert = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      sourceText: 'Hello',
      targetText: 'Bonjour',
      sourceLanguage: null,
      targetLanguage: null,
      star: false,
      ...overrides
    }
    await dbh.db.insert(translateHistoryTable).values(values)
    return values
  }

  describe('list', () => {
    it('should return paginated results with defaults', async () => {
      await seedHistory()

      const result = await translateHistoryService.list({ page: 1, limit: 20 })
      expect(result.items).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
    })

    it('should return empty results', async () => {
      const result = await translateHistoryService.list({ page: 1, limit: 20 })
      expect(result.items).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('should pass custom page and limit', async () => {
      const result = await translateHistoryService.list({ page: 2, limit: 10 })
      expect(result.page).toBe(2)
    })

    it('should search by text', async () => {
      await seedHistory({ sourceText: 'Hello world' })
      await seedHistory({ id: '550e8400-e29b-41d4-a716-446655440001', sourceText: 'Goodbye' })

      const result = await translateHistoryService.list({ page: 1, limit: 20, search: 'Hello' })
      expect(result.items.length).toBeGreaterThanOrEqual(1)
      expect(result.items.some((i) => i.sourceText.includes('Hello'))).toBe(true)
    })

    it('should escape LIKE wildcards in search', async () => {
      await expect(
        translateHistoryService.list({ page: 1, limit: 20, search: '100% off_sale\\test' })
      ).resolves.toBeDefined()
    })

    it('should filter by star', async () => {
      await seedHistory({ star: true })
      await seedHistory({ id: '550e8400-e29b-41d4-a716-446655440002', star: false })

      const result = await translateHistoryService.list({ page: 1, limit: 20, star: true })
      expect(result.items.every((i) => i.star === true)).toBe(true)
    })
  })

  describe('getById', () => {
    it('should return a translate history by id', async () => {
      const seeded = await seedHistory()

      const result = await translateHistoryService.getById(seeded.id!)
      expect(result.id).toBe(seeded.id)
      expect(result.sourceText).toBe('Hello')
      expect(result.targetText).toBe('Bonjour')
    })

    it('should throw NotFound for non-existent id', async () => {
      await expect(translateHistoryService.getById('non-existent')).rejects.toThrow()
    })
  })

  describe('create', () => {
    it('should validate and create a translate history', async () => {
      // sourceLanguage/targetLanguage are FK → translate_language(lang_code).
      // The parent table starts empty, so omit them to avoid FK violation.
      const dto = {
        sourceText: 'Hello',
        targetText: 'Bonjour'
      } as CreateTranslateHistoryDto

      const result = await translateHistoryService.create(dto)
      expect(result.sourceText).toBe('Hello')

      const rows = await dbh.db.select().from(translateHistoryTable)
      expect(rows).toHaveLength(1)
    })
  })

  describe('update', () => {
    it('should update a translate history', async () => {
      const seeded = await seedHistory()

      const dto: UpdateTranslateHistoryDto = { star: true }
      const result = await translateHistoryService.update(seeded.id!, dto)
      expect(result.star).toBe(true)

      const [row] = await dbh.db.select().from(translateHistoryTable)
      expect(row.star).toBe(true)
    })

    it('should return existing record on empty update', async () => {
      const seeded = await seedHistory()

      const result = await translateHistoryService.update(seeded.id!, {})
      expect(result.id).toBe(seeded.id)
    })
  })

  describe('delete', () => {
    it('should delete an existing translate history', async () => {
      const seeded = await seedHistory()

      await expect(translateHistoryService.delete(seeded.id!)).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(translateHistoryTable)
      expect(rows).toHaveLength(0)
    })

    it('should throw NotFound for non-existent id', async () => {
      await expect(translateHistoryService.delete('non-existent')).rejects.toThrow()
    })
  })

  describe('clearAll', () => {
    it('should clear all translate histories', async () => {
      await seedHistory()
      await seedHistory({ id: '550e8400-e29b-41d4-a716-446655440003', sourceText: 'Another' })

      await expect(translateHistoryService.clearAll()).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(translateHistoryTable)
      expect(rows).toHaveLength(0)
    })
  })
})
