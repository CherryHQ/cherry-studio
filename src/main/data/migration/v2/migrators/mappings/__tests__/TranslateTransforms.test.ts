import { describe, expect, it } from 'vitest'

import { copyTargetLanguageForMiniWindow, splitBidirectionalPairForAction } from '../TranslateTransforms'

describe('splitBidirectionalPairForAction', () => {
  it('should split a valid pair into preferred and alter languages', () => {
    const result = splitBidirectionalPairForAction({ bidirectionalPair: ['zh-cn', 'en-us'] })
    expect(result).toEqual({
      'feature.translate.action.preferred_lang': 'zh-cn',
      'feature.translate.action.alter_lang': 'en-us'
    })
  })

  it('should return empty object when pair is undefined', () => {
    expect(splitBidirectionalPairForAction({})).toEqual({})
    expect(splitBidirectionalPairForAction({ bidirectionalPair: undefined })).toEqual({})
  })

  it('should return empty object when pair is not an array', () => {
    expect(splitBidirectionalPairForAction({ bidirectionalPair: 'zh-cn' })).toEqual({})
    expect(splitBidirectionalPairForAction({ bidirectionalPair: 42 })).toEqual({})
  })

  it('should return empty object when pair has fewer than 2 elements', () => {
    expect(splitBidirectionalPairForAction({ bidirectionalPair: [] })).toEqual({})
    expect(splitBidirectionalPairForAction({ bidirectionalPair: ['zh-cn'] })).toEqual({})
  })

  it('should return empty object when pair contains non-string elements', () => {
    expect(splitBidirectionalPairForAction({ bidirectionalPair: [123, 456] })).toEqual({})
    expect(splitBidirectionalPairForAction({ bidirectionalPair: [null, 'en-us'] })).toEqual({})
  })

  it('normalizes uppercase input to lowercase so "EN-US" becomes "en-us"', () => {
    expect(splitBidirectionalPairForAction({ bidirectionalPair: ['EN-US', 'ZH-CN'] })).toEqual({
      'feature.translate.action.preferred_lang': 'en-us',
      'feature.translate.action.alter_lang': 'zh-cn'
    })
  })

  it('returns empty object when a string element fails the TranslateLangCode regex', () => {
    // Historical dexie data sometimes carries non-conformant values like underscores
    // or freeform labels; schema validation must block them from reaching the new preference.
    expect(splitBidirectionalPairForAction({ bidirectionalPair: ['zh_CN', 'en-us'] })).toEqual({})
    expect(splitBidirectionalPairForAction({ bidirectionalPair: ['Auto', 'en-us'] })).toEqual({})
    expect(splitBidirectionalPairForAction({ bidirectionalPair: ['en-us', 'NOT-A-CODE-X'] })).toEqual({})
  })

  it('rejects the "unknown" sentinel (PersistedLangCodeSchema is strict)', () => {
    expect(splitBidirectionalPairForAction({ bidirectionalPair: ['unknown', 'en-us'] })).toEqual({})
  })
})

describe('copyTargetLanguageForMiniWindow', () => {
  it('should copy a valid language code', () => {
    const result = copyTargetLanguageForMiniWindow({ targetLanguage: 'en-us' })
    expect(result).toEqual({
      'feature.translate.mini_window.target_lang': 'en-us'
    })
  })

  it('should return empty object when targetLanguage is undefined', () => {
    expect(copyTargetLanguageForMiniWindow({})).toEqual({})
    expect(copyTargetLanguageForMiniWindow({ targetLanguage: undefined })).toEqual({})
  })

  it('should return empty object when targetLanguage is not a string', () => {
    expect(copyTargetLanguageForMiniWindow({ targetLanguage: 42 })).toEqual({})
    expect(copyTargetLanguageForMiniWindow({ targetLanguage: null })).toEqual({})
  })

  it('should return empty object when targetLanguage is an empty string', () => {
    expect(copyTargetLanguageForMiniWindow({ targetLanguage: '' })).toEqual({})
  })

  it('normalizes uppercase input to lowercase so "EN-US" becomes "en-us"', () => {
    expect(copyTargetLanguageForMiniWindow({ targetLanguage: 'EN-US' })).toEqual({
      'feature.translate.mini_window.target_lang': 'en-us'
    })
  })

  it('returns empty object when the string fails the TranslateLangCode regex', () => {
    expect(copyTargetLanguageForMiniWindow({ targetLanguage: 'zh_CN' })).toEqual({})
    expect(copyTargetLanguageForMiniWindow({ targetLanguage: 'Auto' })).toEqual({})
    expect(copyTargetLanguageForMiniWindow({ targetLanguage: 'NOT-A-CODE-X' })).toEqual({})
  })

  it('rejects the "unknown" sentinel (PersistedLangCodeSchema is strict)', () => {
    expect(copyTargetLanguageForMiniWindow({ targetLanguage: 'unknown' })).toEqual({})
  })
})
