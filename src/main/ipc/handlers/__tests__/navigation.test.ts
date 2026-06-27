import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openSettingsInMainWindowMock } = vi.hoisted(() => ({
  openSettingsInMainWindowMock: vi.fn()
}))

vi.mock('@main/services/settingsNavigation', () => ({
  openSettingsInMainWindow: openSettingsInMainWindowMock
}))

import { navigationHandlers } from '../navigation'

beforeEach(() => {
  vi.clearAllMocks()
})

const ctx = { senderId: 'w1' }

describe('navigationHandlers', () => {
  it('opens settings in the main window', async () => {
    await navigationHandlers['navigation.open_settings']({ path: '/settings/mcp/servers' }, ctx)

    expect(openSettingsInMainWindowMock).toHaveBeenCalledWith('/settings/mcp/servers')
  })

  it('normalizes invalid settings paths before opening', async () => {
    await navigationHandlers['navigation.open_settings']({ path: '/agents' }, ctx)

    expect(openSettingsInMainWindowMock).toHaveBeenCalledWith('/settings/provider')
  })
})
