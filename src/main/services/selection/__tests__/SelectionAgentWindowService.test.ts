import type { Rectangle } from 'electron'
import { screen } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @application, electron, and @logger are globally mocked in tests/main.setup.ts.
import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { AgentSelectionAction } from '@shared/types/selection'

vi.mock('@main/core/platform', () => ({ isDev: false, isLinux: false, isMac: false, isWin: true }))

const { SelectionAgentWindowService } = await import('../SelectionAgentWindowService')

const WORK_AREA = { x: 0, y: 0, width: 1440, height: 900 }
const TOOLBAR = { x: 400, y: 100, width: 240, height: 40 }
const ASK_AGENT: AgentSelectionAction = { id: 'ask-agent', name: 'Ask Agent', enabled: true, isBuiltIn: true }
const RESEARCH: AgentSelectionAction = {
  id: 'user-1',
  name: 'Research',
  enabled: true,
  isBuiltIn: false,
  runner: 'agent',
  agentId: 'agent-1'
}

function createWindow() {
  let bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
  const mockWindow = {
    zoomFactor: 1,
    webContents: {
      getZoomFactor: () => mockWindow.zoomFactor
    },
    resizable: true,
    visible: false,
    getBounds: () => bounds,
    setBounds: (next: Rectangle) => {
      bounds = next
    },
    setResizable(this: { resizable: boolean }, value: boolean) {
      this.resizable = value
    },
    setMinimumSize: vi.fn(),
    show(this: { visible: boolean }) {
      this.visible = true
    },
    isVisible(this: { visible: boolean }) {
      return this.visible
    },
    isDestroyed: () => false
  }
  return mockWindow
}

describe('SelectionAgentWindowService', () => {
  let window: ReturnType<typeof createWindow>
  let svc: InstanceType<typeof SelectionAgentWindowService>

  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    window = createWindow()
    const wm = application.get('WindowManager') as unknown as { getWindow: ReturnType<typeof vi.fn> }
    wm.getWindow.mockReturnValue(window)
    Object.assign(screen, {
      getDisplayMatching: vi.fn(() => ({ workArea: WORK_AREA })),
      getDisplayNearestPoint: vi.fn(() => ({ workArea: WORK_AREA })),
      getCursorScreenPoint: vi.fn(() => ({ x: 500, y: 400 }))
    })
    svc = new SelectionAgentWindowService()
  })

  afterEach(() => {
    BaseService.resetInstances()
    vi.restoreAllMocks()
  })

  it('opens Ask Agent as a fixed-size compose bar under the toolbar', () => {
    svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })

    expect(window.getBounds()).toEqual({ x: 240, y: 100, width: 560, height: 160 })
    expect(window.resizable).toBe(false)
    expect(window.visible).toBe(true)
  })

  it('opens an agent-bound custom action straight into a resizable conversation window', () => {
    svc.open(RESEARCH, { anchor: null, isFullScreen: false })

    expect(window.getBounds()).toEqual({ x: 440, y: 140, width: 560, height: 620 })
    expect(window.resizable).toBe(true)
  })

  it('fits the compose bar to its content, then expands it once into the conversation window', () => {
    svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })

    svc.resize('mock-window-id', { mode: 'compose', height: 212.4 })
    expect(window.getBounds()).toEqual({ x: 240, y: 100, width: 560, height: 213 })

    svc.resize('mock-window-id', { mode: 'conversation' })
    expect(window.getBounds()).toEqual({ x: 240, y: 100, width: 560, height: 620 })
    expect(window.resizable).toBe(true)

    // A late compose measurement must not shrink the conversation the user is reading.
    svc.resize('mock-window-id', { mode: 'compose', height: 180 })
    expect(window.getBounds().height).toBe(620)
  })

  it('scales the measured compose height by the page zoom', () => {
    window.zoomFactor = 1.25
    svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })

    svc.resize('mock-window-id', { mode: 'compose', height: 200 })

    expect(window.getBounds().height).toBe(250)
  })

  describe('next selection trigger', () => {
    let windows: Record<string, ReturnType<typeof createWindow>>
    let wm: { open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      windows = { w1: createWindow(), w2: createWindow() }
      wm = application.get('WindowManager') as unknown as typeof wm
      ;(
        application.get('WindowManager') as unknown as { getWindow: ReturnType<typeof vi.fn> }
      ).getWindow.mockImplementation((id: string) => windows[id])
      wm.close.mockImplementation((id: string) => {
        windows[id].visible = false
        return true
      })
    })

    it('closes the windows that hold nothing to lose and keeps the rest', () => {
      wm.open.mockReturnValueOnce('w1').mockReturnValueOnce('w2').mockReturnValueOnce('w3')
      svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })
      svc.open(RESEARCH, { anchor: TOOLBAR, isFullScreen: false })
      svc.setReplaceable('w1', true)
      svc.setReplaceable('w2', true)
      svc.setReplaceable('w2', false)

      svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })

      expect(wm.close.mock.calls).toEqual([['w1']])
      expect(wm.close.mock.invocationCallOrder[0]).toBeLessThan(wm.open.mock.invocationCallOrder[2])
    })

    it('leaves a window alone once it is back in the pool', () => {
      wm.open.mockReturnValueOnce('w1').mockReturnValueOnce('w2')
      svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })
      svc.setReplaceable('w1', true)
      windows.w1.visible = false

      svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })

      expect(wm.close).not.toHaveBeenCalled()
    })

    it('ignores replaceable reports from windows it did not open', () => {
      wm.open.mockReturnValueOnce('w1')
      svc.setReplaceable('w2', true)
      windows.w2.visible = true

      svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })

      expect(wm.close).not.toHaveBeenCalled()
    })

    it('does not carry a recycled window over to its next content', () => {
      wm.open.mockReturnValue('w1')
      svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })
      svc.setReplaceable('w1', true)
      // Replaced: the pool hands the same window back for the new action.
      svc.open(RESEARCH, { anchor: TOOLBAR, isFullScreen: false })
      wm.close.mockClear()

      svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })

      expect(wm.close).not.toHaveBeenCalled()
    })
  })

  it('ignores layout requests from windows it did not open', () => {
    svc.resize('other-window', { mode: 'conversation' })

    expect(window.getBounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})
