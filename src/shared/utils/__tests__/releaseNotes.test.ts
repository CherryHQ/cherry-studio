import { describe, expect, it } from 'vitest'

import {
  hasMultiLanguageReleaseNotes,
  localizeReleaseNotes,
  mergeReleaseHistory,
  mergeReleaseNotes,
  parseReleaseHistory,
  validateCurrentReleaseHistory
} from '../releaseNotes'

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

  it('parses bundled stable release history without changing its order or bilingual notes', () => {
    expect(
      parseReleaseHistory(
        JSON.stringify([
          { releaseNotes, version: '2.0.1' },
          { releaseNotes, version: '2.0.0' }
        ])
      )
    ).toEqual([
      { releaseNotes, version: '2.0.1' },
      { releaseNotes, version: '2.0.0' }
    ])
  })

  it.each([
    ['invalid JSON', '{'],
    ['prerelease version', JSON.stringify([{ releaseNotes, version: '2.0.0-rc.1' }])],
    ['incomplete localization', JSON.stringify([{ releaseNotes: 'English only', version: '2.0.0' }])],
    [
      'duplicate version',
      JSON.stringify([
        { releaseNotes, version: '2.0.0' },
        { releaseNotes, version: '2.0.0' }
      ])
    ]
  ])('rejects %s in bundled history', (_case, source) => {
    expect(() => parseReleaseHistory(source)).toThrow('release-history.json')
  })

  it('keeps the current release first and removes its historical duplicate', () => {
    const current = { releaseNotes: 'Current', version: '2.0.1' }
    const history = [
      { releaseNotes: 'Stale current', version: '2.0.1' },
      { releaseNotes: 'Previous', version: '2.0.0' }
    ]

    expect(mergeReleaseNotes(current, history)).toEqual([current, { releaseNotes: 'Previous', version: '2.0.0' }])
  })

  it('merges remote and bundled history by version while preferring remote notes', () => {
    const remote = [
      { releaseNotes: 'Remote current', version: '2.0.2' },
      { releaseNotes: 'Remote previous', version: '2.0.1' }
    ]
    const bundled = [
      { releaseNotes: 'Bundled newer', version: '2.0.3' },
      { releaseNotes: 'Bundled stale current', version: '2.0.2' },
      { releaseNotes: 'Bundled oldest', version: '2.0.0' }
    ]

    expect(mergeReleaseHistory(remote, bundled)).toEqual([
      { releaseNotes: 'Bundled newer', version: '2.0.3' },
      { releaseNotes: 'Remote current', version: '2.0.2' },
      { releaseNotes: 'Remote previous', version: '2.0.1' },
      { releaseNotes: 'Bundled oldest', version: '2.0.0' }
    ])
  })

  it('accepts a stable current release whose bundled history notes match', () => {
    expect(() =>
      validateCurrentReleaseHistory({ releaseNotes, version: '2.0.2' }, [{ releaseNotes, version: '2.0.2' }])
    ).not.toThrow()
  })

  it('rejects a stable current release missing from bundled history', () => {
    expect(() => validateCurrentReleaseHistory({ releaseNotes, version: '2.0.2' }, [])).toThrow(
      'must contain current stable version 2.0.2'
    )
  })

  it('rejects bundled history notes that differ from the current stable release', () => {
    expect(() =>
      validateCurrentReleaseHistory({ releaseNotes, version: '2.0.2' }, [
        { releaseNotes: `${releaseNotes}\nChanged`, version: '2.0.2' }
      ])
    ).toThrow('must match electron-builder.yml')
  })

  it('does not require prereleases in stable release history', () => {
    expect(() => validateCurrentReleaseHistory({ releaseNotes, version: '2.0.3-rc.1' }, [])).not.toThrow()
  })
})
