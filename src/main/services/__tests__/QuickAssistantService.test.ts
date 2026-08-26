import { BaseService } from '@main/core/lifecycle'
import { type Rectangle, screen } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, screenshotSessionRequestedByMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  screenshotSessionRequestedByMock: vi.fn()
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

describe('QuickAssistantService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
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

    expect((service as unknown as { barHeight: number }).barHeight).toBe(135)
  })
})
