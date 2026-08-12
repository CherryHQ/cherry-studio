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

import { OPEN_MAIN_ROUTE_EVENT, type OpenMainRouteEvent, openRoute, openSettingsTab } from '../mainWindowNavigation'

beforeEach(() => {
  vi.clearAllMocks()
  ipcRequestMock.mockResolvedValue(undefined)
})

describe('openRoute', () => {
  it('dispatches a cancelable main-route event and skips IPC when handled in-window', () => {
    const handler = vi.fn((event: Event) => event.preventDefault())
    window.addEventListener(OPEN_MAIN_ROUTE_EVENT, handler)

    openRoute('/knowledge')

    expect(handler).toHaveBeenCalledTimes(1)
    const event = handler.mock.calls[0][0] as OpenMainRouteEvent
    expect(event.detail).toEqual({ path: '/knowledge' })
    expect(ipcRequestMock).not.toHaveBeenCalled()

    window.removeEventListener(OPEN_MAIN_ROUTE_EVENT, handler)
  })

  it('serializes route query parameters before dispatching the tab navigation event', () => {
    const handler = vi.fn((event: Event) => event.preventDefault())
    window.addEventListener(OPEN_MAIN_ROUTE_EVENT, handler)

    openRoute('/app/paintings', { source: 'assistant', prompt: 'red cherry' })

    const event = handler.mock.calls[0][0] as OpenMainRouteEvent
    expect(event.detail).toEqual({ path: '/app/paintings?source=assistant&prompt=red+cherry' })

    window.removeEventListener(OPEN_MAIN_ROUTE_EVENT, handler)
  })

  it('falls back to the open_route_in_main IPC when the event is unhandled', () => {
    openRoute('/knowledge?base=1')

    expect(ipcRequestMock).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/knowledge?base=1' })
  })
})

describe('openSettingsTab', () => {
  it('uses the centralized Settings request with query preserved', () => {
    openSettingsTab('/settings/provider?id=openai')

    expect(ipcRequestMock).toHaveBeenCalledWith('navigation.open_route_in_main', {
      path: '/settings/provider?id=openai'
    })
  })

  it('normalizes invalid paths to the default settings page', () => {
    openSettingsTab('/agents' as never)

    expect(ipcRequestMock).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/provider' })
  })
})
