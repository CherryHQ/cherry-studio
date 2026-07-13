import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCmThemeByName, getCmThemeNames, getNormalizedExtension } from '../utils'

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

  it('should return language as-is when no rules matched', async () => {
    await expect(getNormalizedExtension('unknownLanguage')).resolves.toBe('unknownLanguage')
  })
})

describe('cm theme lazy boundary', () => {
  it('does not load @uiw/codemirror-themes-all until a theme API is called', async () => {
    vi.resetModules()
    const loaded = vi.fn()
    vi.doMock('@uiw/codemirror-themes-all', () => {
      loaded()
      return { dracula: [] }
    })

    try {
      const utils = await import('../utils')
      expect(loaded).not.toHaveBeenCalled()

      await expect(utils.getCmThemeByName('dracula')).resolves.toEqual([])
      expect(loaded).toHaveBeenCalledTimes(1)
    } finally {
      vi.doUnmock('@uiw/codemirror-themes-all')
      vi.resetModules()
    }
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
