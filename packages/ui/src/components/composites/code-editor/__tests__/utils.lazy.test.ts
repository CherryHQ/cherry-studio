import { describe, expect, it, vi } from 'vitest'

const cmThemeCatalogEvaluated = vi.hoisted(() => vi.fn())

vi.mock('@uiw/codemirror-themes-all', () => {
  cmThemeCatalogEvaluated()
  return { dracula: [] }
})

describe('cm theme lazy boundary', () => {
  it.each(['light', 'dark', 'none'] as const)(
    'does not load the theme catalog for the built-in %s theme',
    async (name) => {
      const utils = await import('../utils')

      await expect(utils.getCmThemeByName(name)).resolves.toBe(name)
      expect(cmThemeCatalogEvaluated).not.toHaveBeenCalled()
    }
  )

  it('loads the theme catalog for a named theme', async () => {
    const utils = await import('../utils')

    await expect(utils.getCmThemeByName('dracula')).resolves.toEqual([])
    expect(cmThemeCatalogEvaluated).toHaveBeenCalledTimes(1)
  })
})
