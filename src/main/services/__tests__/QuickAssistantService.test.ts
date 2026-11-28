import { beforeEach, describe, expect, it, vi } from 'vitest'

const { platformState, applicationMock, windowManagerMock } = vi.hoisted(() => {
  const platformState = { isMac: false, isWin: false, isLinux: false }
  const windowManagerMock = {
    getWindow: vi.fn(),
    open: vi.fn(() => 'quick-id'),
    close: vi.fn(),
    onWindowCreatedByType: vi.fn(() => vi.fn())
  }
  const prefValues: Record<string, unknown> = { 'feature.quick_assistant.enabled': true }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'WindowManager') return windowManagerMock
      if (name === 'PreferenceService') {
        return {
          get: (key: string) => prefValues[key],
          subscribeChange: vi.fn(() => vi.fn())
        }
      }
      if (name === 'MainWindowService') {
        return { onMainWindowCreated: vi.fn(() => vi.fn()) }
      }
      if (name === 'IpcApiService') {
        return { send: vi.fn() }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
  }
  return { platformState, applicationMock, windowManagerMock }
})

vi.mock('@main/core/platform', () => ({
  get isMac() {
    return platformState.isMac
  },
  get isWin() {
    return platformState.isWin
  },
  get isLinux() {
    return platformState.isLinux
  }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))

vi.mock('@application', () => ({
  application: applicationMock
}))

vi.mock('@main/core/security/validateSender', () => ({
  isAppRendererUrl: vi.fn(() => true)
}))

vi.mock('../../utils/externalUrlSafety', () => ({
  isSafeExternalUrl: vi.fn(() => false)
}))

const { appHideMock } = vi.hoisted(() => ({
  appHideMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { hide: appHideMock },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null) },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: vi.fn(() => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }))
  }
}))

// Use the real BaseService so isActivated/_activated semantics hold; reset the
// singleton guard between tests.
import { BaseService } from '@main/core/lifecycle'

import { QuickAssistantService } from '../QuickAssistantService'

function createMockWindow(overrides: Record<string, unknown> = {}) {
  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    setOpacity: vi.fn(),
    minimize: vi.fn(),
    restore: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    blur: vi.fn(),
    focus: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 550, height: 400 })),
    setPosition: vi.fn(),
    setBounds: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    ...overrides
  }
}

describe('QuickAssistantService Windows hide/toggle (#23292)', () => {
  let svc: QuickAssistantService

  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    platformState.isMac = false
    platformState.isWin = true
    platformState.isLinux = false
    windowManagerMock.getWindow.mockReset()
    svc = new QuickAssistantService()
    // showQuickAssistant is gated on activation; tests drive hide/toggle directly.
    ;(svc as any)._activated = true
    ;(svc as any).windowId = 'quick-id'
  })

  it('hides with blur()+hide() on Windows so focus returns to the previous app', () => {
    const win = createMockWindow()
    windowManagerMock.getWindow.mockReturnValue(win)

    svc.hideQuickAssistant()

    expect(win.setOpacity).toHaveBeenCalledWith(0)
    expect(win.blur).toHaveBeenCalledTimes(1)
    expect(win.hide).toHaveBeenCalledTimes(1)
    expect(win.minimize).not.toHaveBeenCalled()
  })

  it('skips blur() when the window is already blurred (blur auto-hide path)', () => {
    const win = createMockWindow({ isFocused: vi.fn(() => false) })
    windowManagerMock.getWindow.mockReturnValue(win)

    svc.hideQuickAssistant()

    expect(win.blur).not.toHaveBeenCalled()
    expect(win.hide).toHaveBeenCalledTimes(1)
    expect(win.minimize).not.toHaveBeenCalled()
  })

  it('toggle hides a visible, non-minimized window', () => {
    const win = createMockWindow()
    windowManagerMock.getWindow.mockReturnValue(win)

    svc.toggleQuickAssistant()

    expect(win.hide).toHaveBeenCalledTimes(1)
  })

  it('toggle re-shows a minimized window instead of hiding again (isVisible stays true while minimized)', () => {
    const win = createMockWindow({
      isVisible: vi.fn(() => true),
      isMinimized: vi.fn(() => true)
    })
    windowManagerMock.getWindow.mockReturnValue(win)

    svc.toggleQuickAssistant()

    // Must go through show path (which recovers opacity/position), not hide again.
    expect(win.hide).not.toHaveBeenCalled()
    expect(win.minimize).not.toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
    expect(win.setOpacity).toHaveBeenCalledWith(1)
  })

  it('show recovers a legacy minimized window without restore() (multi-display scale bug)', () => {
    const win = createMockWindow({ isMinimized: vi.fn(() => true) })
    windowManagerMock.getWindow.mockReturnValue(win)
    ;(svc as any).mainWindowRef = null

    svc.showQuickAssistant()

    expect(win.setOpacity).toHaveBeenCalledWith(0)
    expect(win.show).toHaveBeenCalled()
    expect(win.restore).not.toHaveBeenCalled()
    expect(win.setOpacity).toHaveBeenCalledWith(1)
  })

  it('hide is a no-op when the window is already hidden (collapses re-entrant blur hide)', () => {
    const win = createMockWindow({ isVisible: vi.fn(() => false), isFocused: vi.fn(() => false) })
    windowManagerMock.getWindow.mockReturnValue(win)

    svc.hideQuickAssistant()

    expect(win.setOpacity).not.toHaveBeenCalled()
    expect(win.blur).not.toHaveBeenCalled()
    expect(win.hide).not.toHaveBeenCalled()
  })

  it('close delegates to the Windows hide path so focus is handed back', () => {
    const win = createMockWindow()
    windowManagerMock.getWindow.mockReturnValue(win)

    svc.closeQuickAssistant()

    expect(win.setOpacity).toHaveBeenCalledWith(0)
    expect(win.blur).toHaveBeenCalledTimes(1)
    expect(win.hide).toHaveBeenCalledTimes(1)
    expect(win.minimize).not.toHaveBeenCalled()
  })

  it('close on macOS uses plain hide without app.hide() (stale show-time focus must not hide settings)', () => {
    platformState.isWin = false
    platformState.isMac = true
    ;(process as any).getSystemVersion = vi.fn(() => '14.0.0')
    try {
      const win = createMockWindow()
      windowManagerMock.getWindow.mockReturnValue(win)
      // Stale show-time flag that would trigger app.hide() via hideQuickAssistant().
      ;(svc as any).wasMainWindowFocused = false

      svc.closeQuickAssistant()

      expect(win.hide).toHaveBeenCalledTimes(1)
      expect(appHideMock).not.toHaveBeenCalled()
    } finally {
      delete (process as any).getSystemVersion
    }
  })
})
