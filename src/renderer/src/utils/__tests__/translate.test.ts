import type { TranslateBidirectionalPair, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import { determineTargetLanguage, getTargetLanguageForBidirectional, languageDtoToVo } from '../translate'

describe('languageDtoToVo', () => {
  it('should pick only value, langCode, and emoji from the DTO', () => {
    const dto = {
      langCode: 'en-us' as TranslateLangCode,
      value: 'English',
      emoji: '🇺🇸',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    }
    const vo = languageDtoToVo(dto)
    expect(vo).toEqual({ langCode: 'en-us', value: 'English', emoji: '🇺🇸' })
    expect(vo).not.toHaveProperty('createdAt')
    expect(vo).not.toHaveProperty('updatedAt')
  })
})

describe('getTargetLanguageForBidirectional', () => {
  const pair: TranslateBidirectionalPair = ['en-us' as TranslateLangCode, 'zh-cn' as TranslateLangCode]

  it('should return second language when source matches first', () => {
    expect(getTargetLanguageForBidirectional('en-us' as TranslateLangCode, pair)).toBe('zh-cn')
  })

  it('should return first language when source matches second', () => {
    expect(getTargetLanguageForBidirectional('zh-cn' as TranslateLangCode, pair)).toBe('en-us')
  })

  it('should return first language when source matches neither', () => {
    expect(getTargetLanguageForBidirectional('ja-jp' as TranslateLangCode, pair)).toBe('en-us')
  })
})

describe('determineTargetLanguage', () => {
  const pair: TranslateBidirectionalPair = ['en-us' as TranslateLangCode, 'zh-cn' as TranslateLangCode]

  describe('bidirectional mode', () => {
    it('should return the other language from the pair', () => {
      const result = determineTargetLanguage('en-us' as TranslateLangCode, 'zh-cn' as TranslateLangCode, true, pair)
      expect(result).toEqual({ success: true, language: 'zh-cn' })
    })

    it('should return the first language when source is the second', () => {
      const result = determineTargetLanguage('zh-cn' as TranslateLangCode, 'en-us' as TranslateLangCode, true, pair)
      expect(result).toEqual({ success: true, language: 'en-us' })
    })

    it('should return not_in_pair when source is not in the pair', () => {
      const result = determineTargetLanguage('ja-jp' as TranslateLangCode, 'zh-cn' as TranslateLangCode, true, pair)
      expect(result).toEqual({ success: false, errorType: 'not_in_pair' })
    })
  })

  describe('non-bidirectional mode', () => {
    it('should return the target language when different from source', () => {
      const result = determineTargetLanguage('en-us' as TranslateLangCode, 'zh-cn' as TranslateLangCode, false, pair)
      expect(result).toEqual({ success: true, language: 'zh-cn' })
    })

    it('should return same_language when source equals target', () => {
      const result = determineTargetLanguage('en-us' as TranslateLangCode, 'en-us' as TranslateLangCode, false, pair)
      expect(result).toEqual({ success: false, errorType: 'same_language' })
    })
  })
})
