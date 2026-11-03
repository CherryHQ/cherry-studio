import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import type { Rectangle } from 'electron'
import { screen, systemPreferences } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @application, electron, and @logger are globally mocked in tests/main.setup.ts.
import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { WindowType } from '@main/core/window/types'
import type { AgentSelectionAction, SelectionAgentSummary } from '@shared/types/selection'

const platform = vi.hoisted(() => ({ isMac: false }))
vi.mock('@main/core/platform', () => ({
  isDev: false,
  isLinux: false,
  get isMac() {
    return platform.isMac
  },
  get isWin() {
    return !platform.isMac
  }
}))
const native = vi.hoisted(() => ({
  configurePanel: vi.fn(),
  moveToActiveSpace: vi.fn(),
  setMiniaturizeHandler: vi.fn(),
  interceptMiniaturize: vi.fn(),
  isFullScreenAppInFront: vi.fn(),
  animateWindow: vi.fn()
}))
vi.mock('../selectionNativePanel', () => ({ getSelectionNativePanel: () => native }))

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

let nextHandle = 0

function createWindow() {
  let bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 }
  const handle = Buffer.from([++nextHandle])
  const mockWindow = {
    handle,
    getNativeWindowHandle: () => handle,
    opacity: 1,
    setOpacity(this: { opacity: number }, value: number) {
      this.opacity = value
    },
    setAlwaysOnTop: vi.fn(),
    focus: vi.fn(),
    zoomFactor: 1,
    webContents: {
      getZoomFactor: () => mockWindow.zoomFactor
    },
    resizable: true,
    minimizable: true,
    visible: false,
    getBounds: () => bounds,
    setBounds: (next: Rectangle) => {
      bounds = next
    },
    setResizable(this: { resizable: boolean }, value: boolean) {
      this.resizable = value
    },
    setMinimumSize: vi.fn(),
    setMinimizable(this: { minimizable: boolean }, value: boolean) {
      this.minimizable = value
    },
    setFocusable: vi.fn(),
    show(this: { visible: boolean }) {
      this.visible = true
    },
    showInactive(this: { visible: boolean }) {
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
    expect(window.minimizable).toBe(false)
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
    expect(window.minimizable).toBe(true)

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

  describe('capsules', () => {
    const SECOND_WORK_AREA = { x: 1440, y: 0, width: 1920, height: 1080 }
    const DISPLAYS = [
      { id: 1, bounds: WORK_AREA, workArea: WORK_AREA },
      { id: 2, bounds: SECOND_WORK_AREA, workArea: SECOND_WORK_AREA }
    ]
    const RUNNING: SelectionAgentSummary = { agentName: 'Research', agentAvatar: '🔎', status: 'running', steps: 2 }
    let windows: Record<string, ReturnType<typeof createWindow>>
    let displays: typeof DISPLAYS
    let wm: {
      open: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
      hide: ReturnType<typeof vi.fn>
      getWindow: ReturnType<typeof vi.fn>
    }

    /** Opens an agent-bound custom action on the given display and reports its summary. */
    function openStarted(id: string, summary: SelectionAgentSummary = RUNNING, display = 1) {
      windows[id] = createWindow()
      wm.open.mockReturnValueOnce(id)
      svc.open(RESEARCH, { anchor: null, isFullScreen: false })
      if (display === 2) windows[id].setBounds({ ...windows[id].getBounds(), x: 2000 })
      svc.setSummary(id, summary)
    }

    const stack = (displayId: number) =>
      MockMainCacheServiceUtils.getSharedCacheValue(`selection.agent_capsules.${displayId}`)
    const hostFor = (displayId: number) =>
      wm.open.mock.calls.findIndex(
        ([type, args]) => type === WindowType.SelectionCapsule && args.initData.displayId === displayId
      )

    beforeEach(() => {
      MockMainCacheServiceUtils.resetMocks()
      windows = {}
      displays = DISPLAYS
      let hosts = 0
      wm = application.get('WindowManager') as unknown as typeof wm
      wm.getWindow.mockImplementation((id: string) => windows[id])
      wm.open.mockImplementation((type: WindowType) => {
        if (type !== WindowType.SelectionCapsule) return 'unexpected'
        const id = `host-${++hosts}`
        windows[id] = createWindow()
        return id
      })
      wm.hide.mockImplementation((id: string) => {
        windows[id].visible = false
        return true
      })
      wm.close.mockImplementation((id: string) => {
        windows[id].visible = false
        return true
      })
      Object.assign(screen, {
        getAllDisplays: vi.fn(() => displays),
        getPrimaryDisplay: vi.fn(() => displays[0]),
        getDisplayMatching: vi.fn((bounds: Rectangle) => (bounds.x >= 1440 ? DISPLAYS[1] : DISPLAYS[0])),
        on: vi.fn(),
        removeListener: vi.fn()
      })
    })

    it('collapses a started window into a capsule and restores it from there', () => {
      openStarted('w1')

      svc.collapse('w1')

      expect(windows.w1.visible).toBe(false)
      expect(stack(1)).toEqual([{ ...RUNNING, windowId: 'w1' }])

      svc.restore('host-1', 'w1')

      expect(windows.w1.visible).toBe(true)
      expect(stack(1)).toEqual([])
      expect(wm.close).toHaveBeenCalledWith('host-1')
    })

    it('keeps the compose bar, and a window with nothing to show yet, from collapsing', () => {
      windows.w1 = createWindow()
      wm.open.mockReturnValueOnce('w1')
      svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })
      svc.setSummary('w1', RUNNING)
      windows.w2 = createWindow()
      wm.open.mockReturnValueOnce('w2')
      svc.open(RESEARCH, { anchor: null, isFullScreen: false })

      svc.collapse('w1')
      svc.collapse('w2')

      expect(windows.w1.visible).toBe(true)
      expect(windows.w2.visible).toBe(true)
      expect(hostFor(1)).toBe(-1)
    })

    it('stacks capsules per display, with what waits on the user nearest the corner', () => {
      openStarted('running')
      openStarted('done', { ...RUNNING, status: 'done' })
      openStarted('approval', { ...RUNNING, status: 'awaiting-approval' })
      openStarted('elsewhere', RUNNING, 2)
      for (const id of ['done', 'running', 'approval', 'elsewhere']) svc.collapse(id)

      expect(stack(1)?.map((capsule) => capsule.windowId)).toEqual(['approval', 'running', 'done'])
      expect(stack(2)?.map((capsule) => capsule.windowId)).toEqual(['elsewhere'])
      expect(hostFor(1)).not.toBe(-1)
      expect(hostFor(2)).not.toBe(-1)
    })

    it('keeps a collapsed capsule current as the turn moves on', () => {
      openStarted('w1')
      svc.collapse('w1')

      svc.setSummary('w1', { ...RUNNING, status: 'awaiting-approval', steps: 3 })

      expect(stack(1)).toEqual([{ ...RUNNING, status: 'awaiting-approval', steps: 3, windowId: 'w1' }])
    })

    it('anchors the host to the bottom-right of the work area at its measured size', () => {
      openStarted('w1')
      svc.collapse('w1')
      windows['host-1'].zoomFactor = 1.25

      svc.fitCapsuleHost('host-1', { width: 200, height: 100 })

      expect(windows['host-1'].getBounds()).toEqual({ x: 1440 - 4 - 250, y: 900 - 4 - 125, width: 250, height: 125 })
      expect(windows['host-1'].visible).toBe(true)
    })

    it('fits a stack taller than the work area inside it, so every capsule stays on screen', () => {
      openStarted('w1')
      svc.collapse('w1')

      svc.fitCapsuleHost('host-1', { width: 200, height: 1108 })

      expect(windows['host-1'].getBounds()).toEqual({ x: 1440 - 4 - 200, y: 4, width: 200, height: 900 - 8 })
    })

    it('closes a window from its capsule, leaving no capsule behind', () => {
      openStarted('w1')
      svc.collapse('w1')

      svc.closeCollapsed('host-1', 'w1')

      expect(wm.close).toHaveBeenCalledWith('w1')
      expect(stack(1)).toEqual([])
    })

    it('ignores the blur that hiding a collapsed window causes', () => {
      openStarted('w1', { ...RUNNING, status: 'done' })
      svc.collapse('w1')

      svc.dismissBlurred('w1', 'close')

      expect(wm.close).not.toHaveBeenCalledWith('w1')
      expect(stack(1)?.map((capsule) => capsule.windowId)).toEqual(['w1'])
    })

    it('keeps open a window that something else hid, as a screenshot from its composer does', () => {
      openStarted('w1', { ...RUNNING, status: 'done' })
      // The screenshot hides it, which blurs it, and shows it again when it ends.
      windows.w1.visible = false

      svc.dismissBlurred('w1', 'close')

      expect(wm.close).not.toHaveBeenCalledWith('w1')
    })

    it('lets only the host showing a capsule restore or close its window', () => {
      openStarted('w1')
      openStarted('w2', RUNNING, 2)
      svc.collapse('w1')
      svc.collapse('w2')

      svc.restore('host-2', 'w1')
      svc.closeCollapsed('w1', 'w2')

      expect(windows.w1.visible).toBe(false)
      expect(wm.close).not.toHaveBeenCalledWith('w2')
    })

    it('never replaces a collapsed window, but can once it is restored', () => {
      openStarted('w1', { ...RUNNING, status: 'done' })
      svc.setReplaceable('w1', true)
      svc.collapse('w1')
      openStarted('w2')
      expect(wm.close).not.toHaveBeenCalledWith('w1')

      svc.restore('host-1', 'w1')
      openStarted('w3')

      expect(wm.close).toHaveBeenCalledWith('w1')
    })

    it('moves the capsules of a removed display to the primary one', async () => {
      await svc._doInit()
      openStarted('w1', RUNNING, 2)
      svc.collapse('w1')
      // The service re-reads the displays, so the listener's arguments do not matter.
      const onDisplayRemoved = vi.mocked(screen.on).mock.calls.find(([event]) => event === 'display-removed')?.[1] as
        | (() => void)
        | undefined

      displays = [DISPLAYS[0]]
      onDisplayRemoved?.()

      expect(stack(1)?.map((capsule) => capsule.windowId)).toEqual(['w1'])
      expect(stack(2)).toEqual([])
    })

    it('gives a capsule back to its display when that display returns, restorable from there', async () => {
      await svc._doInit()
      openStarted('w1', { ...RUNNING, status: 'done' }, 2)
      svc.collapse('w1')
      const listener = (event: string) =>
        vi.mocked(screen.on).mock.calls.find(([name]) => name === event)?.[1] as (() => void) | undefined

      displays = [DISPLAYS[0]]
      listener('display-removed')?.()
      displays = DISPLAYS
      listener('display-added')?.()

      expect(stack(1)).toEqual([])
      expect(stack(2)?.map((capsule) => capsule.windowId)).toEqual(['w1'])
      // host-1 left with the display, and host-2 held the capsule on the primary one meanwhile.
      svc.restore('host-3', 'w1')
      expect(windows.w1.visible).toBe(true)
    })

    describe('on macOS', () => {
      let behavior: { hideMacDockWhileShown: ReturnType<typeof vi.fn> }
      const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
      const lastAnimation = () => native.animateWindow.mock.calls.at(-1)?.slice(1)
      /** Moves the window as the native animation would once it ends. */
      const land = (handle: Buffer, target: Rectangle, opacity: number) => {
        const window = Object.values(windows).find((candidate) => candidate.handle.equals(handle))
        window?.setBounds(target)
        if (window) window.opacity = opacity
      }

      beforeEach(() => {
        platform.isMac = true
        native.isFullScreenAppInFront.mockReturnValue(false)
        native.animateWindow.mockImplementation(async (handle: Buffer, target: Rectangle, opacity: number) =>
          land(handle, target, opacity)
        )
        Object.assign(systemPreferences, { getAnimationSettings: vi.fn(() => ({ prefersReducedMotion: false })) })
        behavior = { hideMacDockWhileShown: vi.fn() }
        Object.assign(wm, { behavior })
      })

      afterEach(() => {
        platform.isMac = false
      })

      it('collapses the agent window whose yellow light or Cmd+M was used', async () => {
        await svc._doInit()
        openStarted('w1')
        openStarted('w2')
        const manager = wm as unknown as {
          getWindowsByType: ReturnType<typeof vi.fn>
          getWindowId: ReturnType<typeof vi.fn>
        }
        manager.getWindowsByType.mockReturnValue([windows.w1, windows.w2])
        manager.getWindowId.mockImplementation((window) => (window === windows.w1 ? 'w1' : 'w2'))
        const onMiniaturize = native.setMiniaturizeHandler.mock.calls[0][0] as (handle: Buffer) => void

        onMiniaturize(Buffer.from(windows.w2.handle))
        await settle()

        expect(windows.w1.visible).toBe(true)
        expect(windows.w2.visible).toBe(false)
        expect(stack(1)?.map((capsule) => capsule.windowId)).toEqual(['w2'])
      })

      it('shrinks toward the corner before the capsule appears, then hides at its own bounds', async () => {
        let finish = () => undefined as void
        native.animateWindow.mockImplementationOnce(
          (handle: Buffer, target: Rectangle, opacity: number) =>
            new Promise<void>((resolve) => {
              finish = () => {
                land(handle, target, opacity)
                resolve()
              }
            })
        )
        openStarted('w1')
        const bounds = windows.w1.getBounds()

        svc.collapse('w1')
        const [target, opacity] = lastAnimation() ?? []
        expect(target.x + target.width).toBeGreaterThan(WORK_AREA.width - 24)
        expect(target.y + target.height).toBeGreaterThan(WORK_AREA.height - 24)
        expect(opacity).toBe(0)
        expect(windows.w1.visible).toBe(true)
        // A turn that moves on mid-animation must not bring the capsule in early.
        svc.setSummary('w1', { ...RUNNING, steps: 3 })
        expect(hostFor(1)).toBe(-1)

        finish()
        await settle()

        expect(windows.w1.visible).toBe(false)
        expect(windows.w1.getBounds()).toEqual(bounds)
        expect(windows.w1.opacity).toBe(1)
        expect(stack(1)).toEqual([expect.objectContaining({ windowId: 'w1', steps: 3 })])
      })

      it('restores over a full-screen app on its capsule display with the Dock hidden again, growing back to its bounds', async () => {
        openStarted('w1')
        openStarted('w2', RUNNING, 2)
        const bounds = windows.w2.getBounds()
        svc.collapse('w1')
        await settle()
        svc.collapse('w2')
        await settle()
        // Both opened over a regular desktop, but the second display has since moved to a full-screen app.
        native.isFullScreenAppInFront.mockImplementation((display: Rectangle) => display.x === SECOND_WORK_AREA.x)

        svc.restore('host-1', 'w1')
        svc.restore('host-2', 'w2')
        await settle()

        expect(behavior.hideMacDockWhileShown).toHaveBeenCalledWith('w2')
        expect(behavior.hideMacDockWhileShown).not.toHaveBeenCalledWith('w1')
        expect(lastAnimation()).toEqual([bounds, 1, 200])
        expect(windows.w2.visible).toBe(true)
        expect(windows.w2.resizable).toBe(true)
      })

      it('switches instantly when the OS prefers reduced motion', () => {
        Object.assign(systemPreferences, { getAnimationSettings: vi.fn(() => ({ prefersReducedMotion: true })) })
        openStarted('w1')

        svc.collapse('w1')
        expect(windows.w1.visible).toBe(false)
        svc.restore('host-1', 'w1')

        expect(windows.w1.visible).toBe(true)
        expect(native.animateWindow).not.toHaveBeenCalled()
      })

      it('expands the compose bar with an animation, then lets the conversation resize and collapse', async () => {
        windows.w1 = createWindow()
        wm.open.mockReturnValueOnce('w1')
        svc.open(ASK_AGENT, { anchor: TOOLBAR, isFullScreen: false })

        svc.resize('w1', { mode: 'conversation' })
        expect(lastAnimation()).toEqual([{ x: 240, y: 100, width: 560, height: 620 }, 1, 200])
        await settle()

        expect(windows.w1.resizable).toBe(true)
        expect(windows.w1.minimizable).toBe(true)
      })
    })
  })
})
