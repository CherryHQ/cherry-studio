import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { dialogMock, electronApp, events, loggerMock } = vi.hoisted(() => ({
  dialogMock: {
    showMessageBox: vi.fn(),
    showMessageBoxSync: vi.fn()
  },
  electronApp: {
    exit: vi.fn(),
    getPath: vi.fn(() => '/mock/logs'),
    isPackaged: true,
    relaunch: vi.fn()
  },
  events: [] as string[],
  loggerMock: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: electronApp,
  dialog: dialogMock,
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    finish: vi.fn(),
    withContext: () => loggerMock
  }
}))

vi.mock('@main/core/platform', () => ({
  isDev: false,
  isLinux: false,
  isMac: false,
  isPortable: false,
  isWin: false
}))

vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    clearLoadError: vi.fn(),
    flush: vi.fn(),
    getLoadError: vi.fn(),
    repair: vi.fn(),
    reset: vi.fn()
  }
}))

vi.unmock('@application')

import { Application } from '@main/core/application/Application'

describe('Application.relaunchAfterShutdown', () => {
  const application = Application.getInstance()

  beforeEach(() => {
    events.length = 0
    vi.clearAllMocks()
    electronApp.isPackaged = true
    electronApp.relaunch.mockImplementation(() => {
      events.push('relaunch')
    })
    electronApp.exit.mockImplementation(() => {
      events.push('exit')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('schedules the next instance before lifecycle shutdown and exits last', async () => {
    vi.spyOn(application, 'shutdown').mockImplementation(async () => {
      events.push('shutdown')
    })

    await application.relaunchAfterShutdown()

    expect(events).toEqual(['relaunch', 'shutdown', 'exit'])
  })

  it('does not start shutdown when Electron refuses to schedule the relaunch', async () => {
    const shutdown = vi.spyOn(application, 'shutdown')
    electronApp.relaunch.mockImplementation(() => {
      throw new Error('schedule refused')
    })

    await expect(application.relaunchAfterShutdown()).rejects.toThrow('schedule refused')

    expect(shutdown).not.toHaveBeenCalled()
    expect(electronApp.exit).not.toHaveBeenCalled()
  })

  it('still exits when lifecycle cleanup fails after the relaunch is scheduled', async () => {
    vi.spyOn(application, 'shutdown').mockImplementation(async () => {
      events.push('shutdown')
      throw new Error('cleanup failed')
    })

    await expect(application.relaunchAfterShutdown()).resolves.toBeUndefined()

    expect(events).toEqual(['relaunch', 'shutdown', 'exit'])
    expect(loggerMock.error).toHaveBeenCalledWith('Error during shutdown before relaunch', expect.any(Error))
  })

  it('uses graceful shutdown before the manual-restart exit in development', async () => {
    electronApp.isPackaged = false
    vi.spyOn(application, 'shutdown').mockImplementation(async () => {
      events.push('shutdown')
    })

    await application.relaunchAfterShutdown()

    expect(electronApp.relaunch).not.toHaveBeenCalled()
    expect(dialogMock.showMessageBoxSync).toHaveBeenCalledOnce()
    expect(events).toEqual(['shutdown', 'exit'])
  })
})
