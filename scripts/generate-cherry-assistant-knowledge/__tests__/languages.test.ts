import { describe, expect, it } from 'vitest'

import { generateLanguagesFragment } from '../generators/languages'

describe('generateLanguagesFragment', () => {
  it('reports a non-zero locale count matching the i18n directory', () => {
    const { count } = generateLanguagesFragment('zh-CN')
    expect(count).toBeGreaterThan(0)
  })

  it('renders zh-CN with the canonical Chinese display names', () => {
    const { summary } = generateLanguagesFragment('zh-CN')
    expect(summary).toContain('英')
    expect(summary).toContain('简中')
    expect(summary).toContain('繁中')
  })

  it('renders en-US with English display names', () => {
    const { summary } = generateLanguagesFragment('en-US')
    expect(summary).toContain('English')
    expect(summary).toContain('Simplified Chinese')
    expect(summary).toContain('Traditional Chinese')
  })

  it('keeps count consistent across languages', () => {
    const zh = generateLanguagesFragment('zh-CN')
    const en = generateLanguagesFragment('en-US')
    expect(zh.count).toBe(en.count)
  })
})
