import { describe, expect, it } from 'vitest'

import { readsInLanguage } from '../languageScript'

describe('readsInLanguage', () => {
  it('accepts text in the UI script and rejects English under a non-Latin UI', () => {
    expect(readsInLanguage('磁盘已满', 'zh-CN')).toBe(true)
    expect(readsInLanguage('ENOSPC: no space left on device', 'zh-CN')).toBe(false)
    expect(readsInLanguage('ディスクがいっぱいです', 'ja-JP')).toBe(true)
    expect(readsInLanguage('Диск заполнен', 'ru-RU')).toBe(true)
    expect(readsInLanguage('Disk full', 'ru-RU')).toBe(false)
  })

  it('accepts Latin text only for English and never a non-Latin cause under English', () => {
    expect(readsInLanguage('Disk full', 'en-US')).toBe(true)
    expect(readsInLanguage('磁盘已满', 'en-US')).toBe(false)
    expect(readsInLanguage('Disk full', 'de-DE')).toBe(false)
  })
})
