import { describe, expect, it } from 'vitest'

import { getAppLocaleDefinition, getLanguageDirection, resolveAppLanguage } from '../languages'

describe('app language resolution', () => {
  it('normalizes exact locale casing and separators', () => {
    expect(resolveAppLanguage('AR_ye')).toBe('ar-YE')
  })

  it('maps another Arabic region to the supported Arabic locale', () => {
    expect(resolveAppLanguage('ar-SA')).toBe('ar-YE')
  })

  it('distinguishes simplified and traditional Chinese aliases', () => {
    expect(resolveAppLanguage('zh-Hans')).toBe('zh-CN')
    expect(resolveAppLanguage('zh-SG')).toBe('zh-CN')
    expect(resolveAppLanguage('zh-Hant')).toBe('zh-TW')
    expect(resolveAppLanguage('zh-HK')).toBe('zh-TW')
  })

  it('falls back for unsupported languages', () => {
    expect(resolveAppLanguage('ko-KR')).toBe('en-US')
  })

  it('exposes reading direction for supported locales', () => {
    expect(getLanguageDirection('ar-YE')).toBe('rtl')
    expect(getLanguageDirection('en-US')).toBe('ltr')
  })

  it('keeps the translation resource id separate from the HTML language tag', () => {
    expect(getAppLocaleDefinition('ar-YE')).toMatchObject({
      htmlLanguage: 'ar',
      direction: 'rtl'
    })
  })
})
