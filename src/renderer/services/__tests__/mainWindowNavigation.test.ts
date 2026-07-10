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

  it('falls back to the open_route_in_main IPC when the event is unhandled', () => {
    openRoute('/knowledge?base=1')

    expect(ipcRequestMock).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/knowledge?base=1' })
  })
})

describe('openSettingsTab', () => {
  it('delegates the normalized settings path to the main-route event with query preserved', () => {
    const handler = vi.fn((event: Event) => event.preventDefault())
    window.addEventListener(OPEN_MAIN_ROUTE_EVENT, handler)

    openSettingsTab('/settings/provider?id=openai')

    const event = handler.mock.calls[0][0] as OpenMainRouteEvent
    expect(event.detail).toEqual({ path: '/settings/provider?id=openai' })

    window.removeEventListener(OPEN_MAIN_ROUTE_EVENT, handler)
  })

  it('requests main-window navigation when the main-route event is unhandled', () => {
    openSettingsTab('/settings/mcp/servers')

    expect(ipcRequestMock).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/mcp/servers' })
  })

  it('normalizes invalid paths to the default settings page', () => {
    const handler = vi.fn((event: Event) => event.preventDefault())
    window.addEventListener(OPEN_MAIN_ROUTE_EVENT, handler)

    openSettingsTab('/agents' as never)

    const event = handler.mock.calls[0][0] as OpenMainRouteEvent
    expect(event.detail).toEqual({ path: '/settings/provider' })

    window.removeEventListener(OPEN_MAIN_ROUTE_EVENT, handler)
  })
})
