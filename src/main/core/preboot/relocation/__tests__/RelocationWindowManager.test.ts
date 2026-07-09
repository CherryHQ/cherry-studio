import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

async function loadWindowManager(isPackaged = true) {
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
  vi.doMock('electron', () => ({ app: { isPackaged }, BrowserWindow: FakeBrowserWindow }))

  return import('../RelocationWindowManager')
}

beforeEach(() => {
  vi.resetModules()
  relaunch.mockReset()
  FakeBrowserWindow.lastCreated = null
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('RelocationWindowManager renderer loss handling', () => {
  it('loads the bundled relocation window in packaged builds even when a dev server URL is present', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173')
    const { RelocationWindowManager } = await loadWindowManager(true)
    const manager = new RelocationWindowManager()
    manager.create()

    expect(FakeBrowserWindow.lastCreated!.loadFile).toHaveBeenCalledWith(
      expect.stringContaining('renderer/windows/relocation/index.html')
    )
    expect(FakeBrowserWindow.lastCreated!.loadURL).not.toHaveBeenCalled()
  })

  it('loads the dev server relocation window only in unpackaged builds', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173')
    const { RelocationWindowManager } = await loadWindowManager(false)
    const manager = new RelocationWindowManager()
    manager.create()

    expect(FakeBrowserWindow.lastCreated!.loadURL).toHaveBeenCalledWith(
      'http://127.0.0.1:5173/windows/relocation/index.html'
    )
    expect(FakeBrowserWindow.lastCreated!.loadFile).not.toHaveBeenCalled()
  })

  it('rejects waitForReady and marks headless when the window fails to load before ready', async () => {
    const { RelocationWindowManager } = await loadWindowManager()
    const manager = new RelocationWindowManager()
    manager.create()

    const ready = manager.waitForReady()
    FakeBrowserWindow.lastCreated!.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'file://relocation', true)

    await expect(ready).rejects.toThrow(/failed to load/i)
    expect(manager.shouldRestartAfterTerminalFailure()).toBe(true)
  })

  it('rejects waitForReady and marks headless when the window closes before ready', async () => {
    const { RelocationWindowManager } = await loadWindowManager()
    const manager = new RelocationWindowManager()
    manager.create()

    const ready = manager.waitForReady()
    FakeBrowserWindow.lastCreated!.emit('closed')

    await expect(ready).rejects.toThrow(/closed before ready/i)
    expect(manager.shouldRestartAfterTerminalFailure()).toBe(true)
  })

  it('rejects waitForReady and marks headless when the window never becomes ready', async () => {
    vi.useFakeTimers()
    try {
      const { RelocationWindowManager } = await loadWindowManager()
      const manager = new RelocationWindowManager()
      manager.create()

      const ready = manager.waitForReady()
      const readyAssertion = expect(ready).rejects.toThrow(/did not become ready/i)
      await vi.advanceTimersByTimeAsync(30_000)

      await readyAssertion
      expect(manager.shouldRestartAfterTerminalFailure()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

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
    const ready = manager.waitForReady()
    FakeBrowserWindow.lastCreated!.webContents.emit('did-finish-load')
    await ready
    manager.setStage('failed')

    FakeBrowserWindow.lastCreated!.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    expect(relaunch).toHaveBeenCalledTimes(1)
    expect(manager.shouldRestartAfterTerminalFailure()).toBe(false)
  })
})
