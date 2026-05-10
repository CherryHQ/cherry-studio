import type { TranslateLanguage } from '@shared/data/types/translate'
import { describe, expect, it } from 'vitest'

import { pickBidirectionalTarget, shouldPersistDirectTarget } from '../translate'

const lang = (langCode: string, value: string): TranslateLanguage =>
  ({
    langCode,
    value,
    emoji: '🏳️',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }) as TranslateLanguage

const english = lang('en-us', 'English')
const chinese = lang('zh-cn', 'Chinese')
const japanese = lang('ja-jp', 'Japanese')

describe('translate bidirectional helpers', () => {
  describe('pickBidirectionalTarget', () => {
    it('uses the override target when one is provided', () => {
      expect(pickBidirectionalTarget('en-us', chinese, english, japanese)).toBe(japanese)
    })

    it('uses alter when detected source equals preferred', () => {
      expect(pickBidirectionalTarget('zh-cn', chinese, english)).toBe(english)
    })

    it('uses preferred when detected source equals alter', () => {
      expect(pickBidirectionalTarget('en-us', chinese, english)).toBe(chinese)
    })

    it('uses preferred when detected source is unknown', () => {
      expect(pickBidirectionalTarget('unknown', chinese, english)).toBe(chinese)
    })
  })

  describe('shouldPersistDirectTarget', () => {
    it('persists a direct target only when it differs from both saved slots', () => {
      expect(shouldPersistDirectTarget(japanese, chinese, english)).toBe(true)
      expect(shouldPersistDirectTarget(chinese, chinese, english)).toBe(false)
      expect(shouldPersistDirectTarget(english, chinese, english)).toBe(false)
    })
  })
})
