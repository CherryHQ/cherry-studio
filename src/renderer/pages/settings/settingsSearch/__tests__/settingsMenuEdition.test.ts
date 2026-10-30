import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

describe('settings menu edition', () => {
  it.each(['global', 'cn'])('shows personal information in the %s edition', async (edition) => {
    vi.resetModules()
    vi.stubGlobal('__APP_EDITION__', edition)

    const { settingsMenu } = await import('@renderer/components/settingsMenu')

    expect(settingsMenu.some(({ route }) => route === '/settings/profile')).toBe(true)
  })
})
