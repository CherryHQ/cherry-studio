import { MigrationIpcChannels, type MigrationStage } from '@shared/data/migration/v2/types'
import { app, BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMigrationWindowFailureClaim, MigrationWindowManager } from '../MigrationWindowManager'

const platformState = vi.hoisted(() => ({ isDev: false, isMac: false }))

vi.mock('@main/core/platform', () => ({
  get isDev() {
    return platformState.isDev
  },
  get isMac() {
    return platformState.isMac
  }
}))

type FakeWindow = ReturnType<typeof makeFakeWindow>

describe('createMigrationWindowFailureClaim', () => {
  it.each(['synchronous throw', 'asynchronous rejection'] as const)(
    'settles the shared completion after a winner %s without invoking the loser',
    async (failureMode) => {
      const failureClaim = createMigrationWindowFailureClaim()
      const error = new Error('winner failed')
      const winnerOperation = vi.fn(() => {
        if (failureMode === 'synchronous throw') throw error
        return Promise.reject(error)
      })
      const loserOperation = vi.fn()

      const winner = failureClaim.claim(winnerOperation)
      const loser = failureClaim.claim(loserOperation)

      expect(winner.claimed).toBe(true)
      expect(loser.claimed).toBe(false)
      expect(loser.completion).toBe(winner.completion)
      await expect(loser.completion).rejects.toBe(error)
      expect(winnerOperation).toHaveBeenCalledTimes(1)
      expect(loserOperation).not.toHaveBeenCalled()
    }
  )
})

/**
 * Minimal BrowserWindow stand-in. Captures `on(event, cb)` handlers so tests can drive the
 * native `close` event, and records the imperative calls the manager makes on the window.
 */
function makeFakeWindow() {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const wcHandlers: Record<string, (...args: unknown[]) => void> = {}
  return {
    show: vi.fn(),
    minimize: vi.fn(),
    // Faithful to Electron: `close()` synchronously emits the `'close'` event. This lets the
    // programmatic-close guard path actually run in tests (e.g. during confirmQuit()).
    close: vi.fn(() => handlers['close']?.({ preventDefault: vi.fn() })),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn().mockResolvedValue(undefined),
    once: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb
    }),
    webContents: {
      isLoading: () => false,
      once: vi.fn(),
      send: vi.fn(),
      // Capture webContents listeners (render-process-gone / unresponsive) so tests can drive them.
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        wcHandlers[event] = cb
      }),
      emit: (event: string, ...args: unknown[]) => wcHandlers[event]?.(...args)
    },
    emit: (event: string, ...args: unknown[]) => handlers[event]?.(...args)
  }
}

