import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCmThemeByName, getCmThemeNames, getNormalizedExtension, prepareCodeChanges } from '../utils'

describe('getNormalizedExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return custom mapping for custom language', async () => {
    await expect(getNormalizedExtension('svg')).resolves.toBe('xml')
    await expect(getNormalizedExtension('SVG')).resolves.toBe('xml')
  })

  it('should prefer custom mapping when both custom and linguist exist', async () => {
    await expect(getNormalizedExtension('svg')).resolves.toBe('xml')
  })

  it('should return linguist mapping when available (strip leading dot)', async () => {
    await expect(getNormalizedExtension('TypeScript')).resolves.toBe('ts')
  })

  it('should return extension when input already looks like extension (leading dot)', async () => {
    await expect(getNormalizedExtension('.json')).resolves.toBe('json')
  })

  it('should lowercase a language name used as its own extension so langs lookups hit', async () => {
    await expect(getNormalizedExtension('Markdown')).resolves.toBe('markdown')
    await expect(getNormalizedExtension('TSX')).resolves.toBe('tsx')
    await expect(getNormalizedExtension('unknownLanguage')).resolves.toBe('unknownlanguage')
  })
})

describe('prepareCodeChanges', () => {
  const applyChanges = (source: string, changes: ReturnType<typeof prepareCodeChanges>) =>
    changes.reduceRight(
      (content, { from, insert, to }) => `${content.slice(0, from)}${insert}${content.slice(to)}`,
      source
    )

  it.each([
    ['appended streaming text', 'const value = 1', 'const value = 10'],
    ['removed stale text', 'hello world', 'hello'],
    ['replaced multiple regions', 'abc-123-xyz', 'ABC-123-XYZ']
  ])('reconstructs %s without corrupting content', (_label, oldCode, newCode) => {
    expect(applyChanges(oldCode, prepareCodeChanges(oldCode, newCode))).toBe(newCode)
  })

  it('returns no dispatch changes for identical content', () => {
    expect(prepareCodeChanges('unchanged', 'unchanged')).toEqual([])
  })
})

describe('getCmThemeNames', () => {
  it('resolves base names plus themes-all entries, excluding settings and highlight styles', async () => {
    const names = await getCmThemeNames()

    expect(names).toEqual(expect.arrayContaining(['auto', 'light', 'dark', 'dracula']))
    expect(names.some((name) => name.startsWith('defaultSettings'))).toBe(false)
    expect(names.some((name) => name.endsWith('Style'))).toBe(false)
  })
})

describe('getCmThemeByName', () => {
  it('resolves the themes-all extension for a known theme name', async () => {
    const theme = await getCmThemeByName('dracula')

    expect(theme).not.toBe('light')
    expect(typeof theme).toBe('object')
  })

  it('resolves basic string themes as-is', async () => {
    await expect(getCmThemeByName('light')).resolves.toBe('light')
    await expect(getCmThemeByName('dark')).resolves.toBe('dark')
    await expect(getCmThemeByName('none')).resolves.toBe('none')
  })

  it('falls back to light for unknown theme names', async () => {
    await expect(getCmThemeByName('unknown-theme-name')).resolves.toBe('light')
  })
})
