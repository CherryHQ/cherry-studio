import { describe, expect, it } from 'vitest'

import {
  CreateTranslateHistorySchema,
  CreateTranslateLanguageSchema,
  UpdateTranslateHistorySchema
} from '../data/api/schemas/translate'
import { PersistedLangCodeSchema, TranslateLangCodeSchema } from '../data/preference/preferenceTypes'

describe('PersistedLangCodeSchema', () => {
  it.each(['en-us', 'zh-cn', 'ja', 'ja-jp', 'zh-tw', 'fr-fr'])('accepts %s', (code) => {
    expect(PersistedLangCodeSchema.safeParse(code).success).toBe(true)
  })

  it('rejects the "unknown" UI sentinel so it cannot leak into the DB', () => {
    expect(PersistedLangCodeSchema.safeParse('unknown').success).toBe(false)
  })

  it.each(['', 'EN-US', 'NOT-A-CODE', 'a', 'toolong-toolong-toolong', 'zh_cn'])('rejects %s', (bad) => {
    expect(PersistedLangCodeSchema.safeParse(bad).success).toBe(false)
  })
})

describe('TranslateLangCodeSchema (permissive, UI/detection)', () => {
  it('accepts the "unknown" UI sentinel', () => {
    expect(TranslateLangCodeSchema.safeParse('unknown').success).toBe(true)
  })

  it('accepts real lang codes via the widened union', () => {
    expect(TranslateLangCodeSchema.safeParse('en-us').success).toBe(true)
  })

  it('still rejects malformed values', () => {
    expect(TranslateLangCodeSchema.safeParse('NOT-A-CODE').success).toBe(false)
  })
})

describe('Translate API DTOs reject the "unknown" sentinel at the persistence boundary', () => {
  const baseHistory = { sourceText: 'Hello', targetText: '你好' }

  it('CreateTranslateHistorySchema rejects unknown sourceLanguage', () => {
    expect(
      CreateTranslateHistorySchema.safeParse({
        ...baseHistory,
        sourceLanguage: 'unknown',
        targetLanguage: 'zh-cn'
      }).success
    ).toBe(false)
  })

  it('CreateTranslateHistorySchema rejects unknown targetLanguage', () => {
    expect(
      CreateTranslateHistorySchema.safeParse({
        ...baseHistory,
        sourceLanguage: 'en-us',
        targetLanguage: 'unknown'
      }).success
    ).toBe(false)
  })

  it('CreateTranslateHistorySchema accepts a pair of real codes', () => {
    expect(
      CreateTranslateHistorySchema.safeParse({
        ...baseHistory,
        sourceLanguage: 'en-us',
        targetLanguage: 'zh-cn'
      }).success
    ).toBe(true)
  })

  it('UpdateTranslateHistorySchema rejects unknown sourceLanguage even when optional', () => {
    expect(UpdateTranslateHistorySchema.safeParse({ sourceLanguage: 'unknown' }).success).toBe(false)
  })

  it('UpdateTranslateHistorySchema rejects unknown fields like id/createdAt (strict)', () => {
    expect(UpdateTranslateHistorySchema.safeParse({ id: 'hist_1', star: true }).success).toBe(false)
    expect(UpdateTranslateHistorySchema.safeParse({ createdAt: '2026-01-01', star: true }).success).toBe(false)
  })

  it('UpdateTranslateHistorySchema accepts an empty patch', () => {
    expect(UpdateTranslateHistorySchema.safeParse({}).success).toBe(true)
  })

  it('CreateTranslateLanguageSchema rejects unknown langCode', () => {
    expect(CreateTranslateLanguageSchema.safeParse({ langCode: 'unknown', value: 'Unknown', emoji: '🏳️' }).success).toBe(
      false
    )
  })

  it('CreateTranslateLanguageSchema accepts a real langCode', () => {
    expect(CreateTranslateLanguageSchema.safeParse({ langCode: 'xx-yy', value: 'Custom', emoji: '🌐' }).success).toBe(
      true
    )
  })
})
