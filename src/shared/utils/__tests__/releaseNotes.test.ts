import { describe, expect, it } from 'vitest'

import { hasMultiLanguageReleaseNotes, localizeReleaseNotes } from '../releaseNotes'

const releaseNotes = `<!--LANG:en-->
New features
- English item
<!--LANG:zh-CN-->
新功能
- 中文项目
<!--LANG:END-->`

describe('releaseNotes', () => {
  it.each(['zh-CN', 'zh-TW'])('returns Chinese notes for %s', (language) => {
    expect(localizeReleaseNotes(releaseNotes, language)).toBe('新功能\n- 中文项目')
  })

  it.each(['en-US', 'ja-JP', null])('returns English notes for %s', (language) => {
    expect(localizeReleaseNotes(releaseNotes, language)).toBe('New features\n- English item')
  })

  it('leaves unmarked release notes unchanged', () => {
    expect(localizeReleaseNotes('Simple release notes', 'zh-CN')).toBe('Simple release notes')
    expect(hasMultiLanguageReleaseNotes('Simple release notes')).toBe(false)
  })

  it('removes markers when a marked document is incomplete', () => {
    expect(localizeReleaseNotes('<!--LANG:en-->English only', 'zh-CN')).toBe('English only')
  })
})