describe('MigrationWindowManager', () => {
  let manager: MigrationWindowManager
  let fakeWindow: FakeWindow
  let quitMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    platformState.isDev = false
    platformState.isMac = false
    fakeWindow = makeFakeWindow()
    vi.mocked(BrowserWindow).mockImplementation(() => fakeWindow as unknown as BrowserWindow)
    // The global electron mock's `app` has no `quit`; provide one to observe quit attempts.
    quitMock = vi.fn()
    ;(app as unknown as { quit: typeof quitMock }).quit = quitMock
    manager = new MigrationWindowManager()
    manager.create()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('window load lifecycle', () => {
    it('propagates a production loadFile rejection through waitForReady without an unhandled rejection', async () => {
      const loadError = new Error('missing migration renderer asset')
      fakeWindow.loadFile.mockReset().mockImplementation(() => Promise.reject(loadError))
      manager = new MigrationWindowManager()

      manager.create()

      await expect(manager.waitForReady()).rejects.toBe(loadError)
      expect(fakeWindow.loadFile).toHaveBeenCalledTimes(1)
      expect(fakeWindow.loadURL).not.toHaveBeenCalled()
      expect(fakeWindow.webContents.once).not.toHaveBeenCalled()
    })

    it('propagates a development loadURL rejection through waitForReady', async () => {
      platformState.isDev = true
      vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173')
      const loadError = new Error('migration dev server unavailable')
      fakeWindow.loadURL.mockReset().mockImplementation(() => Promise.reject(loadError))
      fakeWindow.loadFile.mockClear()
      manager = new MigrationWindowManager()

      manager.create()

      await expect(manager.waitForReady()).rejects.toBe(loadError)
      expect(fakeWindow.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173/windows/migrationV2/index.html')
      expect(fakeWindow.loadFile).not.toHaveBeenCalled()
    })

    it('waits only for the recreated window and ignores the old window load promise', async () => {
      let rejectOld!: (error: Error) => void
      const oldLoad = new Promise<void>((_resolve, reject) => {
        rejectOld = reject
      })
      void oldLoad.catch(() => undefined)
      fakeWindow.loadFile.mockReset().mockReturnValue(oldLoad)
      manager = new MigrationWindowManager()
      manager.create()

      fakeWindow.emit('closed')

      let resolveCurrent!: () => void
      const currentLoad = new Promise<void>((resolve) => {
        resolveCurrent = resolve
      })
      const currentWindow = makeFakeWindow()
      currentWindow.loadFile.mockReset().mockReturnValue(currentLoad)
      vi.mocked(BrowserWindow).mockImplementationOnce(() => currentWindow as unknown as BrowserWindow)
      manager.create()

      let readySettled = false
      const ready = manager.waitForReady().then(() => {
        readySettled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(readySettled).toBe(false)

      rejectOld(new Error('stale load failed'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(readySettled).toBe(false)

      resolveCurrent()
      await ready
      expect(readySettled).toBe(true)
      expect(currentWindow.webContents.once).not.toHaveBeenCalled()
    })

    it('ignores renderer failure signals from a closed window after recreation', async () => {
      const oldWindow = fakeWindow
      const oldRendererFailure = vi.fn().mockResolvedValue(undefined)
      manager = new MigrationWindowManager()
      manager.create({ onRendererFailure: oldRendererFailure })
      oldWindow.emit('closed')

      const currentWindow = makeFakeWindow()
      const currentRendererFailure = vi.fn().mockResolvedValue(undefined)
      vi.mocked(BrowserWindow).mockImplementationOnce(() => currentWindow as unknown as BrowserWindow)
      manager.create({ onRendererFailure: currentRendererFailure })

      oldWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
      currentWindow.webContents.emit('unresponsive')
      await vi.waitFor(() => expect(currentRendererFailure).toHaveBeenCalledTimes(1))

      expect(oldRendererFailure).not.toHaveBeenCalled()
      expect(currentRendererFailure).toHaveBeenCalledWith('renderer_unresponsive', expect.any(Promise))
    })
  })

  it('minimizes the current window', () => {
    manager.minimize()
    expect(fakeWindow.minimize).toHaveBeenCalledTimes(1)
  })

  // Entry page (introduction is the default stage) + terminal pages: close routes through the
  // same requester as every other quit path, then the no-write fallback quits immediately.
  it.each<MigrationStage>(['introduction', 'completed', 'error', 'version_incompatible'])(
    'routes a native close through the quit-safety path at the %s stage',
    (stage) => {
      manager.setStage(stage)
      const event = { preventDefault: vi.fn() }
      fakeWindow.emit('close', event)

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(fakeWindow.webContents.send).not.toHaveBeenCalled()
      expect(fakeWindow.close).toHaveBeenCalledTimes(1)
      expect(quitMock).toHaveBeenCalledTimes(1)
    }
  )

  it.each<MigrationStage>(['introduction', 'completed', 'error', 'version_incompatible'])(
    'keeps the window open when the quit requester defers a native close at the %s stage',
    (stage) => {
      const requester = vi.fn(() => false)
      manager.setQuitRequester(requester)
      manager.setStage(stage)
      const event = { preventDefault: vi.fn() }

      fakeWindow.emit('close', event)

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(requester).toHaveBeenCalledTimes(1)
      expect(fakeWindow.close).not.toHaveBeenCalled()
      expect(quitMock).not.toHaveBeenCalled()
    }
  )

  // In-flow stage: close is intercepted so the renderer can confirm before quitting.
  it.each<MigrationStage>(['migration'])(
    'intercepts a close during the %s stage and asks the renderer to confirm',
    (stage) => {
      manager.setStage(stage)
      const event = { preventDefault: vi.fn() }
      fakeWindow.emit('close', event)

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(fakeWindow.webContents.send).toHaveBeenCalledWith(MigrationIpcChannels.ConfirmClose)
      expect(quitMock).not.toHaveBeenCalled()
    }
  )

  it('closes the window and quits once the renderer confirms quit', () => {
    manager.setStage('migration')
    manager.confirmQuit()

    expect(fakeWindow.close).toHaveBeenCalledTimes(1)
    expect(quitMock).toHaveBeenCalledTimes(1)
  })

  // Regression: confirmQuit() during an in-flow stage must NOT re-trigger the in-flow
  // interception. Its programmatic close() emits the native `'close'` event, but the
  // `programmaticClose` guard (checked before the stage check) must short-circuit it — so no
  // second ConfirmClose is sent and the app actually quits.
  it('does not re-intercept the programmatic close fired during confirmQuit', () => {
    manager.setStage('migration')
    manager.confirmQuit()

    expect(fakeWindow.webContents.send).not.toHaveBeenCalledWith(MigrationIpcChannels.ConfirmClose)
    expect(fakeWindow.close).toHaveBeenCalledTimes(1)
    expect(quitMock).toHaveBeenCalledTimes(1)
  })

  // A confirmed in-flow quit leaves `programmaticClose` set and the stage stale. Recreating
  // the window must reset both guards, otherwise the in-flow close-confirmation seam would
  // stay suppressed on the new window.
  it('resets the close guards when the window is recreated', () => {
    manager.setStage('migration')
    manager.confirmQuit()
    fakeWindow.webContents.send.mockClear()

    manager.create()
    manager.setStage('migration')
    const event = { preventDefault: vi.fn() }
    fakeWindow.emit('close', event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith(MigrationIpcChannels.ConfirmClose)
  })

  describe('wedged-renderer escape hatch', () => {
    // Routes a force-quit through the IPC handler's write-deferral in production; here a spy
    // stands in for it so the escape paths can be asserted without the confirmQuit fallback.
    function wireRequester() {
      const requester = vi.fn(() => true)
      manager.setQuitRequester(requester)
      return requester
    }

    it('force-quits via the requester on a repeated close while a confirmation is pending', () => {
      const requester = wireRequester()
      manager.setStage('migration')

      // First close: intercept + ask the renderer to confirm (sets the pending flag).
      fakeWindow.emit('close', { preventDefault: vi.fn() })
      expect(fakeWindow.webContents.send).toHaveBeenCalledWith(MigrationIpcChannels.ConfirmClose)
      fakeWindow.webContents.send.mockClear()

      // Second close while pending: escape hatch fires — quit, no second ConfirmClose.
      const event = { preventDefault: vi.fn() }
      fakeWindow.emit('close', event)

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(requester).toHaveBeenCalledTimes(1)
      expect(fakeWindow.webContents.send).not.toHaveBeenCalledWith(MigrationIpcChannels.ConfirmClose)
    })

    it('re-prompts instead of force-quitting after the renderer acks a dismissal', () => {
      const requester = wireRequester()
      manager.setStage('migration')

      fakeWindow.emit('close', { preventDefault: vi.fn() }) // pending = true
      manager.clearCloseConfirm() // renderer dismissed the dialog (CancelClose)
      fakeWindow.webContents.send.mockClear()

      const event = { preventDefault: vi.fn() }
      fakeWindow.emit('close', event) // pending cleared → fresh prompt, not a force-quit

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(fakeWindow.webContents.send).toHaveBeenCalledWith(MigrationIpcChannels.ConfirmClose)
      expect(requester).not.toHaveBeenCalled()
    })

    it('force-quits when the renderer process is gone', () => {
      const requester = wireRequester()
      manager.setStage('migration')

      // Electron signature: (event, details).
      fakeWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

      expect(requester).toHaveBeenCalledTimes(1)
    })

    it('force-quits when the renderer is unresponsive', () => {
      const requester = wireRequester()
      manager.setStage('migration')

      fakeWindow.webContents.emit('unresponsive')

      expect(requester).toHaveBeenCalledTimes(1)
    })

    it('shares one native failure callback across consecutive crash and hang signals', async () => {
      const onRendererFailure = vi.fn().mockResolvedValue(undefined)
      manager = new MigrationWindowManager()
      manager.create({ onRendererFailure })

      fakeWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
      fakeWindow.webContents.emit('unresponsive')
      await vi.waitFor(() => expect(onRendererFailure).toHaveBeenCalledTimes(1))

      expect(onRendererFailure).toHaveBeenCalledWith('renderer_process_gone', expect.any(Promise))
    })

    it('sets the single-flight guard before invoking a re-entrant native failure callback', async () => {
      let emittedReentrantSignal = false
      const onRendererFailure = vi.fn(() => {
        if (!emittedReentrantSignal) {
          emittedReentrantSignal = true
          fakeWindow.webContents.emit('unresponsive')
        }
      })
      manager = new MigrationWindowManager()
      manager.create({ onRendererFailure })

      fakeWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
      await vi.waitFor(() => expect(onRendererFailure).toHaveBeenCalledTimes(1))
    })

    it('invokes the native failure callback before starting the write waiter and passes its settlement promise', async () => {
      let releaseWrite!: () => void
      const pendingWrite = new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
      const order: string[] = []
      const waitForWrites = vi.fn(() => {
        order.push('wait-started')
        return pendingWrite
      })
      let receivedWritesSettled: Promise<void> | undefined
      const onRendererFailure = vi.fn((_reason: string, writesSettled?: Promise<void>) => {
        order.push('marker-recorded')
        receivedWritesSettled = writesSettled
        return writesSettled
      })
      manager = new MigrationWindowManager()
      manager.setWriteWaiter(waitForWrites)
      manager.create({ onRendererFailure })

      fakeWindow.webContents.emit('unresponsive')
      expect(onRendererFailure).toHaveBeenCalledTimes(1)
      expect(receivedWritesSettled).toBeInstanceOf(Promise)
      expect(order).toEqual(['marker-recorded'])

      await Promise.resolve()
      expect(waitForWrites).toHaveBeenCalledTimes(1)
      expect(order).toEqual(['marker-recorded', 'wait-started'])

      releaseWrite()
      await receivedWritesSettled
    })

    it('keeps asynchronous crash and hang re-entry on the same marker callback', async () => {
      const onRendererFailure = vi.fn(async () => {
        await Promise.resolve()
        fakeWindow.webContents.emit('unresponsive')
      })
      manager = new MigrationWindowManager()
      manager.create({ onRendererFailure })

      fakeWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed', raw: 'secret-details' })
      await vi.waitFor(() => expect(onRendererFailure).toHaveBeenCalledTimes(1))

      expect(onRendererFailure).toHaveBeenCalledWith('renderer_process_gone', expect.any(Promise))
      expect(JSON.stringify(onRendererFailure.mock.calls)).not.toContain('secret-details')
    })

    it('clears a stale pending close when the stage leaves and re-enters the in-flow set', () => {
      const requester = wireRequester()
      manager.setStage('migration')
      fakeWindow.emit('close', { preventDefault: vi.fn() }) // pending = true

      manager.setStage('error') // leaves the in-flow set → clears pending
      manager.setStage('migration') // re-enters the in-flow migration stage
      fakeWindow.webContents.send.mockClear()

      const event = { preventDefault: vi.fn() }
      fakeWindow.emit('close', event)

      // Pending was cleared, so this is a fresh prompt — not a force-quit.
      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(fakeWindow.webContents.send).toHaveBeenCalledWith(MigrationIpcChannels.ConfirmClose)
      expect(requester).not.toHaveBeenCalled()
    })
  })
})
