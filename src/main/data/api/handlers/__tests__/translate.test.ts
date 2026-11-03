import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { translateHistoryService } from '@data/services/TranslateHistoryService'
import {
  CreateTranslateHistorySchema,
  CreateTranslateLanguageSchema,
  TranslateHistoryQuerySchema,
  type TranslateHistoryQueryParams,
  UpdateTranslateHistorySchema,
  UpdateTranslateLanguageSchema
} from '@shared/data/api/schemas/translate'

import { translateHandlers } from '../translate'

describe('Translate handler validation (Zod schemas)', () => {
  describe('TranslateHistoryQuerySchema', () => {
    it('should accept empty query', () => {
      expect(() => TranslateHistoryQuerySchema.parse({})).not.toThrow()
    })

    it('should accept valid query', () => {
      const result = TranslateHistoryQuerySchema.parse({
        cursor: '1000:history-1',
        limit: 20,
        star: true,
        search: 'hello'
      })
      expect(result.cursor).toBe('1000:history-1')
      expect(result.star).toBe(true)
    })

    it('should reject offset pagination params', () => {
      expect(() => TranslateHistoryQuerySchema.parse({ page: 1 })).toThrow()
    })

    it('should reject limit over 100', () => {
      expect(() => TranslateHistoryQuerySchema.parse({ limit: 101 })).toThrow()
    })

    it('should reject non-integer limit', () => {
      expect(() => TranslateHistoryQuerySchema.parse({ limit: 1.5 })).toThrow()
    })
  })

  describe('CreateTranslateHistorySchema', () => {
    it('should accept valid dto', () => {
      const result = CreateTranslateHistorySchema.parse({
        sourceText: 'Hello',
        targetText: 'Bonjour',
        sourceLanguage: 'en-us',
        targetLanguage: 'fr-fr'
      })
      expect(result.sourceText).toBe('Hello')
    })

    it('should reject empty sourceText', () => {
      expect(() =>
        CreateTranslateHistorySchema.parse({
          sourceText: '',
          targetText: 'Bonjour',
          sourceLanguage: 'en-us',
          targetLanguage: 'fr-fr'
        })
      ).toThrow()
    })

    it('should reject missing required fields', () => {
      expect(() => CreateTranslateHistorySchema.parse({})).toThrow()
    })

    it('should reject invalid language code', () => {
      expect(() =>
        CreateTranslateHistorySchema.parse({
          sourceText: 'Hello',
          targetText: 'Bonjour',
          sourceLanguage: 'INVALID',
          targetLanguage: 'fr-fr'
        })
      ).toThrow()
    })
  })

  describe('UpdateTranslateHistorySchema', () => {
    it('should accept partial update', () => {
      const result = UpdateTranslateHistorySchema.parse({ star: true })
      expect(result.star).toBe(true)
    })

    it('should accept empty object', () => {
      expect(() => UpdateTranslateHistorySchema.parse({})).not.toThrow()
    })

    it('should reject empty string fields', () => {
      expect(() => UpdateTranslateHistorySchema.parse({ sourceText: '' })).toThrow()
    })

    it('should reject invalid language code', () => {
      expect(() => UpdateTranslateHistorySchema.parse({ sourceLanguage: 'NOT_VALID' })).toThrow()
    })
  })

  describe('CreateTranslateLanguageSchema', () => {
    it('should accept valid dto', () => {
      const result = CreateTranslateLanguageSchema.parse({
        langCode: 'ja-jp',
        value: 'Japanese',
        emoji: '\uD83C\uDDEF\uD83C\uDDF5'
      })
      expect(result.langCode).toBe('ja-jp')
    })

    it('should reject empty langCode', () => {
      expect(() =>
        CreateTranslateLanguageSchema.parse({ langCode: '', value: 'Test', emoji: '\uD83C\uDDEF\uD83C\uDDF5' })
      ).toThrow()
    })

    it('should reject invalid langCode format', () => {
      expect(() =>
        CreateTranslateLanguageSchema.parse({
          langCode: 'INVALID-CODE',
          value: 'Test',
          emoji: '\uD83C\uDDEF\uD83C\uDDF5'
        })
      ).toThrow()
    })

    it('should reject missing required fields', () => {
      expect(() => CreateTranslateLanguageSchema.parse({})).toThrow()
    })
  })

  describe('UpdateTranslateLanguageSchema', () => {
    it('should accept partial update', () => {
      const result = UpdateTranslateLanguageSchema.parse({ value: 'Updated' })
      expect(result.value).toBe('Updated')
    })

    it('should reject langCode (immutable)', () => {
      expect(() => UpdateTranslateLanguageSchema.parse({ langCode: 'ja-jp', value: 'Updated' })).toThrow()
    })

    it('should reject empty value', () => {
      expect(() => UpdateTranslateLanguageSchema.parse({ value: '' })).toThrow()
    })
  })
})

