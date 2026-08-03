import { beforeEach, describe, expect, it, vi } from 'vitest'

const { focusOrOpenMock, openRouteInMainWindowMock, reportOwnershipMock, loggerMock } = vi.hoisted(() => ({
  focusOrOpenMock: vi.fn(),
  openRouteInMainWindowMock: vi.fn(),
  reportOwnershipMock: vi.fn(),
  loggerMock: {
    warn: vi.fn()
  }
}))

vi.mock('@application', () => ({
  application: {
    get: () => ({ focusOrOpen: focusOrOpenMock, reportOwnership: reportOwnershipMock })
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

  it('delegates conversation focus-or-open with the trusted caller window id', async () => {
    const target = { conversationType: 'assistant' as const, conversationId: 'topic-1' }

    await navigationHandlers['navigation.focus_or_open_conversation']({ target, title: 'Research notes' }, ctx)

    expect(focusOrOpenMock).toHaveBeenCalledWith(target, 'Research notes', 'w1')
  })

  it('reports conversation ownership against the trusted caller window id', async () => {
    await navigationHandlers['navigation.report_conversation_ownership'](
      { requestId: 'request-1', ownsTarget: true },
      ctx
    )

    expect(reportOwnershipMock).toHaveBeenCalledWith('request-1', 'w1', true)
  })
})
