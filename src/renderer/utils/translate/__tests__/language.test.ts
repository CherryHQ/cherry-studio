import { describe, expect, it } from 'vitest'

import type { TranslateBidirectionalPair } from '@shared/data/preference/preferenceTypes'
import { BUILTIN_LANGUAGE } from '@shared/data/presets/translateLanguages'

import { determineTargetLanguage, pickBidirectionalTarget } from '../language'

const english = BUILTIN_LANGUAGE.enUS.langCode
const chinese = BUILTIN_LANGUAGE.zhCN.langCode
const japanese = BUILTIN_LANGUAGE.jaJP.langCode
const bidirectionalPair = ['en-us', 'zh-cn'] satisfies TranslateBidirectionalPair

describe('translate bidirectional helpers', () => {
  describe('pickBidirectionalTarget', () => {
    it.each([
      ['uses the override target when one is provided', 'en-us', japanese, japanese],
      ['uses alter when detected source equals preferred', 'zh-cn', undefined, english],
      ['uses preferred when detected source equals alter', 'en-us', undefined, chinese],
      ['uses preferred when detected source is unknown', 'unknown', undefined, chinese]
    ] as const)('%s', (_name, sourceLanguage, overrideTarget, expectedTarget) => {
      expect(pickBidirectionalTarget(sourceLanguage, chinese, english, overrideTarget)).toBe(expectedTarget)
    })
  })

  describe('determineTargetLanguage', () => {
    it.each([
      ['uses the selected target in direct mode', 'zh-cn', 'ja-jp', false, { success: true, language: 'ja-jp' }],
      [
        'rejects the same language in direct mode',
        'en-us',
        'en-us',
        false,
        { success: false, errorType: 'same_language' }
      ],
      ['maps the first pair member to the second', 'en-us', 'ja-jp', true, { success: true, language: 'zh-cn' }],
      ['maps the second pair member to the first', 'zh-cn', 'ja-jp', true, { success: true, language: 'en-us' }],
      [
        'rejects a detected language outside the pair',
        'ja-jp',
        'en-us',
        true,
        { success: false, errorType: 'not_in_pair' }
      ]
    ] as const)('%s', (_name, sourceLanguage, targetLanguage, isBidirectional, expected) => {
      expect(determineTargetLanguage(sourceLanguage, targetLanguage, isBidirectional, bidirectionalPair)).toEqual(
        expected
      )
    })
  })
})
