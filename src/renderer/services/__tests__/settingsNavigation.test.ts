// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

const { ipcRequestMock } = vi.hoisted(() => ({
  ipcRequestMock: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: ipcRequestMock
  }
}))

import { OPEN_SETTINGS_TAB_EVENT, openSettingsTab, type OpenSettingsTabEvent } from '../settingsNavigation'

describe('openSettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcRequestMock.mockResolvedValue(undefined)
    Reflect.deleteProperty(window, 'navigate')
  })

  it('dispatches a cancelable settings tab event and preserves query strings', () => {
    const handler = vi.fn((event: Event) => event.preventDefault())
    window.addEventListener(OPEN_SETTINGS_TAB_EVENT, handler)

    openSettingsTab('/settings/provider?id=openai')

    expect(handler).toHaveBeenCalledTimes(1)
    const event = handler.mock.calls[0][0] as OpenSettingsTabEvent
    expect(event.detail).toEqual({ path: '/settings/provider?id=openai' })

    window.removeEventListener(OPEN_SETTINGS_TAB_EVENT, handler)
  })

  it('requests main-window settings navigation when the settings tab event is unhandled', () => {
    const navigate = vi.fn()
    window.navigate = navigate as never

    openSettingsTab('/settings/mcp/servers')

    expect(ipcRequestMock).toHaveBeenCalledWith('navigation.open_settings', { path: '/settings/mcp/servers' })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('normalizes invalid paths to the default settings page', () => {
    const handler = vi.fn((event: Event) => event.preventDefault())
    window.addEventListener(OPEN_SETTINGS_TAB_EVENT, handler)

    openSettingsTab('/agents' as never)

    const event = handler.mock.calls[0][0] as OpenSettingsTabEvent
    expect(event.detail).toEqual({ path: '/settings/provider' })

    window.removeEventListener(OPEN_SETTINGS_TAB_EVENT, handler)
  })
})
