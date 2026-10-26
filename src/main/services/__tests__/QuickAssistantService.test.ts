import { type Rectangle, screen } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

const { appGetMock, screenshotSessionRequestedByMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  screenshotSessionRequestedByMock: vi.fn()
}))

const platform = vi.hoisted(() => ({ isLinux: false }))

vi.mock('@main/core/platform', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isLinux() {
    return platform.isLinux
  }
}))

vi.mock('@application', () => ({
  application: { get: appGetMock }
}))

import { QuickAssistantService } from '../QuickAssistantService'

type WindowListener = () => void

const createWindow = () => {
  const listeners = new Map<string, WindowListener>()
  return {
    listeners,
    window: {
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, listener: WindowListener) => listeners.set(event, listener)),
      removeListener: vi.fn(),
      webContents: {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn()
      }
    }
  }
}

const setupQuickAssistant = (service: QuickAssistantService, window: ReturnType<typeof createWindow>['window']) =>
  (
    service as unknown as {
      setupQuickAssistant: (windowId: string, target: typeof window) => void
    }
  ).setupQuickAssistant('quick-assistant-window', window)

/** One poll tick, with margin — the poll runs on a 200ms interval. */
const POLL_TICKS_MS = 250

/** Arm the post-unpin focus poll against a window in the given focus state. */
const startUnpinPoll = (service: QuickAssistantService, state: { isFocused: boolean }) => {
  const internals = service as unknown as {
    windowId: string | null
    isPinnedQuickAssistant: boolean
    getQuickAssistant: () => unknown
    startPostUnpinFocusPoll: () => void
  }
  internals.windowId = 'quick-assistant-window'
  internals.isPinnedQuickAssistant = false
  internals.getQuickAssistant = () => ({
    isDestroyed: () => false,
    isVisible: () => true,
    isFocused: () => state.isFocused
  })
  internals.startPostUnpinFocusPoll()
}

