import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, mainWindowServiceMock, windowManagerMock } = vi.hoisted(() => {
  const windowManagerMock = {
    broadcastToType: vi.fn(),
    getWindowsByType: vi.fn(() => [] as unknown[])
  }
  const mainWindowServiceMock = {
    showMainWindow: vi.fn()
  }
  const loggerMock = {
    error: vi.fn()
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'MainWindowService') return mainWindowServiceMock
      if (name === 'WindowManager') return windowManagerMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  return { applicationMock, loggerMock, mainWindowServiceMock, windowManagerMock }
})

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@main/core/window/types', () => ({
  WindowType: {
    Main: 'main'
  }
}))

vi.mock('@shared/IpcChannel', () => ({
  IpcChannel: {
    IpcApi_Event: 'ipc-api:event'
  }
}))

import { openSettingsInMainWindow } from '../settingsNavigation'

describe('settingsNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    windowManagerMock.getWindowsByType.mockReturnValue([])
  })

  it('shows the main window and broadcasts a settings tab event', () => {
    openSettingsInMainWindow('/settings/provider?id=openai')

    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledTimes(1)
    expect(windowManagerMock.broadcastToType).toHaveBeenCalledWith(
      'main',
      'ipc-api:event',
      'navigation.open_settings',
      {
        path: '/settings/provider?id=openai'
      }
    )
  })

  it('falls back to the default settings path for invalid input', () => {
    openSettingsInMainWindow('/agents' as never)

    expect(windowManagerMock.broadcastToType).toHaveBeenCalledWith(
      'main',
      'ipc-api:event',
      'navigation.open_settings',
      {
        path: '/settings/provider'
      }
    )
  })

  it('logs broadcast failures after showing the main window', () => {
    const error = new Error('broadcast failed')
    windowManagerMock.broadcastToType.mockImplementationOnce(() => {
      throw error
    })

    openSettingsInMainWindow('/settings/about')

    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledTimes(1)
    expect(loggerMock.error).toHaveBeenCalledWith('Failed to broadcast settings navigation', error)
  })

  it('waits for the main window to finish loading before broadcasting', () => {
    let onDidFinishLoad: (() => void) | undefined
    const mainWindow = {
      webContents: {
        isLoading: vi.fn(() => true),
        once: vi.fn((event: string, listener: () => void) => {
          if (event === 'did-finish-load') {
            onDidFinishLoad = listener
          }
        })
      }
    }
    windowManagerMock.getWindowsByType.mockReturnValue([mainWindow])

    openSettingsInMainWindow('/settings/about')

    expect(windowManagerMock.broadcastToType).not.toHaveBeenCalled()
    expect(mainWindow.webContents.once).toHaveBeenCalledWith('did-finish-load', expect.any(Function))

    onDidFinishLoad?.()

    expect(windowManagerMock.broadcastToType).toHaveBeenCalledWith(
      'main',
      'ipc-api:event',
      'navigation.open_settings',
      {
        path: '/settings/about'
      }
    )
  })
})
