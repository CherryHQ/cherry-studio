import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock `@application` BEFORE importing the handler under test, so the module-level
// `application.get('WindowManager')` lookup is captured here.
const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))

vi.mock('@application', () => ({ application: { get: appGetMock } }))

// WindowType is a value enum — import it directly; only the handler's branch on it is
// covered here. The MockBrowserWindow surface is intentionally minimal: close + isDestroyed.
import { windowHandlers } from '../window'

const ctx = { senderId: 'w1' }

const windowManager = {
  close: vi.fn(),
  getWindow: vi.fn(),
  getWindowType: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WindowManager') return windowManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('windowHandlers["window.close"]', () => {
  it('is a no-op when senderId is missing (detached devtools callers)', async () => {
    await windowHandlers['window.close'](undefined, { senderId: '' })
    expect(windowManager.close).not.toHaveBeenCalled()
    expect(windowManager.getWindowType).not.toHaveBeenCalled()
  })

  it('delegates to WindowManager.close() for non-Main window types', async () => {
    windowManager.getWindowType.mockReturnValue('quickAssistant')

    await windowHandlers['window.close'](undefined, ctx)

    expect(windowManager.getWindowType).toHaveBeenCalledWith('w1')
    expect(windowManager.close).toHaveBeenCalledWith('w1')
    expect(windowManager.getWindow).not.toHaveBeenCalled()
  })

  it('routes Main through native window.close() so MainWindowService tray-aware listener fires', async () => {
    // Regression for: clicking close on the frameless Main window left the app process
    // running on Windows because WindowManager.close() falls through to window.destroy()
    // for singletons without a singletonConfig — bypassing the 'close' event that
    // MainWindowService uses to honor the "minimize to tray on close" preference.
    windowManager.getWindowType.mockReturnValue('main')
    const close = vi.fn()
    const isDestroyed = vi.fn().mockReturnValue(false)
    windowManager.getWindow.mockReturnValue({ close, isDestroyed })

    await windowHandlers['window.close'](undefined, ctx)

    expect(windowManager.getWindowType).toHaveBeenCalledWith('w1')
    expect(windowManager.getWindow).toHaveBeenCalledWith('w1')
    expect(close).toHaveBeenCalledTimes(1)
    expect(isDestroyed).toHaveBeenCalled()
    // CRITICAL: WindowManager.close() must NOT be used for Main — that path destroys
    // the window and skips the close event entirely.
    expect(windowManager.close).not.toHaveBeenCalled()
  })

  it('skips native close when the Main BrowserWindow has already been destroyed', async () => {
    windowManager.getWindowType.mockReturnValue('main')
    const close = vi.fn()
    const isDestroyed = vi.fn().mockReturnValue(true)
    windowManager.getWindow.mockReturnValue({ close, isDestroyed })

    await windowHandlers['window.close'](undefined, ctx)

    expect(isDestroyed).toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(windowManager.close).not.toHaveBeenCalled()
  })

  it('skips native close when the Main BrowserWindow is missing from WindowManager', async () => {
    windowManager.getWindowType.mockReturnValue('main')
    windowManager.getWindow.mockReturnValue(undefined)

    await windowHandlers['window.close'](undefined, ctx)

    expect(windowManager.getWindow).toHaveBeenCalledWith('w1')
    expect(windowManager.close).not.toHaveBeenCalled()
  })
})
