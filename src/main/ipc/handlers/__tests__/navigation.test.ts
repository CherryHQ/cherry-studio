import { beforeEach, describe, expect, it, vi } from 'vitest'

const { acknowledgeMainWindowNavigationMock, openRouteInMainWindowMock, loggerMock } = vi.hoisted(() => ({
  acknowledgeMainWindowNavigationMock: vi.fn(),
  openRouteInMainWindowMock: vi.fn(),
  loggerMock: {
    warn: vi.fn()
  }
}))

vi.mock('@main/services/mainWindowNavigation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  acknowledgeMainWindowNavigation: acknowledgeMainWindowNavigationMock,
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

  it('acknowledges navigation init data for the caller window', async () => {
    await navigationHandlers['navigation.ack_open_route']({ requestId: 7 }, ctx)

    expect(acknowledgeMainWindowNavigationMock).toHaveBeenCalledWith('w1', 7)
  })

  it('ignores navigation acknowledgements from an untracked caller', async () => {
    await navigationHandlers['navigation.ack_open_route']({ requestId: 7 }, { senderId: null })

    expect(acknowledgeMainWindowNavigationMock).not.toHaveBeenCalled()
  })
})
