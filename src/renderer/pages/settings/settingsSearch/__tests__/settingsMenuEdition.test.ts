import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

describe('settings menu edition', () => {
  it.each([
    { edition: 'global', hasProfile: true },
    { edition: 'cn', hasProfile: false }
  ])('shows personal information only in the $edition edition', async ({ edition, hasProfile }) => {
    vi.resetModules()
    vi.stubGlobal('__APP_EDITION__', edition)

    const { settingsMenu } = await import('@renderer/components/settingsMenu')

    expect(settingsMenu.some(({ route }) => route === '/settings/profile')).toBe(hasProfile)
  })
})
