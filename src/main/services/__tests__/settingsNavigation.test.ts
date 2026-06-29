import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, mainWindowServiceMock } = vi.hoisted(() => {
  const mainWindowServiceMock = {
    showMainWindow: vi.fn()
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'MainWindowService') return mainWindowServiceMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  return { applicationMock, mainWindowServiceMock }
})

vi.mock('@application', () => ({ application: applicationMock }))

import { openSettingsInMainWindow } from '../settingsNavigation'

describe('settingsNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the main window with durable settings navigation init data', () => {
    openSettingsInMainWindow('/settings/provider?id=openai')

    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith({
      kind: 'settings-navigation',
      path: '/settings/provider?id=openai',
      requestId: expect.any(Number)
    })
  })

  it('falls back to the default settings path for invalid input', () => {
    openSettingsInMainWindow('/agents' as never)

    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledWith({
      kind: 'settings-navigation',
      path: '/settings/provider',
      requestId: expect.any(Number)
    })
  })

  it('uses a fresh request id for repeated settings navigations', () => {
    openSettingsInMainWindow('/settings/about')
    openSettingsInMainWindow('/settings/about')

    const firstRequest = mainWindowServiceMock.showMainWindow.mock.calls[0][0]
    const secondRequest = mainWindowServiceMock.showMainWindow.mock.calls[1][0]

    expect(secondRequest.requestId).toBeGreaterThan(firstRequest.requestId)
  })
})
