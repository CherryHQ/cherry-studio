import { WindowType } from '@main/core/window/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, mainWindowServiceMock, windowManagerMock, ipcApiServiceMock } = vi.hoisted(() => {
  const mainWindowServiceMock = {
    showMainWindow: vi.fn()
  }
  const windowManagerMock = {
    getWindowsByType: vi.fn<() => unknown[]>(() => []),
    getWindowId: vi.fn(),
    getWindowType: vi.fn(),
    getWindow: vi.fn(),
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
  isAllowedRoute,
  markMainRendererReadyForDelivery,
  openRouteInMainWindow,
  openSettingsInMainWindow,
  openTabInMainWindow,
  resetMainRendererDelivery
} from '../mainWindowNavigation'

const aliveWindow = {
  isDestroyed: () => false,
  webContents: { isLoadingMainFrame: () => false, isCrashed: () => false }
}

describe('mainWindowNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    windowManagerMock.getWindowsByType.mockReturnValue([])
    windowManagerMock.getWindowId.mockReturnValue('main-1')
    windowManagerMock.getWindowType.mockReturnValue(WindowType.Main)
    windowManagerMock.getWindow.mockReturnValue(aliveWindow)
    windowManagerMock.getInitData.mockReturnValue(null)
  })

  afterEach(() => {
    // Flush any queued routes or tabs so module-level delivery state does not leak.
    windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
    windowManagerMock.getWindowType.mockReturnValue(WindowType.Main)
    markMainRendererReadyForDelivery('main-1')
    resetMainRendererDelivery()
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
      markMainRendererReadyForDelivery('main-1')

      openRouteInMainWindow('/knowledge')

      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-1', 'navigation.open_route_requested', {
        to: '/knowledge'
      })
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith()
    })

    it('queues a route until a live main renderer reports ready', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])

      openRouteInMainWindow('/app/chat')

      expect(ipcApiServiceMock.send).not.toHaveBeenCalled()
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith()

      markMainRendererReadyForDelivery('main-1')

      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-1', 'navigation.open_route_requested', {
        to: '/app/chat'
      })
    })

    it('preserves distinct queued routes while the renderer is unavailable', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])

      openRouteInMainWindow('/app/chat')
      openRouteInMainWindow('/app/agents')
      markMainRendererReadyForDelivery('main-1')

      expect(ipcApiServiceMock.send.mock.calls).toEqual([
        ['main-1', 'navigation.open_route_requested', { to: '/app/chat' }],
        ['main-1', 'navigation.open_route_requested', { to: '/app/agents' }]
      ])
    })

    it('preserves a repeated route when another command occurs between the requests', () => {
      const queuedTab = { id: 'queued-tab', type: 'route', url: '/app/chat', title: 'Chat' } as const
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])

      openRouteInMainWindow('/app/agents')
      openTabInMainWindow(queuedTab)
      openRouteInMainWindow('/app/agents')
      markMainRendererReadyForDelivery('main-1')

      expect(ipcApiServiceMock.send.mock.calls).toEqual([
        ['main-1', 'navigation.open_route_requested', { to: '/app/agents' }],
        ['main-1', 'tab.attached', queuedTab],
        ['main-1', 'navigation.open_route_requested', { to: '/app/agents' }]
      ])
    })

    it('coalesces only adjacent exact duplicate routes', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])

      openRouteInMainWindow('/app/agents')
      openRouteInMainWindow('/app/agents')
      markMainRendererReadyForDelivery('main-1')

      expect(ipcApiServiceMock.send.mock.calls).toEqual([
        ['main-1', 'navigation.open_route_requested', { to: '/app/agents' }]
      ])
    })

    it('queues a route when the renderer starts reloading after it reported ready', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
      markMainRendererReadyForDelivery('main-1')
      windowManagerMock.getWindow.mockReturnValue({
        isDestroyed: () => false,
        webContents: { isLoadingMainFrame: () => true, isCrashed: () => false }
      })

      openRouteInMainWindow('/app/translate')

      expect(ipcApiServiceMock.send).not.toHaveBeenCalled()
      windowManagerMock.getWindow.mockReturnValue(aliveWindow)
      markMainRendererReadyForDelivery('main-1')
      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-1', 'navigation.open_route_requested', {
        to: '/app/translate'
      })
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

    it('preserves tab-then-route order across a renderer rebuild', () => {
      const queuedTab = { id: 'queued-tab', type: 'route', url: '/app/chat', title: 'Chat' } as const
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
      openTabInMainWindow(queuedTab)

      windowManagerMock.getWindowsByType.mockReturnValue([])
      openRouteInMainWindow('/app/agents')

      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
      markMainRendererReadyForDelivery('main-1')

      expect(ipcApiServiceMock.send.mock.calls).toEqual([
        ['main-1', 'tab.attached', queuedTab],
        ['main-1', 'navigation.open_route_requested', { to: '/app/agents' }]
      ])
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenLastCalledWith()
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
      markMainRendererReadyForDelivery('main-1')

      openSettingsInMainWindow('/settings/about')

      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-1', 'navigation.open_route_requested', {
        to: '/settings/about'
      })
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith()
    })
  })

  describe('openTabInMainWindow', () => {
    const tab = { id: 'tab-1', type: 'route', url: '/app/chat', title: 'Chat' } as const

    it('sends the tab.attached event and raises the main window when its renderer is ready', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
      markMainRendererReadyForDelivery('main-1')

      openTabInMainWindow(tab)

      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-1', 'tab.attached', tab)
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith()
    })

    it('queues the tab instead of sending when the renderer is not ready yet', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])

      openTabInMainWindow(tab)

      // Race repro: a second attach lands before the fresh renderer mounted its
      // `tab.attached` listener — the event must not be dropped.
      expect(ipcApiServiceMock.send).not.toHaveBeenCalled()
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith()
    })

    it('flushes queued tabs once the renderer reports ready', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])

      openTabInMainWindow(tab)
      markMainRendererReadyForDelivery('main-1')

      expect(ipcApiServiceMock.send).toHaveBeenCalledTimes(1)
      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-1', 'tab.attached', tab)
    })

    it('does not replay queued tabs on a repeated ready signal', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])

      openTabInMainWindow(tab)
      markMainRendererReadyForDelivery('main-1')
      markMainRendererReadyForDelivery('main-1')

      expect(ipcApiServiceMock.send).toHaveBeenCalledTimes(1)
    })

    it('deduplicates repeated attaches of the same tab while queued', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])

      openTabInMainWindow(tab)
      openTabInMainWindow(tab)
      markMainRendererReadyForDelivery('main-1')

      expect(ipcApiServiceMock.send).toHaveBeenCalledTimes(1)
    })

    it('refreshes a duplicate tab payload without moving it behind a later route', () => {
      const renamedTab = { ...tab, title: 'Renamed chat' }
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])

      openTabInMainWindow(tab)
      openRouteInMainWindow('/app/agents')
      openTabInMainWindow(renamedTab)
      markMainRendererReadyForDelivery('main-1')

      expect(ipcApiServiceMock.send.mock.calls).toEqual([
        ['main-1', 'tab.attached', renamedTab],
        ['main-1', 'navigation.open_route_requested', { to: '/app/agents' }]
      ])
    })

    it('delivers queued tabs to the live window id at flush time', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])

      openTabInMainWindow(tab)
      // Window was rebuilt between enqueue and ready: resolve at flush time.
      windowManagerMock.getWindowId.mockReturnValue('main-2')
      markMainRendererReadyForDelivery('main-2')

      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-2', 'tab.attached', tab)
    })

    it('ignores ready signals from a non-main sender', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
      windowManagerMock.getWindowType.mockReturnValue('sub-window' as WindowType)

      markMainRendererReadyForDelivery('sub-1')
      openTabInMainWindow(tab)

      // Still queued: the non-main ready cannot have armed delivery.
      expect(ipcApiServiceMock.send).not.toHaveBeenCalled()
    })

    it('re-queues during a reload even when the ready flag is armed', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
      markMainRendererReadyForDelivery('main-1')
      windowManagerMock.getWindow.mockReturnValue({
        isDestroyed: () => false,
        webContents: { isLoadingMainFrame: () => true, isCrashed: () => false }
      })

      openTabInMainWindow(tab)

      // Sync backstop: window is live but its frame is reloading — no listener.
      expect(ipcApiServiceMock.send).not.toHaveBeenCalled()
      // Once the new frame mounts, its ready report flushes the re-queued tab.
      windowManagerMock.getWindow.mockReturnValue(aliveWindow)
      markMainRendererReadyForDelivery('main-1')
      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-1', 'tab.attached', tab)
    })

    it('keeps the queue across a delivery reset and flushes it after the next ready', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])

      openTabInMainWindow(tab)
      // Window destroyed / webContents reloading — readiness dropped, queue kept.
      resetMainRendererDelivery()
      windowManagerMock.getWindowId.mockReturnValue('main-2')
      markMainRendererReadyForDelivery('main-2')

      expect(ipcApiServiceMock.send).toHaveBeenCalledWith('main-2', 'tab.attached', tab)
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

    it('preserves route-then-tab order across a renderer rebuild', () => {
      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
      openRouteInMainWindow('/app/chat')

      windowManagerMock.getWindowsByType.mockReturnValue([])
      openTabInMainWindow(tab)

      windowManagerMock.getWindowsByType.mockReturnValue([aliveWindow])
      markMainRendererReadyForDelivery('main-1')

      expect(ipcApiServiceMock.send.mock.calls).toEqual([
        ['main-1', 'navigation.open_route_requested', { to: '/app/chat' }],
        ['main-1', 'tab.attached', tab]
      ])
      expect(mainWindowServiceMock.showMainWindow).toHaveBeenLastCalledWith()
    })
  })

  describe('isAllowedRoute', () => {
    it('allows real app routes under the /app prefix, with or without a query string', () => {
      expect(isAllowedRoute('/app/agents')).toBe(true)
      expect(isAllowedRoute('/app/agents?intent=feedback&sessionId=abc')).toBe(true)
      expect(isAllowedRoute('/app/knowledge')).toBe(true)
    })

    it('allows settings routes carrying a query string', () => {
      expect(isAllowedRoute('/settings/provider?id=openai')).toBe(true)
    })

    it('keeps the legacy protocol-deep-link prefixes allowlisted', () => {
      expect(isAllowedRoute('/agents')).toBe(true)
      expect(isAllowedRoute('/knowledge?x=1&y=2')).toBe(true)
    })

    it('rejects unknown routes', () => {
      expect(isAllowedRoute('/definitely-not-a-route')).toBe(false)
      expect(isAllowedRoute('/agents-legacy')).toBe(false)
    })
  })
})
