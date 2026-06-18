import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setDocumentDirection } from '../index'

describe('RTL Detection', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.spyOn(document.documentElement, 'setAttribute').mockClear()
  })

  it('should set RTL direction for Arabic language', () => {
    setDocumentDirection('ar-YE')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('dir', 'rtl')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('lang', 'ar-YE')
  })

  it('should set RTL direction for Arabic without region', () => {
    setDocumentDirection('ar')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('dir', 'rtl')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('lang', 'ar')
  })

  it('should set RTL direction for Persian', () => {
    setDocumentDirection('fa')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('dir', 'rtl')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('lang', 'fa')
  })

  it('should set RTL direction for Hebrew', () => {
    setDocumentDirection('he')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('dir', 'rtl')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('lang', 'he')
  })

  it('should set RTL direction for Urdu', () => {
    setDocumentDirection('ur')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('dir', 'rtl')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('lang', 'ur')
  })

  it('should set LTR direction for English', () => {
    setDocumentDirection('en-US')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('dir', 'ltr')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('lang', 'en-US')
  })

  it('should set LTR direction for Chinese', () => {
    setDocumentDirection('zh-CN')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('dir', 'ltr')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('lang', 'zh-CN')
  })

  it('should set LTR direction for Japanese', () => {
    setDocumentDirection('ja-JP')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('dir', 'ltr')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('lang', 'ja-JP')
  })

  it('should handle unknown languages as LTR by default', () => {
    setDocumentDirection('unknown')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('dir', 'ltr')
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('lang', 'unknown')
  })
})
