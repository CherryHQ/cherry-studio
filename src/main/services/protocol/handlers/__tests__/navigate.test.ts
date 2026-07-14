import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerMock, openRouteInMainWindowMock, openSettingsInMainWindowMock } = vi.hoisted(() => ({
  loggerMock: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  },
  openRouteInMainWindowMock: vi.fn(),
  openSettingsInMainWindowMock: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: vi.fn() } }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@main/services/mainWindowNavigation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openRouteInMainWindow: openRouteInMainWindowMock,
  openSettingsInMainWindow: openSettingsInMainWindowMock
}))

import { handleNavigateProtocolUrl } from '../navigate'

describe('navigate protocol handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks paths outside the route allowlist', () => {
    handleNavigateProtocolUrl(new URL('cherrystudio://navigate/agents-legacy'))

    expect(loggerMock.warn).toHaveBeenCalledWith('Blocked navigation to disallowed route: /agents-legacy')
    expect(openRouteInMainWindowMock).not.toHaveBeenCalled()
    expect(openSettingsInMainWindowMock).not.toHaveBeenCalled()
  })

  it('opens settings routes through the main-window settings helper', () => {
    handleNavigateProtocolUrl(new URL('cherrystudio://navigate/settings/provider?id=openai'))

    expect(openSettingsInMainWindowMock).toHaveBeenCalledWith('/settings/provider?id=openai')
    expect(openRouteInMainWindowMock).not.toHaveBeenCalled()
  })

  it('opens non-settings routes with the query string preserved', () => {
    handleNavigateProtocolUrl(new URL('cherrystudio://navigate/agents?x=1&y=2'))

    expect(openRouteInMainWindowMock).toHaveBeenCalledWith('/agents?x=1&y=2')
    expect(openSettingsInMainWindowMock).not.toHaveBeenCalled()
  })
})
