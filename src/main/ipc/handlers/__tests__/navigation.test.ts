import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openRouteInMainWindowMock, loggerMock } = vi.hoisted(() => ({
  openRouteInMainWindowMock: vi.fn(),
  loggerMock: {
    warn: vi.fn()
  }
}))

vi.mock('@main/services/mainWindowNavigation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openRouteInMainWindow: openRouteInMainWindowMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

import { navigationHandlers } from '../navigation'

beforeEach(() => {
  vi.clearAllMocks()
})

const ctx = { senderId: 'w1' }

describe('navigationHandlers', () => {
  it('opens an allowlisted settings route in the main window', async () => {
    await navigationHandlers['navigation.open_route_in_main']({ path: '/settings/mcp/servers' }, ctx)

    expect(openRouteInMainWindowMock).toHaveBeenCalledWith('/settings/mcp/servers')
  })

  it('opens an allowlisted non-settings route in the main window', async () => {
    await navigationHandlers['navigation.open_route_in_main']({ path: '/knowledge' }, ctx)

    expect(openRouteInMainWindowMock).toHaveBeenCalledWith('/knowledge')
  })

  it('drops routes outside the allowlist with a warning', async () => {
    await navigationHandlers['navigation.open_route_in_main']({ path: '/definitely-not-a-route' }, ctx)

    expect(openRouteInMainWindowMock).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalled()
  })
})
