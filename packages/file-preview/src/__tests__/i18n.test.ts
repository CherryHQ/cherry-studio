import { describe, expect, it } from 'vitest'

import { createPreviewI18n } from '../i18n'

describe('preview translations', () => {
  it('keeps simultaneous preview languages independent', async () => {
    const english = createPreviewI18n('en-us')
    const chinese = createPreviewI18n('zh-cn')
    expect(english.t('file_preview.load_error.title')).toBe('Preview failed')
    expect(chinese.t('file_preview.load_error.title')).toBe('预览失败')
    await english.changeLanguage('zh-cn')
    await chinese.changeLanguage('en-us')
    expect(english.t('file_preview.load_error.title')).toBe('预览失败')
    expect(chinese.t('file_preview.load_error.title')).toBe('Preview failed')
  })

  it('translates every desktop language, matching host codes case-insensitively', () => {
    expect(createPreviewI18n('ja-JP').t('file_preview.load_error.title')).toBe('プレビューに失敗しました')
    expect(createPreviewI18n('zh-TW').t('file_preview.load_error.title')).not.toBe('Preview failed')
  })

  it('falls back to packaged English for an unsupported host language', () => {
    expect(createPreviewI18n('xx-yy').t('file_preview.load_error.title')).toBe('Preview failed')
  })
})