describe('QuickAssistantService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    vi.useFakeTimers()
    appGetMock.mockImplementation((name: string) => {
      if (name === 'ScreenshotOverlayService') return { isSessionRequestedBy: screenshotSessionRequestedByMock }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  it('keeps the quick assistant visible while it owns a capture session', () => {
    const service = new QuickAssistantService()
    const hideQuickAssistant = vi.spyOn(service, 'hideQuickAssistant').mockImplementation(() => {})
    const { listeners, window } = createWindow()
    screenshotSessionRequestedByMock.mockReturnValue(true)

    setupQuickAssistant(service, window)
    listeners.get('blur')?.()

    // Asked with the id this window was created with — `this.windowId` is only assigned
    // after open() returns, so a guard reading it would skip the check entirely.
    expect(screenshotSessionRequestedByMock).toHaveBeenCalledWith('quick-assistant-window')
    expect(hideQuickAssistant).not.toHaveBeenCalled()
  })

  it('keeps the quick assistant visible while it owns a capture session during the unpin poll', () => {
    const service = new QuickAssistantService()
    const hideQuickAssistant = vi.spyOn(service, 'hideQuickAssistant').mockImplementation(() => {})
    screenshotSessionRequestedByMock.mockReturnValue(true)
    // The overlay holds focus during a capture, so the poll's own focus check reads false
    // — without the ownership exemption it hides the window taking the screenshot.
    startUnpinPoll(service, { isFocused: false })

    vi.advanceTimersByTime(POLL_TICKS_MS)

    expect(hideQuickAssistant).not.toHaveBeenCalled()
    // Still armed: the capture ends, focus returns, and a later outside click must hide.
    screenshotSessionRequestedByMock.mockReturnValue(false)
    vi.advanceTimersByTime(POLL_TICKS_MS)
    expect(hideQuickAssistant).toHaveBeenCalled()
  })

  it('hides during the unpin poll when focus is lost without a capture of its own', () => {
    const service = new QuickAssistantService()
    const hideQuickAssistant = vi.spyOn(service, 'hideQuickAssistant').mockImplementation(() => {})
    screenshotSessionRequestedByMock.mockReturnValue(false)
    startUnpinPoll(service, { isFocused: false })

    vi.advanceTimersByTime(POLL_TICKS_MS)

    expect(hideQuickAssistant).toHaveBeenCalled()
  })

  it('hides on blur when the capture session belongs to another window', () => {
    const service = new QuickAssistantService()
    const hideQuickAssistant = vi.spyOn(service, 'hideQuickAssistant').mockImplementation(() => {})
    const { listeners, window } = createWindow()
    screenshotSessionRequestedByMock.mockReturnValue(false)

    setupQuickAssistant(service, window)
    listeners.get('blur')?.()

    // Someone else's capture is an ordinary focus loss.
    expect(hideQuickAssistant).toHaveBeenCalled()
  })

  it('summons the quick assistant at the bottom center of the cursor display', () => {
    Object.assign(screen, {
      getCursorScreenPoint: vi.fn(() => ({ x: 900, y: 700 })),
      getDisplayNearestPoint: vi.fn(() => ({
        id: 2,
        workArea: { x: 100, y: 50, width: 1440, height: 900 }
      }))
    })
    const service = new QuickAssistantService()
    const window = {
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 680, height: 64 })),
      setBounds: vi.fn(),
      setPosition: vi.fn()
    }

    ;(
      service as unknown as {
        positionAtCursorDisplayBottom: (target: typeof window) => void
      }
    ).positionAtCursorDisplayBottom(window)

    expect(window.setPosition).toHaveBeenCalledWith(480, 870, false)
    expect(window.setBounds).toHaveBeenCalledWith({ x: 480, y: 870, width: 680, height: 64 })
  })

  it('keeps the bottom edge fixed while the composer grows', () => {
    Object.assign(screen, {
      getDisplayMatching: vi.fn(() => ({
        id: 2,
        workArea: { x: 100, y: 50, width: 1440, height: 900 }
      }))
    })
    const service = new QuickAssistantService()
    const window = {
      getBounds: vi.fn(() => ({ x: 480, y: 870, width: 680, height: 64 }))
    }

    const resized = (
      service as unknown as {
        resolveBoundsForHeight: (target: typeof window, height: number) => Rectangle
      }
    ).resolveBoundsForHeight(window, 200)

    expect(resized).toEqual({ x: 480, y: 734, width: 680, height: 200 })
  })

  it('uses a native shadow only for the opaque conversation panel surface', () => {
    Object.assign(screen, {
      getDisplayMatching: vi.fn(() => ({
        id: 2,
        workArea: { x: 100, y: 50, width: 1440, height: 900 }
      }))
    })
    const window = {
      isDestroyed: vi.fn(() => false),
      getBounds: vi.fn(() => ({ x: 480, y: 354, width: 680, height: 580 })),
      setBounds: vi.fn(),
      setHasShadow: vi.fn()
    }
    appGetMock.mockImplementation((name: string) => {
      if (name === 'WindowManager') return { getWindow: () => window }
      if (name === 'ScreenshotOverlayService') return { isSessionRequestedBy: screenshotSessionRequestedByMock }
      throw new Error(`Unexpected application.get(${name})`)
    })
    const service = new QuickAssistantService()
    ;(service as unknown as { windowId: string }).windowId = 'quick-assistant'

    service.setView({ view: 'panel', contentHeight: 560, animate: false })
    service.setView({ view: 'quick-panel', contentHeight: 560, animate: false })
    service.setView({ view: 'bar', contentHeight: 44, animate: false })

    expect(window.setHasShadow).toHaveBeenNthCalledWith(1, true)
    expect(window.setHasShadow).toHaveBeenNthCalledWith(2, false)
    expect(window.setHasShadow).toHaveBeenNthCalledWith(3, false)
  })

  /** A window whose bounds follow setBounds, and whose listeners the test can fire. */
  const createResizableWindow = (height: number) => {
    const { listeners, window } = createWindow()
    let bounds = { x: 480, y: 900 - height, width: 680, height }
    const resizable = Object.assign(window, {
      getBounds: vi.fn(() => bounds),
      setBounds: vi.fn((next: typeof bounds) => {
        bounds = next
      }),
      setHasShadow: vi.fn()
    })
    appGetMock.mockImplementation((name: string) => {
      if (name === 'WindowManager') return { getWindow: () => resizable }
      if (name === 'ScreenshotOverlayService') return { isSessionRequestedBy: screenshotSessionRequestedByMock }
      throw new Error(`Unexpected application.get(${name})`)
    })
    return {
      listeners,
      window: resizable,
      userResize: (next: number) => {
        bounds = { ...bounds, y: bounds.y + bounds.height - next, height: next }
        listeners.get('resize')?.()
      }
    }
  }

  it('keeps a panel height the user dragged to on Linux, where Electron has no resized event', () => {
    platform.isLinux = true
    Object.assign(screen, {
      getDisplayMatching: vi.fn(() => ({ id: 2, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }))
    })
    const { window, userResize } = createResizableWindow(560)
    const service = new QuickAssistantService()
    setupQuickAssistant(service, window)
    ;(service as unknown as { windowId: string }).windowId = 'quick-assistant-window'
    try {
      service.setView({ view: 'panel', contentHeight: 560, animate: false })
      userResize(700)

      // A multiline draft grows the composer, which re-reports the panel view.
      service.setView({ view: 'panel', contentHeight: 560, animate: false })

      expect(window.getBounds().height).toBe(700)
    } finally {
      platform.isLinux = false
    }
  })

  it("does not take its own resize for the user's on Linux", () => {
    platform.isLinux = true
    Object.assign(screen, {
      getDisplayMatching: vi.fn(() => ({ id: 2, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }))
    })
    const { listeners, window } = createResizableWindow(560)
    const service = new QuickAssistantService()
    setupQuickAssistant(service, window)
    ;(service as unknown as { windowId: string }).windowId = 'quick-assistant-window'
    try {
      service.setView({ view: 'panel', contentHeight: 560, animate: false })
      // Linux reports our own setBounds through the same event.
      listeners.get('resize')?.()

      service.setView({ view: 'panel', contentHeight: 600, animate: false })

      expect(window.getBounds().height).toBe(600)
    } finally {
      platform.isLinux = false
    }
  })

  it('does not replace the collapsed bar height while a quick panel is open', () => {
    Object.assign(screen, {
      getDisplayMatching: vi.fn(() => ({
        id: 2,
        workArea: { x: 100, y: 50, width: 1440, height: 900 }
      }))
    })
    const window = {
      isDestroyed: vi.fn(() => false),
      getBounds: vi.fn(() => ({ x: 480, y: 799, width: 680, height: 135 })),
      setBounds: vi.fn(),
      setHasShadow: vi.fn()
    }
    appGetMock.mockImplementation((name: string) => {
      if (name === 'WindowManager') return { getWindow: () => window }
      if (name === 'ScreenshotOverlayService') return { isSessionRequestedBy: screenshotSessionRequestedByMock }
      throw new Error(`Unexpected application.get(${name})`)
    })
    const service = new QuickAssistantService()
    ;(service as unknown as { windowId: string }).windowId = 'quick-assistant'

    service.setView({ view: 'bar', contentHeight: 135, animate: false })
    service.setView({ view: 'quick-panel', contentHeight: 560, animate: false })
    expect(window.setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ height: 560 }))
    // The transparent expansion is scratch space for a tool menu, so it must not become
    // the height the bar is restored to.
    expect((service as unknown as { barHeight: number }).barHeight).toBe(135)

    service.setView({ view: 'bar', contentHeight: 135, animate: false })
    expect(window.setBounds).toHaveBeenLastCalledWith(expect.objectContaining({ height: 135 }))
    // Only the panel height is remembered across a drag; quick-panel leaves no trace.
    expect((service as unknown as { lastPanelHeight: number | null }).lastPanelHeight).toBeNull()
  })
})
