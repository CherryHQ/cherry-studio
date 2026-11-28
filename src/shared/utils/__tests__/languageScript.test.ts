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

describe('readsInLanguage beyond the original scripts', () => {
  it('keeps a Korean message under a Korean UI', () => {
    expect(readsInLanguage('SKILL.md 파일이 없습니다', 'ko-KR')).toBe(true)
    expect(readsInLanguage('SKILL.md not found', 'ko-KR')).toBe(false)
  })

  it('rejects any non-Latin letter script under English while allowing punctuation and identifiers', () => {
    expect(readsInLanguage('फ़ाइल नहीं मिली', 'en-US')).toBe(false)
    expect(readsInLanguage('ملف غير موجود', 'en-US')).toBe(false)
    expect(readsInLanguage('ENOENT: open "/tmp/a_b-1.json" (errno -2) — 50%', 'en-US')).toBe(true)
  })
})
