import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, mainWindowServiceMock, windowManagerMock, ipcApiServiceMock } = vi.hoisted(() => {
  const mainWindowServiceMock = {
    showMainWindow: vi.fn()
  }
  const windowManagerMock = {
    getWindowsByType: vi.fn<() => unknown[]>(() => []),
    getWindowId: vi.fn(),
    getInitData: vi.fn(),
    clearInitData: vi.fn()
  }
  const ipcApiServiceMock = {
    send: vi.fn()
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'MainWindowService') return mainWindowServiceMock
      if (name === 'WindowManager') return windowManagerMock
      if (name === 'IpcApiService') return ipcApiServiceMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  return { applicationMock, mainWindowServiceMock, windowManagerMock, ipcApiServiceMock }
})

vi.mock('@application', () => ({ application: applicationMock }))

import {
  acknowledgeMainWindowNavigation,
  openRouteInMainWindow,
  openSettingsInMainWindow,
  openTabInMainWindow
} from '../mainWindowNavigation'

const aliveWindow = { isDestroyed: () => false }

describe('mainWindowNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    windowManagerMock.getWindowsByType.mockReturnValue([])
    windowManagerMock.getInitData.mockReturnValue(null)
  })

  describe('acknowledgeMainWindowNavigation', () => {
    it('clears only the matching stored navigation request', () => {
      windowManagerMock.getInitData.mockReturnValue({ kind: 'navigation', to: '/settings/about', requestId: 7 })
      acknowledgeMainWindowNavigation('main-1', 7)
      expect(windowManagerMock.clearInitData).toHaveBeenCalledWith('main-1')

      vi.clearAllMocks()
      windowManagerMock.getInitData.mockReturnValue({ kind: 'navigation', to: '/settings/about', requestId: 8 })
      acknowledgeMainWindowNavigation('main-1', 7)
      expect(windowManagerMock.clearInitData).not.toHaveBeenCalled()
    })

    it('clears a matching tab-attach init data payload', () => {
      windowManagerMock.getInitData.mockReturnValue({
        kind: 'tab-attach',
        tab: { id: 'tab-1', type: 'route', url: '/app/chat', title: 'Chat' },
        requestId: 9
      })
      acknowledgeMainWindowNavigation('main-1', 9)
      expect(windowManagerMock.clearInitData).toHaveBeenCalledWith('main-1')
    })

    it('does not clear a tab-attach payload for a mismatched request id', () => {
      windowManagerMock.getInitData.mockReturnValue({
        kind: 'tab-attach',
        tab: { id: 'tab-1', type: 'route', url: '/app/chat', title: 'Chat' },
        requestId: 9
      })
      acknowledgeMainWindowNavigation('main-1', 8)
      expect(windowManagerMock.clearInitData).not.toHaveBeenCalled()
    })
  })

  describe('openRouteInMainWindow', () => {
    it('sends the open_route_requested event and focuses when the main window is alive', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
      windowManagerMock.getWindowId.mockReturnValue('main-1')

      openRouteInMainWindow('/knowledge')

      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-1', 'navigation.open_route_requested', {
        to: '/knowledge'
      })
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith()
    })

    it('creates the main window with navigation init data when none exists', () => {
      openRouteInMainWindow('/knowledge')

      expect(ipcApiServiceMock.send).not.toHaveBeenCalled()
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith({
        kind: 'navigation',
        to: '/knowledge',
        requestId: expect.any(Number)
      })
    })

    it('uses a fresh request id for repeated cold-start navigations', () => {
      openRouteInMainWindow('/knowledge')
      openRouteInMainWindow('/agents')

      const firstRequest = mainWindowServiceMock.showMainWindow.mock.calls[0][0]
      const secondRequest = mainWindowServiceMock.showMainWindow.mock.calls[1][0]

      expect(secondRequest.requestId).toBeGreaterThan(firstRequest.requestId)
    })
  })

  describe('openSettingsInMainWindow', () => {
    it('normalizes and delegates a valid settings path', () => {
      openSettingsInMainWindow('/settings/provider?id=openai')

      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith({
        kind: 'navigation',
        to: '/settings/provider?id=openai',
        requestId: expect.any(Number)
      })
    })

    it('falls back to the default settings path for invalid input', () => {
      openSettingsInMainWindow('/agents' as never)

      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith({
        kind: 'navigation',
        to: '/settings/provider',
        requestId: expect.any(Number)
      })
    })

    it('delivers via the event when the main window is alive', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
      windowManagerMock.getWindowId.mockReturnValue('main-1')

      openSettingsInMainWindow('/settings/about')

      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-1', 'navigation.open_route_requested', {
        to: '/settings/about'
      })
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith()
    })
  })

  describe('openTabInMainWindow', () => {
    const tab = { id: 'tab-1', type: 'route', url: '/app/chat', title: 'Chat' } as const

    it('sends the tab.attached event and raises the main window when it is alive', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
      windowManagerMock.getWindowId.mockReturnValue('main-1')

      openTabInMainWindow(tab)

      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-1', 'tab.attached', tab)
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith()
    })

    it('rebuilds the main window with tab-attach init data when none exists', () => {
      openTabInMainWindow(tab)

      expect(ipcApiServiceMock.send).not.toHaveBeenCalled()
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith({
        kind: 'tab-attach',
        tab,
        requestId: expect.any(Number)
      })
    })
  })
})
