import {
  CreateTranslateHistorySchema,
  CreateTranslateLanguageSchema,
  TranslateHistoryQuerySchema,
  UpdateTranslateHistorySchema,
  UpdateTranslateLanguageSchema
} from '@shared/data/api/schemas/translate'
import { describe, expect, it } from 'vitest'

describe('Translate handler validation (Zod schemas)', () => {
  describe('TranslateHistoryQuerySchema', () => {
    it('should accept empty query', () => {
      expect(() => TranslateHistoryQuerySchema.parse({})).not.toThrow()
    })

    it('should accept valid query', () => {
      const result = TranslateHistoryQuerySchema.parse({ page: 1, limit: 20, star: true, search: 'hello' })
      expect(result.page).toBe(1)
      expect(result.star).toBe(true)
    })

    it('should reject negative page', () => {
      expect(() => TranslateHistoryQuerySchema.parse({ page: -1 })).toThrow()
    })

    it('should reject limit over 100', () => {
      expect(() => TranslateHistoryQuerySchema.parse({ limit: 101 })).toThrow()
    })

    it('should reject non-integer page', () => {
      expect(() => TranslateHistoryQuerySchema.parse({ page: 1.5 })).toThrow()
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