describe('Translate history handlers', () => {
  const dbh = setupTestDatabase()
  const collection = translateHandlers['/translate/histories']
  const record = translateHandlers['/translate/histories/:id']
  const list = collection.GET as (input: { query?: TranslateHistoryQueryParams }) => ReturnType<typeof collection.GET>
  const id = '019606a0-0000-7000-8000-000000000001'
  const body = {
    sourceText: 'Hello',
    targetText: 'Bonjour',
    sourceLanguage: null,
    targetLanguage: null
  }

  function seed() {
    dbh.db
      .insert(translateHistoryTable)
      .values({ id, ...body })
      .run()
  }

  it('defaults to active records and persists archive and restore through PATCH', async () => {
    seed()
    expect(await list({})).toMatchObject({ items: [{ id, archived: false }], total: 1 })
    expect(await list({ query: { archived: false } })).toMatchObject({ items: [{ id }], total: 1 })
    expect(await record.PATCH({ params: { id }, body: { archived: true } })).toMatchObject({ id, archived: true })
    expect(translateHistoryService.getById(id).archived).toBe(true)
    expect(await list({})).toMatchObject({ items: [], total: 0 })
    expect(await list({ query: { archived: true } })).toMatchObject({ items: [{ id }], total: 1 })
    expect(await record.GET({ params: { id } })).toMatchObject({ id, archived: true })
    expect(await record.PATCH({ params: { id }, body: { archived: false } })).toMatchObject({ id, archived: false })
    expect(translateHistoryService.getById(id).archived).toBe(false)
    expect(await list({ query: { archived: true } })).toMatchObject({ items: [], total: 0 })
    expect(await list({})).toMatchObject({ items: [{ id }], total: 1 })
  })

  it.each([['true'], ['false'], [0], [1], [null], [[]], [{}]])(
    'rejects non-boolean archive input %j at GET and PATCH',
    async (archived) => {
      seed()
      await expect(list({ query: { archived } as never })).rejects.toThrow(ZodError)
      await expect(record.PATCH({ params: { id }, body: { archived } as never })).rejects.toThrow(ZodError)
      expect(translateHistoryService.getById(id).archived).toBe(false)
    }
  )

  it('creates active records without accepting client-controlled archive membership', async () => {
    await expect(collection.POST({ body })).resolves.toMatchObject({ ...body, archived: false })
    expect(dbh.db.select().from(translateHistoryTable).all()).toEqual([expect.objectContaining({ archived: false })])
  })

  it.each([true, false])('rejects archived=%s on Create', async (archived) => {
    await expect(collection.POST({ body: { ...body, archived } as never })).rejects.toThrow(ZodError)
    expect(dbh.db.select().from(translateHistoryTable).all()).toEqual([])
  })

  it.each(['unknown', 'kind', 'id', 'createdAt', 'updatedAt', 'archivedAt', 'deletedAt', 'inTrash', 'fileEntryId'])(
    'rejects forbidden field %s without modifying the record',
    async (field) => {
      seed()
      const before = translateHistoryService.getById(id)
      await expect(list({ query: { [field]: 'value' } })).rejects.toThrow(ZodError)
      await expect(collection.POST({ body: { ...body, [field]: 'value' } })).rejects.toThrow(ZodError)
      await expect(record.PATCH({ params: { id }, body: { archived: true, [field]: 'value' } })).rejects.toThrow(
        ZodError
      )
      expect(translateHistoryService.getById(id)).toEqual(before)
    }
  )

  it.each([{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { search: '' }, { search: 'a'.repeat(201) }, { offset: 1 }])(
    'rejects invalid list query %j',
    async (query) => {
      await expect(list({ query })).rejects.toThrow(ZodError)
    }
  )
})
