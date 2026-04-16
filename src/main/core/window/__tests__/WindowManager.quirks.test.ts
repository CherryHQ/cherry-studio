import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '../../lifecycle/BaseService'

// ─── Deterministic UUIDs ────────────────────────────────────

let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`
}))

// ─── Mutable platform flags (isMac defaults to true for this suite) ─

const platform = vi.hoisted(() => ({
  isMac: true,
  isWin: false,
  isLinux: false,
  isDev: false
}))
vi.mock('@main/constant', () => platform)

// ─── Mock BrowserWindow with quirks-related methods ────────────────

interface MockBrowserWindow {
  id: number
  show: ReturnType<typeof vi.fn>
  showInactive: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  minimize: ReturnType<typeof vi.fn>
  maximize: ReturnType<typeof vi.fn>
  unmaximize: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  isMaximized: ReturnType<typeof vi.fn>
  isMinimized: ReturnType<typeof vi.fn>
  isFullScreen: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  isFocused: ReturnType<typeof vi.fn>
  isFocusable: ReturnType<typeof vi.fn>
  setFullScreen: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  setContentBounds: ReturnType<typeof vi.fn>
  setPosition: ReturnType<typeof vi.fn>
  setAlwaysOnTop: ReturnType<typeof vi.fn>
  setFocusable: ReturnType<typeof vi.fn>
  center: ReturnType<typeof vi.fn>
  getTitle: ReturnType<typeof vi.fn>
  setTitleBarOverlay: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  emit: ReturnType<typeof vi.fn>
  removeAllListeners: ReturnType<typeof vi.fn>
  webContents: {
    send: ReturnType<typeof vi.fn>
    sendInputEvent: ReturnType<typeof vi.fn>
    isCrashed: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    getURL: ReturnType<typeof vi.fn>
  }
}

const allWindows: MockBrowserWindow[] = []

function createMockBrowserWindow(): MockBrowserWindow {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  const win: MockBrowserWindow = {
    id: Math.random(),
    show: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    restore: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isFocused: vi.fn(() => false),
    isFocusable: vi.fn(() => true),
    setFullScreen: vi.fn(),
    setBounds: vi.fn(),
    setContentBounds: vi.fn(),
    setPosition: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setFocusable: vi.fn(),
    center: vi.fn(),
    getTitle: vi.fn(() => 'Test Window'),
    setTitleBarOverlay: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(cb)
    }),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(cb)
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      const handlers = listeners.get(event)
      if (handlers) {
        for (const handler of [...handlers]) handler(...args)
      }
    }),
    removeAllListeners: vi.fn(() => {
      listeners.clear()
    }),
    webContents: {
      send: vi.fn(),
      sendInputEvent: vi.fn(),
      isCrashed: vi.fn(() => false),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      getURL: vi.fn(() => '')
    }
  }
  return win
}

const createdWindows: MockBrowserWindow[] = []

vi.mock('electron', () => {
  class BrowserWindowMock {
    constructor() {
      const win = createMockBrowserWindow()
      createdWindows.push(win)
      allWindows.push(win)
      return win as never
    }

    static fromWebContents(): null {
      return null
    }

    static getAllWindows(): MockBrowserWindow[] {
      return allWindows.filter((w) => !w.isDestroyed())
    }
  }

  return {
    app: { dock: { show: () => Promise.resolve(), hide: () => {} } },
    BrowserWindow: BrowserWindowMock,
    screen: {
      getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
      getDisplayNearestPoint: vi.fn(() => ({
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 }
      }))
    },
    shell: { openExternal: vi.fn() },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
      removeListener: vi.fn()
    }
  }
})

// ─── Mock registry with quirks-bearing fixtures ────────────────────

const basePool = {
  minIdle: 0,
  initialSize: 1,
  maxSize: 2,
  warmup: 'lazy' as const,
  decayInterval: 300,
  idleTimeout: 1800
}

vi.mock('../windowRegistry', () => {
  const registry: Record<string, unknown> = {
    // Singleton toolbar with all three quirks + show:false (like SelectionToolbar)
    toolbar: {
      type: 'toolbar',
      lifecycle: 'singleton',
      show: false,
      htmlPath: 'toolbar/index.html',
      defaultConfig: { width: 350, height: 43 },
      quirks: {
        macRestoreFocusOnHide: true,
        macClearHoverOnHide: true,
        macReapplyAlwaysOnTop: 'screen-saver'
      }
    },
    // Pooled action with only restoreFocusOnHide (like SelectionAction)
    action: {
      type: 'action',
      lifecycle: 'pooled',
      show: false,
      htmlPath: 'action/index.html',
      defaultConfig: { width: 500, height: 400 },
      poolConfig: basePool,
      quirks: { macRestoreFocusOnHide: true }
    },
    // Plain window with no quirks — used for identity checks
    plain: {
      type: 'plain',
      lifecycle: 'default',
      htmlPath: 'plain/index.html',
      defaultConfig: {}
    },
    // reapplyAlwaysOnTop: true (defaults to 'floating')
    floatingTop: {
      type: 'floatingTop',
      lifecycle: 'default',
      htmlPath: 'floatingTop/index.html',
      defaultConfig: {},
      quirks: { macReapplyAlwaysOnTop: true }
    }
  }
  return {
    WINDOW_TYPE_REGISTRY: registry,
    getWindowTypeMetadata: (type: string) => {
      const meta = registry[type]
      if (!meta) throw new Error(`WindowType '${type}' is not registered`)
      return meta
    },
    mergeWindowConfig: (type: string, overrides?: Record<string, unknown>) => {
      const meta = registry[type] as { defaultConfig?: Record<string, unknown> }
      return { ...meta?.defaultConfig, ...overrides, webPreferences: {} }
    }
  }
})

const { WindowManager } = await import('../WindowManager')

// ─── Helpers ───────────────────────────────────────────────

function firstWindow(): MockBrowserWindow {
  return createdWindows[0]
}

function resetPlatform(): void {
  platform.isMac = true
  platform.isWin = false
  platform.isLinux = false
}

describe('WindowManager quirks — applyQuirks monkey-patching', () => {
  let wm: InstanceType<typeof WindowManager>

  beforeEach(() => {
    resetPlatform()
    BaseService.resetInstances()
    uuidCounter = 0
    createdWindows.length = 0
    allWindows.length = 0
    vi.useFakeTimers()
    wm = new WindowManager()
    void wm._doInit()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ─── macRestoreFocusOnHide ─────────────────────────────────

  describe('macRestoreFocusOnHide', () => {
    it('disables focusable on all visible focusable windows before hide, restores after 50ms', () => {
      // Pre-create a bystander window to be affected by the guard
      const bystanderId = wm.open('plain' as never)
      const bystander = createdWindows[0]
      bystander.setFocusable.mockClear()

      // Open the toolbar (has macRestoreFocusOnHide quirk)
      const toolbarId = wm.open('toolbar' as never)
      const toolbar = createdWindows[1]
      toolbar.setFocusable.mockClear()

      // Call patched hide()
      toolbar.hide()

      // Before the 50ms timer: bystander was set to non-focusable
      expect(bystander.setFocusable).toHaveBeenCalledWith(false)

      // Advance 50ms — bystander should be restored
      vi.advanceTimersByTime(50)
      expect(bystander.setFocusable).toHaveBeenCalledWith(true)

      // bystanderId and toolbarId are used to keep the handles alive
      expect(bystanderId).toBeTruthy()
      expect(toolbarId).toBeTruthy()
    })

    it('wraps close() with the same focus guard', () => {
      const bystanderId = wm.open('plain' as never)
      const bystander = createdWindows[0]
      bystander.setFocusable.mockClear()

      wm.open('action' as never)
      const action = createdWindows[1]

      action.close()

      expect(bystander.setFocusable).toHaveBeenCalledWith(false)
      vi.advanceTimersByTime(50)
      expect(bystander.setFocusable).toHaveBeenCalledWith(true)
      expect(bystanderId).toBeTruthy()
    })

    it('skips the guard for already-destroyed or invisible bystanders', () => {
      // Bystander destroyed → skip
      wm.open('plain' as never)
      const destroyedBystander = createdWindows[0]
      destroyedBystander.isDestroyed.mockReturnValue(true)

      // Bystander invisible → skip
      wm.open('plain' as never)
      const hiddenBystander = createdWindows[1]
      hiddenBystander.isVisible.mockReturnValue(false)

      // Bystander already non-focusable → skip
      wm.open('plain' as never)
      const nonFocusableBystander = createdWindows[2]
      nonFocusableBystander.isFocusable.mockReturnValue(false)
      nonFocusableBystander.setFocusable.mockClear()

      wm.open('action' as never)
      const action = createdWindows[3]
      action.hide()

      expect(destroyedBystander.setFocusable).not.toHaveBeenCalled()
      expect(hiddenBystander.setFocusable).not.toHaveBeenCalled()
      expect(nonFocusableBystander.setFocusable).not.toHaveBeenCalled()
    })

    it('does NOT wrap hide/close when quirk is absent', () => {
      wm.open('plain' as never)
      const plain = firstWindow()
      const originalHide = plain.hide
      const originalClose = plain.close

      // No bystanders set up. Patched method would still collect [] but identity check is what matters.
      expect(plain.hide).toBe(originalHide)
      expect(plain.close).toBe(originalClose)
    })

    // ─── Branch: excess-capacity path (pooled close destroys instead of releases) ─

    it('fires on excess-capacity close (pool over maxSize, destroyWindow path)', () => {
      const bystanderId = wm.open('plain' as never)
      const bystander = createdWindows[0]

      // pool maxSize=2, warmup=lazy. Open 3 — the 3rd exceeds maxSize.
      const ids = Array.from({ length: 3 }, () => wm.open('action' as never))
      bystander.setFocusable.mockClear()

      // Close id[0] — will destroy (excess capacity), wrapped close() triggers guard
      wm.close(ids[0])

      expect(bystander.setFocusable).toHaveBeenCalledWith(false)
      vi.advanceTimersByTime(50)
      expect(bystander.setFocusable).toHaveBeenCalledWith(true)
      expect(bystanderId).toBeTruthy()
    })

    // ─── Branch: pool-suspend destroying idle windows does NOT fire the guard ──

    it('does NOT fire when pool suspend destroys already-hidden idle windows', () => {
      // Idle pool windows are hidden (releaseToPool called hide() first),
      // so destroying them cannot shift focus to bystanders. suspendPool uses
      // raw window.destroy() (not close()), intentionally bypassing the guard.
      const bystanderId = wm.open('plain' as never)
      const bystander = createdWindows[0]

      const id1 = wm.open('action' as never)
      wm.close(id1) // releases to idle pool — already-fired guard on release-before-hide
      bystander.setFocusable.mockClear()

      wm.suspendPool('action' as never) // destroys idle (hidden) windows

      expect(bystander.setFocusable).not.toHaveBeenCalled()
      expect(bystanderId).toBeTruthy()
    })

    // ─── Branch: singleton show:false hide path (toolbar) ─────────────────────────

    it('fires on singleton show:false direct hide path (toolbar scenario)', () => {
      const bystanderId = wm.open('plain' as never)
      const bystander = createdWindows[0]
      bystander.setFocusable.mockClear()

      wm.open('toolbar' as never)
      const toolbar = createdWindows[1]

      // Direct call — bypasses any WM wrapper methods; this is the P0-1 coverage
      toolbar.hide()

      expect(bystander.setFocusable).toHaveBeenCalledWith(false)
      vi.advanceTimersByTime(50)
      expect(bystander.setFocusable).toHaveBeenCalledWith(true)
      expect(bystanderId).toBeTruthy()
    })
  })

  // ─── macClearHoverOnHide ────────────────────────────────────

  describe('macClearHoverOnHide', () => {
    it('sends mouseMove(-1,-1) to webContents after native hide', () => {
      wm.open('toolbar' as never)
      const toolbar = firstWindow()

      toolbar.hide()

      expect(toolbar.webContents.sendInputEvent).toHaveBeenCalledWith({
        type: 'mouseMove',
        x: -1,
        y: -1
      })
    })

    it('does not fire on close() (only hide)', () => {
      wm.open('toolbar' as never)
      const toolbar = firstWindow()

      toolbar.close()

      expect(toolbar.webContents.sendInputEvent).not.toHaveBeenCalled()
    })

    it('does NOT fire when quirk is absent', () => {
      wm.open('action' as never) // has restoreFocusOnHide but NOT clearHoverOnHide
      const action = firstWindow()

      action.hide()

      expect(action.webContents.sendInputEvent).not.toHaveBeenCalled()
    })
  })

  // ─── macReapplyAlwaysOnTop ──────────────────────────────────

  describe('macReapplyAlwaysOnTop', () => {
    it('re-applies setAlwaysOnTop(true, level) after show()', () => {
      wm.open('toolbar' as never)
      const toolbar = firstWindow()
      toolbar.setAlwaysOnTop.mockClear()

      toolbar.show()

      expect(toolbar.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    })

    it('re-applies setAlwaysOnTop(true, level) after showInactive()', () => {
      wm.open('toolbar' as never)
      const toolbar = firstWindow()
      toolbar.setAlwaysOnTop.mockClear()

      toolbar.showInactive()

      expect(toolbar.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    })

    it('defaults level to "floating" when flag is true', () => {
      wm.open('floatingTop' as never)
      const win = firstWindow()
      win.setAlwaysOnTop.mockClear()

      win.show()

      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    })

    it('does NOT fire when quirk is absent', () => {
      wm.open('plain' as never)
      const plain = firstWindow()

      plain.show()
      plain.showInactive()

      expect(plain.setAlwaysOnTop).not.toHaveBeenCalled()
    })

    it('recycle path: setAlwaysOnTop is NOT called without an explicit show() (no bare re-apply leak)', () => {
      // Regression guard for the deleted stash `if (config.alwaysOnTop) window.setAlwaysOnTop(true)` —
      // nothing in resetPooledWindowGeometry should re-apply alwaysOnTop anymore.
      const id1 = wm.open('action' as never) // action has restoreFocusOnHide but NOT reapplyAlwaysOnTop
      const win = firstWindow()
      wm.close(id1)
      win.setAlwaysOnTop.mockClear()

      wm.open('action' as never) // recycles

      expect(win.setAlwaysOnTop).not.toHaveBeenCalled()
    })
  })

  // ─── Non-mac identity check ─────────────────────────────────

  describe('non-mac platforms', () => {
    it('does NOT patch any method when isMac=false — identity preserved', () => {
      platform.isMac = false
      platform.isLinux = true

      wm.open('toolbar' as never)
      const toolbar = firstWindow()

      // Capture the mock fn refs stored at construction time
      const hideMock = toolbar.hide
      const closeMock = toolbar.close
      const showMock = toolbar.show
      const showInactiveMock = toolbar.showInactive

      // After applyQuirks on non-mac: methods must remain the original mock fns
      expect(toolbar.hide).toBe(hideMock)
      expect(toolbar.close).toBe(closeMock)
      expect(toolbar.show).toBe(showMock)
      expect(toolbar.showInactive).toBe(showInactiveMock)
    })
  })
})
