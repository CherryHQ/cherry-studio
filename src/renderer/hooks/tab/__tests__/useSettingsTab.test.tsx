// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  setActiveTab: vi.fn(),
  updateTab: vi.fn(),
  tabs: [] as Array<{ id: string; type: 'route' | 'miniapp'; url: string; title: string }>,
  ipcHandlers: new Map<string, (payload: { path: string }) => void>()
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/ipc/useIpcOn', () => ({
  useIpcOn: (event: string, handler: (payload: { path: string }) => void) => {
    mocks.ipcHandlers.set(event, handler)
  }
}))

vi.mock('../useTabs', () => ({
  useTabs: () => ({
    tabs: mocks.tabs,
    openTab: mocks.openTab,
    setActiveTab: mocks.setActiveTab,
    updateTab: mocks.updateTab
  })
}))

import { OPEN_SETTINGS_TAB_EVENT } from '@renderer/services/settingsNavigation'

import { useMainSettingsTab } from '../useSettingsTab'

function MainSettingsTabBridgeHarness() {
  useMainSettingsTab()
  return null
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.tabs = []
  mocks.ipcHandlers.clear()
})

describe('useMainSettingsTab', () => {
  it('opens a settings tab for renderer settings-tab events', () => {
    render(<MainSettingsTabBridgeHarness />)

    const event = new CustomEvent(OPEN_SETTINGS_TAB_EVENT, {
      cancelable: true,
      detail: { path: '/settings/provider?id=openai' }
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(mocks.openTab).toHaveBeenCalledWith('/settings/provider?id=openai', { title: 'settings.title' })
  })

  it('reuses the existing settings tab for another settings path', () => {
    mocks.tabs = [{ id: 'settings-1', type: 'route', url: '/settings/provider', title: 'settings.title' }]
    render(<MainSettingsTabBridgeHarness />)

    window.dispatchEvent(
      new CustomEvent(OPEN_SETTINGS_TAB_EVENT, {
        cancelable: true,
        detail: { path: '/settings/about' }
      })
    )

    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(mocks.updateTab).toHaveBeenCalledWith('settings-1', {
      url: '/settings/about',
      title: 'settings.title',
      lastAccessTime: expect.any(Number)
    })
    expect(mocks.setActiveTab).toHaveBeenCalledWith('settings-1')
  })

  it('does not create duplicate settings tabs for consecutive open requests before tabs refresh', () => {
    mocks.openTab.mockReturnValue('settings-1')
    const { rerender } = render(<MainSettingsTabBridgeHarness />)

    window.dispatchEvent(
      new CustomEvent(OPEN_SETTINGS_TAB_EVENT, {
        cancelable: true,
        detail: { path: '/settings/provider' }
      })
    )
    window.dispatchEvent(
      new CustomEvent(OPEN_SETTINGS_TAB_EVENT, {
        cancelable: true,
        detail: { path: '/settings/about' }
      })
    )

    expect(mocks.openTab).toHaveBeenCalledTimes(1)
    expect(mocks.openTab).toHaveBeenCalledWith('/settings/provider', { title: 'settings.title' })

    mocks.tabs = [{ id: 'settings-1', type: 'route', url: '/settings/provider', title: 'settings.title' }]
    rerender(<MainSettingsTabBridgeHarness />)

    expect(mocks.updateTab).toHaveBeenCalledWith('settings-1', {
      url: '/settings/about',
      title: 'settings.title',
      lastAccessTime: expect.any(Number)
    })
    expect(mocks.setActiveTab).toHaveBeenCalledWith('settings-1')
  })

  it('subscribes main-window settings navigation to the IpcApi event', () => {
    render(<MainSettingsTabBridgeHarness />)

    mocks.ipcHandlers.get('navigation.open_settings')?.({ path: '/settings/about' })

    expect(mocks.openTab).toHaveBeenCalledWith('/settings/about', { title: 'settings.title' })
  })

  it('normalizes invalid event paths before opening the tab', () => {
    render(<MainSettingsTabBridgeHarness />)

    window.dispatchEvent(
      new CustomEvent(OPEN_SETTINGS_TAB_EVENT, {
        cancelable: true,
        detail: { path: '/agents' }
      })
    )

    expect(mocks.openTab).toHaveBeenCalledWith('/settings/provider', { title: 'settings.title' })
  })
})
