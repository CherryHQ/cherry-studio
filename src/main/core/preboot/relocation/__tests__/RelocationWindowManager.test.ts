import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const relaunch = vi.fn()

class FakeWebContents extends EventEmitter {
  send = vi.fn()
  isLoading = vi.fn(() => false)
}

class FakeBrowserWindow extends EventEmitter {
  static lastCreated: FakeBrowserWindow | null = null

  webContents = new FakeWebContents()
  show = vi.fn()
  loadFile = vi.fn()
  loadURL = vi.fn()
  private destroyed = false

  constructor() {
    super()
    FakeBrowserWindow.lastCreated = this
  }

  isDestroyed() {
    return this.destroyed
  }

  close() {
    const event = {
      defaultPrevented: false,
      preventDefault: vi.fn(() => {
        event.defaultPrevented = true
      })
    }

    this.emit('close', event)
    if (!event.defaultPrevented) {
      this.destroyed = true
      this.emit('closed')
    }
  }
}

async function loadWindowManager() {
  vi.doMock('@application', async () => {
    const { mockApplicationFactory } = await import('@test-mocks/main/application')
    const appModule = mockApplicationFactory()
    return {
      ...appModule,
      application: {
        ...appModule.application,
        relaunch
      }
    }
  })
  vi.doMock('@logger', () => ({
    loggerService: {
      withContext: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      })
    }
  }))
  vi.doMock('@main/core/platform', () => ({ isMac: false }))
  vi.doMock('electron', () => ({ BrowserWindow: FakeBrowserWindow }))

  return import('../RelocationWindowManager')
}

beforeEach(() => {
  vi.resetModules()
  relaunch.mockReset()
  FakeBrowserWindow.lastCreated = null
})

describe('RelocationWindowManager renderer loss handling', () => {
  it('continues headlessly instead of relaunching when the renderer process dies during copying', async () => {
    const { RelocationWindowManager } = await loadWindowManager()
    const manager = new RelocationWindowManager()
    manager.create()
    manager.setStage('copying')

    FakeBrowserWindow.lastCreated!.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    expect(relaunch).not.toHaveBeenCalled()
    expect(manager.shouldRestartAfterTerminalFailure()).toBe(true)
  })

  it('continues headlessly instead of relaunching when the renderer is unresponsive during copying', async () => {
    const { RelocationWindowManager } = await loadWindowManager()
    const manager = new RelocationWindowManager()
    manager.create()
    manager.setStage('copying')

    FakeBrowserWindow.lastCreated!.webContents.emit('unresponsive')

    expect(relaunch).not.toHaveBeenCalled()
    expect(manager.shouldRestartAfterTerminalFailure()).toBe(true)
  })

  it('still relaunches when the renderer is lost after the gate reaches a closable stage', async () => {
    const { RelocationWindowManager } = await loadWindowManager()
    const manager = new RelocationWindowManager()
    manager.create()
    manager.setStage('failed')

    FakeBrowserWindow.lastCreated!.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    expect(relaunch).toHaveBeenCalledTimes(1)
    expect(manager.shouldRestartAfterTerminalFailure()).toBe(false)
  })
})
