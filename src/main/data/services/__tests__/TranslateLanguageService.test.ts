import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { translateLanguageService } from '@data/services/TranslateLanguageService'
import { ErrorCode } from '@shared/data/api'
import type { CreateTranslateLanguageDto } from '@shared/data/api/schemas/translate'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('TranslateLanguageService', () => {
  const dbh = setupTestDatabase()

  async function seedLanguage(overrides: Record<string, unknown> = {}) {
    const values = {
      langCode: 'ja-jp',
      value: 'Japanese',
      emoji: '🇯🇵',
      ...overrides
    }
    await dbh.db.insert(translateLanguageTable).values(values as typeof translateLanguageTable.$inferInsert)
  }

  describe('list', () => {
    it('should return all languages ordered by createdAt', async () => {
      await seedLanguage()

      const result = await translateLanguageService.list()
      expect(result).toHaveLength(1)
      expect(result[0].langCode).toBe('ja-jp')
    })
  })

  describe('getByLangCode', () => {
    it('should return a language by langCode', async () => {
      await seedLanguage()

      const result = await translateLanguageService.getByLangCode('ja-jp')
      expect(result.langCode).toBe('ja-jp')
    })

    it('should throw NotFound for non-existent langCode', async () => {
      await expect(translateLanguageService.getByLangCode('xx-xx')).rejects.toThrow()
    })

    it('should surface timestamp anomalies instead of masking them', async () => {
      await dbh.client.execute({
        sql: `INSERT INTO translate_language (lang_code, value, emoji, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL)`,
        args: ['xx-xx', 'Broken', '🇯🇵']
      })

      await expect(translateLanguageService.getByLangCode('xx-xx')).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_SERVER_ERROR
      })
    })
  })

  describe('create', () => {
    it('should create a language', async () => {
      const dto: CreateTranslateLanguageDto = {
        langCode: 'ja-jp',
        value: 'Japanese',
        emoji: '🇯🇵'
      }

      const result = await translateLanguageService.create(dto)
      expect(result.langCode).toBe('ja-jp')

      const rows = await dbh.db.select().from(translateLanguageTable)
      expect(rows).toHaveLength(1)
    })

    it('should reject duplicate langCode via UNIQUE constraint with CONFLICT', async () => {
      await seedLanguage()

      const dto: CreateTranslateLanguageDto = {
        langCode: 'ja-jp',
        value: 'Japanese Duplicate',
        emoji: '🇯🇵'
      }

      // Regression: the earlier implementation matched only on
      // `e.message.includes('UNIQUE constraint failed')`, which misses
      // Drizzle's wrapped "Failed query:" envelope. The fix walks the
      // cause chain; the assertion here locks that contract in.
      await expect(translateLanguageService.create(dto)).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        message: expect.stringContaining('already exists')
      })
    })
  })

  describe('update', () => {
    it('should update value/emoji', async () => {
      await seedLanguage()

      const result = await translateLanguageService.update('ja-jp', { value: 'Updated' })
      expect(result.value).toBe('Updated')

      const [row] = await dbh.db.select().from(translateLanguageTable)
      expect(row.value).toBe('Updated')
    })

    it('should return existing record on empty update', async () => {
      await seedLanguage()

      const result = await translateLanguageService.update('ja-jp', {})
      expect(result.langCode).toBe('ja-jp')
      expect(result.value).toBe('Japanese')
    })

    it('should throw NotFound for non-existent langCode', async () => {
      await expect(translateLanguageService.update('xx-xx', { value: 'Test' })).rejects.toThrow()
    })
  })

  describe('delete', () => {
    it('should delete an existing language', async () => {
      await seedLanguage()

      await expect(translateLanguageService.delete('ja-jp')).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(translateLanguageTable)
      expect(rows).toHaveLength(0)
    })

    it('should throw NotFound for non-existent langCode', async () => {
      await expect(translateLanguageService.delete('xx-xx')).rejects.toThrow()
    })
  })
})
