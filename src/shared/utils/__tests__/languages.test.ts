import { describe, expect, it } from 'vitest'

import { getLanguageDirection, resolveAppLanguage } from '../languages'

describe('app language resolution', () => {
  it('normalizes exact locale casing and separators', () => {
    expect(resolveAppLanguage('AR_ye')).toBe('ar-YE')
  })

  it('maps another Arabic region to the supported Arabic locale', () => {
    expect(resolveAppLanguage('ar-SA')).toBe('ar-YE')
  })

  it('falls back for unsupported languages', () => {
    expect(resolveAppLanguage('ko-KR')).toBe('en-US')
  })

  it('exposes reading direction for supported locales', () => {
    expect(getLanguageDirection('ar-YE')).toBe('rtl')
    expect(getLanguageDirection('en-US')).toBe('ltr')
  })
})
