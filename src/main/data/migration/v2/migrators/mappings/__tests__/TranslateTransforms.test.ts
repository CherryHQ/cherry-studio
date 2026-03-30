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
})
