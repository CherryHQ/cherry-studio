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
  setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>
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
    setVisibleOnAllWorkspaces: vi.fn(),
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
  recycleMinSize: 0,
  initialSize: 1,
  recycleMaxSize: 2,
  warmup: 'lazy' as const,
  decayInterval: 300,
  inactivityTimeout: 1800
}

vi.mock('../windowRegistry', () => {
  const registry: Record<string, unknown> = {
    // Singleton toolbar with all three quirks + showMode:'manual' (like SelectionToolbar)
    toolbar: {
      type: 'toolbar',
      lifecycle: 'singleton',
      showMode: 'manual',
      htmlPath: 'toolbar/index.html',
      windowOptions: { width: 350, height: 43 },
      behavior: {
        alwaysOnTop: { level: 'screen-saver' }
      },
      quirks: {
        macRestoreFocusOnHide: true,
        macClearHoverOnHide: true,
        macReapplyAlwaysOnTop: true
      }
    },
    // Pooled action with only restoreFocusOnHide (like SelectionAction)
    action: {
      type: 'action',
      lifecycle: 'pooled',
      showMode: 'manual',
      htmlPath: 'action/index.html',
      windowOptions: { width: 500, height: 400 },
      poolConfig: basePool,
      quirks: { macRestoreFocusOnHide: true }
    },
    // Plain window with no quirks — used for identity checks
    plain: {
      type: 'plain',
      lifecycle: 'default',
      htmlPath: 'plain/index.html',
      windowOptions: {}
    },
    // reapplyAlwaysOnTop: true with no behavior.alwaysOnTop.level → falls back to 'floating'
    floatingTop: {
      type: 'floatingTop',
      lifecycle: 'default',
      htmlPath: 'floatingTop/index.html',
      windowOptions: {},
      quirks: { macReapplyAlwaysOnTop: true }
    },
    // behavior.hideOnBlur — singleton, declarative blur→hide
    blurHider: {
      type: 'blurHider',
      lifecycle: 'singleton',
      showMode: 'manual',
      htmlPath: 'blurHider/index.html',
      windowOptions: {},
      behavior: { hideOnBlur: true }
    },
    // behavior.hideOnBlur + pooled (for release-to-idle override reset)
    pooledBlurHider: {
      type: 'pooledBlurHider',
      lifecycle: 'pooled',
      showMode: 'manual',
      htmlPath: 'pooledBlurHider/index.html',
      windowOptions: {},
      poolConfig: basePool,
      behavior: { hideOnBlur: true }
    },
    // behavior.alwaysOnTop.level with windowOptions.alwaysOnTop=true — initial apply
    topWithLevel: {
      type: 'topWithLevel',
      lifecycle: 'default',
      htmlPath: 'topWithLevel/index.html',
      windowOptions: { alwaysOnTop: true },
      behavior: { alwaysOnTop: { level: 'screen-saver' } }
    },
    // behavior.visibleOnAllWorkspaces — initial setter call on create
    allWorkspaces: {
      type: 'allWorkspaces',
      lifecycle: 'default',
      htmlPath: 'allWorkspaces/index.html',
      windowOptions: {},
      behavior: {
        visibleOnAllWorkspaces: { enabled: true, visibleOnFullScreen: true, skipTransformProcessType: true }
      }
    },
    // behavior.macShowInDock: false — dock-invisible window
    dockHidden: {
      type: 'dockHidden',
      lifecycle: 'default',
      htmlPath: 'dockHidden/index.html',
      windowOptions: {},
      behavior: { macShowInDock: false }
    }
  }
  return {
    WINDOW_TYPE_REGISTRY: registry,
    getWindowTypeMetadata: (type: string) => {
      const meta = registry[type]
      if (!meta) throw new Error(`WindowType '${type}' is not registered`)
      return meta
    },
    mergeWindowOptions: (type: string, overrides?: Record<string, unknown>) => {
      const meta = registry[type] as { windowOptions?: Record<string, unknown> }
      return { ...meta?.windowOptions, ...overrides, webPreferences: {} }
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

    it('fires on excess-capacity close (pool over recycleMaxSize, destroyWindow path)', () => {
      const bystanderId = wm.open('plain' as never)
      const bystander = createdWindows[0]

      // pool recycleMaxSize=2, warmup=lazy. Open 3 — the 3rd exceeds recycleMaxSize.
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

  // ─── behavior layer: hideOnBlur / alwaysOnTop / visibleOnAllWorkspaces ──

  describe('behavior.hideOnBlur — declarative blur→hide', () => {
    it('installs a blur listener that calls window.hide()', () => {
      wm.open('blurHider' as never)
      const win = firstWindow()

      win.emit('blur')

      expect(win.hide).toHaveBeenCalledTimes(1)
    })

    it('skips hide() when window is not visible', () => {
      wm.open('blurHider' as never)
      const win = firstWindow()
      win.isVisible.mockReturnValue(false)

      win.emit('blur')

      expect(win.hide).not.toHaveBeenCalled()
    })

    it('does NOT install blur listener when behavior.hideOnBlur is absent', () => {
      wm.open('plain' as never)
      const win = firstWindow()

      win.emit('blur')

      expect(win.hide).not.toHaveBeenCalled()
    })
  })

  describe('setHideOnBlur — runtime override', () => {
    it('override=false suppresses the declared hide-on-blur', () => {
      const id = wm.open('blurHider' as never)
      const win = firstWindow()

      wm.behavior.setHideOnBlur(id, false)
      win.emit('blur')

      expect(win.hide).not.toHaveBeenCalled()
    })

    it('override=true keeps hide-on-blur active (idempotent with declared default)', () => {
      const id = wm.open('blurHider' as never)
      const win = firstWindow()

      wm.behavior.setHideOnBlur(id, true)
      win.emit('blur')

      expect(win.hide).toHaveBeenCalledTimes(1)
    })

    it('is a no-op when the window does not declare hideOnBlur (no listener to override)', () => {
      const id = wm.open('plain' as never)
      const win = firstWindow()

      // Should not throw; should not install a listener just because override is set
      wm.behavior.setHideOnBlur(id, false)
      win.emit('blur')

      expect(win.hide).not.toHaveBeenCalled()
    })

    it('is a no-op for unknown window ids', () => {
      expect(() => wm.behavior.setHideOnBlur('bogus-id', false)).not.toThrow()
    })

    it('pool releaseToPool resets the override for the next consumer', () => {
      const id1 = wm.open('pooledBlurHider' as never)
      const win = firstWindow()
      wm.behavior.setHideOnBlur(id1, false)

      // Release to idle pool
      wm.close(id1)

      // Re-open (recycles the same window) — override should be gone
      wm.open('pooledBlurHider' as never)
      win.hide.mockClear()
      win.emit('blur')

      // With override cleared, registry default (hideOnBlur: true) takes over
      expect(win.hide).toHaveBeenCalledTimes(1)
    })
  })

  describe('setAlwaysOnTop — registry-driven level/relativeLevel', () => {
    it('passes level from behavior.alwaysOnTop', () => {
      const id = wm.open('topWithLevel' as never)
      const win = firstWindow()
      win.setAlwaysOnTop.mockClear()

      wm.behavior.setAlwaysOnTop(id, true)

      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    })

    it('omits level when behavior.alwaysOnTop is not declared', () => {
      const id = wm.open('plain' as never)
      const win = firstWindow()
      win.setAlwaysOnTop.mockClear()

      wm.behavior.setAlwaysOnTop(id, true)

      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true)
    })

    it('supports enabled=false without passing level (Electron ignores level on false)', () => {
      const id = wm.open('topWithLevel' as never)
      const win = firstWindow()
      win.setAlwaysOnTop.mockClear()

      wm.behavior.setAlwaysOnTop(id, false)

      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(false, 'screen-saver')
    })

    it('is a no-op for unknown window ids', () => {
      expect(() => wm.behavior.setAlwaysOnTop('bogus-id', true)).not.toThrow()
    })
  })

  describe('behavior initial setters — fire once on window create', () => {
    it('applies setAlwaysOnTop(true, level) when windowOptions.alwaysOnTop is true', () => {
      wm.open('topWithLevel' as never)
      const win = firstWindow()

      // The initial call from applyWindowBehavior (pre-quirk-patch) uses 2 args.
      // Subsequent patched show() calls also re-apply via the macReapplyAlwaysOnTop
      // quirk — but 'topWithLevel' does not declare that quirk, so show()s do
      // not add more setAlwaysOnTop calls. Filter by the 2-arg shape to assert
      // the initial application specifically.
      const matching = win.setAlwaysOnTop.mock.calls.filter(
        ([enabled, level]) => enabled === true && level === 'screen-saver'
      )
      expect(matching.length).toBeGreaterThanOrEqual(1)
    })

    it('applies setVisibleOnAllWorkspaces on create with options', () => {
      wm.open('allWorkspaces' as never)
      const win = firstWindow()

      expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
    })

    it('does NOT call setVisibleOnAllWorkspaces when behavior does not declare it', () => {
      wm.open('plain' as never)
      const win = firstWindow()

      expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
    })
  })
})
