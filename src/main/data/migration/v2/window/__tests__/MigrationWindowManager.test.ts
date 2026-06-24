import { MigrationIpcChannels, type MigrationStage } from '@shared/data/migration/v2/types'
import { app, BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MigrationWindowManager } from '../MigrationWindowManager'

type FakeWindow = ReturnType<typeof makeFakeWindow>

/**
 * Minimal BrowserWindow stand-in. Captures `on(event, cb)` handlers so tests can drive the
 * native `close` event, and records the imperative calls the manager makes on the window.
 */
function makeFakeWindow() {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  return {
    show: vi.fn(),
    minimize: vi.fn(),
    // Faithful to Electron: `close()` synchronously emits the `'close'` event. This lets the
    // programmatic-close guard path actually run in tests (e.g. during confirmQuit()).
    close: vi.fn(() => handlers['close']?.({ preventDefault: vi.fn() })),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    once: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb
    }),
    webContents: { isLoading: () => false, once: vi.fn(), send: vi.fn() },
    emit: (event: string, ...args: unknown[]) => handlers[event]?.(...args)
  }
}

describe('MigrationWindowManager', () => {
  let manager: MigrationWindowManager
  let fakeWindow: FakeWindow
  let quitMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWindow = makeFakeWindow()
    vi.mocked(BrowserWindow).mockImplementation(() => fakeWindow as unknown as BrowserWindow)
    // The global electron mock's `app` has no `quit`; provide one to observe quit attempts.
    quitMock = vi.fn()
    ;(app as unknown as { quit: typeof quitMock }).quit = quitMock
    manager = new MigrationWindowManager()
    manager.create()
  })

  it('minimizes the current window', () => {
    manager.minimize()
    expect(fakeWindow.minimize).toHaveBeenCalledTimes(1)
  })

  // Entry page (introduction is the default stage) + terminal pages: close quits immediately.
  it.each<MigrationStage>(['introduction', 'completed', 'error', 'version_incompatible'])(
    'quits immediately when the window is closed at the %s stage',
    (stage) => {
      manager.setStage(stage)
      const event = { preventDefault: vi.fn() }
      fakeWindow.emit('close', event)

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(fakeWindow.webContents.send).not.toHaveBeenCalled()
      expect(quitMock).toHaveBeenCalledTimes(1)
    }
  )

  // In-flow stages: close is intercepted so the renderer can confirm before quitting.
  it.each<MigrationStage>(['backup_required', 'backup_progress', 'backup_confirmed', 'migration'])(
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
    manager.setStage('backup_progress')
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
})
