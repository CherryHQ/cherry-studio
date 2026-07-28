// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  setActiveTab: vi.fn(),
  updateTab: vi.fn(),
  tabs: [] as Array<{ id: string; type: 'route' | 'miniapp'; url: string; title: string }>,
  initData: null as { kind: 'navigation'; to: string; requestId: number } | null,
  ipcListeners: new Map<string, (payload: unknown) => void>()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() },
  useIpcOn: (event: string, handler: (payload: unknown) => void) => {
    mocks.ipcListeners.set(event, handler)
  }
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/hooks/useWindowInitData', () => ({
  useWindowInitData: () => mocks.initData
}))

vi.mock('../useTabs', () => ({
  useTabs: () => ({
    tabs: mocks.tabs,
    openTab: mocks.openTab,
    setActiveTab: mocks.setActiveTab,
    updateTab: mocks.updateTab
  })
}))

import { OPEN_MAIN_ROUTE_EVENT } from '@renderer/services/mainWindowNavigation'

import { useMainWindowNavigation } from '../useMainWindowNavigation'

function MainWindowNavigationHarness() {
  useMainWindowNavigation()
  return null
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.tabs = []
  mocks.initData = null
  mocks.ipcListeners.clear()
})

describe('useMainWindowNavigation', () => {
  it('opens a settings tab for renderer settings-tab events', () => {
    render(<MainWindowNavigationHarness />)

    const event = new CustomEvent(OPEN_MAIN_ROUTE_EVENT, {
      cancelable: true,
      detail: { path: '/settings/provider?id=openai' }
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(mocks.openTab).toHaveBeenCalledWith('/settings/provider?id=openai', { title: 'settings.title' })
  })

  it('reuses the existing settings tab for another settings path', () => {
    mocks.tabs = [{ id: 'settings-1', type: 'route', url: '/settings/provider', title: 'settings.title' }]
    render(<MainWindowNavigationHarness />)

    window.dispatchEvent(
      new CustomEvent(OPEN_MAIN_ROUTE_EVENT, {
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
    const { rerender } = render(<MainWindowNavigationHarness />)

    window.dispatchEvent(
      new CustomEvent(OPEN_MAIN_ROUTE_EVENT, {
        cancelable: true,
        detail: { path: '/settings/provider' }
      })
    )
    window.dispatchEvent(
      new CustomEvent(OPEN_MAIN_ROUTE_EVENT, {
        cancelable: true,
        detail: { path: '/settings/about' }
      })
    )

    expect(mocks.openTab).toHaveBeenCalledTimes(1)
    expect(mocks.openTab).toHaveBeenCalledWith('/settings/provider', { title: 'settings.title' })

    mocks.tabs = [{ id: 'settings-1', type: 'route', url: '/settings/provider', title: 'settings.title' }]
    rerender(<MainWindowNavigationHarness />)

    expect(mocks.updateTab).toHaveBeenCalledWith('settings-1', {
      url: '/settings/about',
      title: 'settings.title',
      lastAccessTime: expect.any(Number)
    })
    expect(mocks.setActiveTab).toHaveBeenCalledWith('settings-1')
  })

  it('opens settings from main-window init data', () => {
    mocks.initData = { kind: 'navigation', to: '/settings/about', requestId: 1 }
    render(<MainWindowNavigationHarness />)

    expect(mocks.openTab).toHaveBeenCalledWith('/settings/about', { title: 'settings.title' })
  })

  it('opens a regular tab for non-settings navigation init data', () => {
    mocks.initData = { kind: 'navigation', to: '/agents', requestId: 1 }
    render(<MainWindowNavigationHarness />)

    expect(mocks.openTab).toHaveBeenCalledWith('/agents')
  })

  it('opens a regular tab when a non-settings open_route_requested event arrives', () => {
    render(<MainWindowNavigationHarness />)

    mocks.ipcListeners.get('navigation.open_route_requested')?.({ to: '/knowledge' })

    expect(mocks.openTab).toHaveBeenCalledWith('/knowledge')
  })

  it('routes a settings path from the open_route_requested event through the settings singleton', () => {
    mocks.tabs = [{ id: 'settings-1', type: 'route', url: '/settings/provider', title: 'settings.title' }]
    render(<MainWindowNavigationHarness />)

    mocks.ipcListeners.get('navigation.open_route_requested')?.({ to: '/settings/about' })

    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(mocks.updateTab).toHaveBeenCalledWith('settings-1', {
      url: '/settings/about',
      title: 'settings.title',
      lastAccessTime: expect.any(Number)
    })
    expect(mocks.setActiveTab).toHaveBeenCalledWith('settings-1')
  })

  it('opens settings again when init data request id changes', () => {
    const { rerender } = render(<MainWindowNavigationHarness />)

    mocks.initData = { kind: 'navigation', to: '/settings/provider', requestId: 1 }
    rerender(<MainWindowNavigationHarness />)

    mocks.tabs = [{ id: 'settings-1', type: 'route', url: '/settings/provider', title: 'settings.title' }]
    mocks.initData = { kind: 'navigation', to: '/settings/about', requestId: 2 }
    rerender(<MainWindowNavigationHarness />)

    expect(mocks.openTab).toHaveBeenCalledWith('/settings/provider', { title: 'settings.title' })
    expect(mocks.updateTab).toHaveBeenCalledWith('settings-1', {
      url: '/settings/about',
      title: 'settings.title',
      lastAccessTime: expect.any(Number)
    })
  })

  it('does not replay the same init data request when tabs change', () => {
    mocks.initData = { kind: 'navigation', to: '/settings/provider', requestId: 1 }
    const { rerender } = render(<MainWindowNavigationHarness />)

    expect(mocks.openTab).toHaveBeenCalledTimes(1)

    mocks.tabs = [{ id: 'settings-1', type: 'route', url: '/settings/provider', title: 'settings.title' }]
    rerender(<MainWindowNavigationHarness />)

    expect(mocks.openTab).toHaveBeenCalledTimes(1)
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
  })

  it('routes non-settings main-route event paths to a regular tab', () => {
    render(<MainWindowNavigationHarness />)

    window.dispatchEvent(
      new CustomEvent(OPEN_MAIN_ROUTE_EVENT, {
        cancelable: true,
        detail: { path: '/agents' }
      })
    )

    expect(mocks.openTab).toHaveBeenCalledWith('/agents')
  })
})
