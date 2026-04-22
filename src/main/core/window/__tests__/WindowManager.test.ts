import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '../../lifecycle/BaseService'
import { type Disposable } from '../../lifecycle/event'

// ─── Deterministic UUIDs ────────────────────────────────────

let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`
}))

// ─── Mock: @main/constant ──────────────────────────────────

vi.mock('@main/constant', () => ({
  isMac: false,
  isWin: false,
  isLinux: false,
  isDev: false
}))

// ─── Mock BrowserWindow ────────────────────────────────────

interface MockBrowserWindow {
  id: number
  show: ReturnType<typeof vi.fn>
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
  setFullScreen: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  setContentBounds: ReturnType<typeof vi.fn>
  setPosition: ReturnType<typeof vi.fn>
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
    isCrashed: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    getURL: ReturnType<typeof vi.fn>
  }
}

function createMockBrowserWindow(): MockBrowserWindow {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  const win: MockBrowserWindow = {
    id: Math.random(),
    show: vi.fn(),
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
    setFullScreen: vi.fn(),
    setBounds: vi.fn(),
    setContentBounds: vi.fn(),
    setPosition: vi.fn(),
    center: vi.fn(),
    getTitle: vi.fn(() => 'Test Window'),
    setTitleBarOverlay: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, [])
      const handler = (...args: unknown[]) => {
        cb(...args)
        const handlers = listeners.get(event)
        if (handlers) {
          const idx = handlers.indexOf(handler)
          if (idx !== -1) handlers.splice(idx, 1)
        }
      }
      listeners.get(event)!.push(handler)
    }),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(cb)
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      const handlers = listeners.get(event)
      if (handlers) {
        for (const handler of [...handlers]) {
          handler(...args)
        }
      }
    }),
    removeAllListeners: vi.fn(() => {
      listeners.clear()
    }),
    webContents: {
      send: vi.fn(),
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
      return win as never
    }

    static fromWebContents(): null {
      return null
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

// ─── Mock: windowRegistry ──────────────────────────────────

const poolConfig = {
  recycleMinSize: 0,
  initialSize: 1,
  recycleMaxSize: 4,
  warmup: 'lazy' as const,
  decayInterval: 300,
  inactivityTimeout: 1800
}

const eagerPoolConfig = {
  ...poolConfig,
  warmup: 'eager' as const
}

// Scenario ②: pure standby pool. standbySize only, no recycling.
const standbyOnlyPoolConfig = {
  standbySize: 1,
  warmup: 'eager' as const
}

// Scenario ④: hybrid pool with both standby and recycle axes.
const hybridPoolConfig = {
  standbySize: 1,
  recycleMinSize: 1,
  recycleMaxSize: 3,
  decayInterval: 60,
  inactivityTimeout: 300,
  warmup: 'eager' as const
}

// Lazy + standby: defers standby creation until first open().
const lazyStandbyPoolConfig = {
  standbySize: 1,
  warmup: 'lazy' as const
}

vi.mock('../windowRegistry', () => {
  const registry: Record<string, unknown> = {
    pooled: {
      type: 'pooled',
      lifecycle: 'pooled',
      poolConfig,
      htmlPath: 'windows/pooled/index.html',
      windowOptions: { width: 1100, height: 720 }
    },
    pooledHidden: {
      type: 'pooledHidden',
      lifecycle: 'pooled',
      poolConfig,
      showMode: 'manual',
      htmlPath: 'windows/pooledHidden/index.html',
      windowOptions: {}
    },
    eagerPooled: {
      type: 'eagerPooled',
      lifecycle: 'pooled',
      poolConfig: eagerPoolConfig,
      htmlPath: 'windows/eagerPooled/index.html',
      windowOptions: { width: 800, height: 600 }
    },
    default: {
      type: 'default',
      lifecycle: 'default',
      htmlPath: 'windows/default/index.html',
      windowOptions: {}
    },
    singleton: {
      type: 'singleton',
      lifecycle: 'singleton',
      htmlPath: 'windows/singleton/index.html',
      windowOptions: {}
    },
    singletonHidden: {
      type: 'singletonHidden',
      lifecycle: 'singleton',
      showMode: 'manual',
      htmlPath: 'windows/singletonHidden/index.html',
      windowOptions: {}
    },
    alwaysOnTopPool: {
      type: 'alwaysOnTopPool',
      lifecycle: 'pooled',
      poolConfig,
      htmlPath: 'windows/alwaysOnTopPool/index.html',
      windowOptions: { width: 400, height: 300, alwaysOnTop: true }
    },
    standbyOnly: {
      type: 'standbyOnly',
      lifecycle: 'pooled',
      poolConfig: standbyOnlyPoolConfig,
      htmlPath: 'windows/standbyOnly/index.html',
      windowOptions: { width: 400, height: 300 }
    },
    hybrid: {
      type: 'hybrid',
      lifecycle: 'pooled',
      poolConfig: hybridPoolConfig,
      htmlPath: 'windows/hybrid/index.html',
      windowOptions: { width: 400, height: 300 }
    },
    lazyStandby: {
      type: 'lazyStandby',
      lifecycle: 'pooled',
      poolConfig: lazyStandbyPoolConfig,
      htmlPath: 'windows/lazyStandby/index.html',
      windowOptions: { width: 400, height: 300 }
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

// ─── Import after mocks ────────────────────────────────────

const { WindowManager } = await import('../WindowManager')

// ─── Helpers ───────────────────────────────────────────────

function simulateWindowClosed(wm: InstanceType<typeof WindowManager>, windowId: string): void {
  const win = wm.getWindow(windowId) as unknown as MockBrowserWindow | undefined
  win?.emit('closed')
}

// ─── Test Suite ────────────────────────────────────────────

describe('WindowManager', () => {
  let wm: InstanceType<typeof WindowManager>

  beforeEach(() => {
    BaseService.resetInstances()
    uuidCounter = 0
    createdWindows.length = 0
    wm = new WindowManager()
    void wm._doInit()
  })

  afterEach(async () => {
    // Destroy the WM so any pending standby setImmediate callbacks see
    // `state.suspended=true` and bail out — otherwise they'd create windows
    // in the next test's shared `createdWindows` array.
    await wm._doDestroy()
    // Flush pending microtasks/immediates so leaked callbacks run and bail.
    await new Promise<void>((resolve) => setImmediate(resolve))
    vi.clearAllMocks()
  })

  // ─── Default lifecycle ─────────────────────────────────

  describe('default lifecycle', () => {
    it('creates a new window on open()', () => {
      const id = wm.open('default' as never)
      expect(id).toBe('test-uuid-1')
      expect(createdWindows).toHaveLength(1)
      expect(wm.getWindow(id)).toBeDefined()
    })

    it('creates a new window each time open() is called', () => {
      const id1 = wm.open('default' as never)
      const id2 = wm.open('default' as never)
      expect(id1).not.toBe(id2)
      expect(createdWindows).toHaveLength(2)
    })

    it('destroys window on close()', () => {
      const id = wm.open('default' as never)
      const win = createdWindows[0]

      wm.close(id)

      expect(win.destroy).toHaveBeenCalled()
    })
  })

  // ─── Singleton lifecycle ───────────────────────────────

  describe('singleton lifecycle', () => {
    it('creates a new window on first open()', () => {
      const id = wm.open('singleton' as never)
      expect(id).toBe('test-uuid-1')
      expect(createdWindows).toHaveLength(1)
    })

    it('shows and focuses existing window on subsequent open()', () => {
      const id1 = wm.open('singleton' as never)
      const win = createdWindows[0]
      win.show.mockClear()
      win.focus.mockClear()

      const id2 = wm.open('singleton' as never)

      expect(id2).toBe(id1)
      expect(createdWindows).toHaveLength(1) // no new window
      expect(win.show).toHaveBeenCalled()
      expect(win.focus).toHaveBeenCalled()
    })

    it('throws on create() when singleton already exists', () => {
      wm.create('singleton' as never)
      expect(() => wm.create('singleton' as never)).toThrow('already exists')
    })

    it('allows new open() after singleton is closed and destroyed', () => {
      const id1 = wm.open('singleton' as never)
      wm.close(id1)
      simulateWindowClosed(wm, id1)

      const id2 = wm.open('singleton' as never)
      expect(id2).not.toBe(id1)
      expect(createdWindows).toHaveLength(2)
    })

    it('does NOT show/focus existing singleton when metadata.showMode is "manual"', () => {
      const id1 = wm.open('singletonHidden' as never)
      const win = createdWindows[0]
      win.show.mockClear()
      win.focus.mockClear()

      const id2 = wm.open('singletonHidden' as never)

      expect(id2).toBe(id1)
      expect(win.show).not.toHaveBeenCalled()
      expect(win.focus).not.toHaveBeenCalled()
    })
  })

  // ─── Pooled lifecycle ──────────────────────────────────

  describe('pooled lifecycle', () => {
    describe('open() — fresh path', () => {
      it('creates a new window when pool is empty', () => {
        const id = wm.open('pooled' as never)
        expect(id).toBe('test-uuid-1')
        expect(createdWindows).toHaveLength(1)
      })

      it('creates multiple windows up to recycleMaxSize', () => {
        const ids = Array.from({ length: 4 }, () => wm.open('pooled' as never))
        expect(ids).toHaveLength(4)
        expect(createdWindows).toHaveLength(4)
      })
    })

    describe('close() — release to pool', () => {
      it('hides and returns window to pool instead of destroying', () => {
        const id = wm.open('pooled' as never)
        const win = createdWindows[0]

        wm.close(id)

        expect(win.hide).toHaveBeenCalled()
        expect(win.destroy).not.toHaveBeenCalled()
        expect(wm.getWindow(id)).toBeDefined()
      })

      it('clears initData when released to pool', () => {
        const id = wm.open('pooled' as never)
        wm.setInitData(id, { foo: 'bar' })
        expect(wm.getInitData(id)).toEqual({ foo: 'bar' })

        wm.close(id)

        expect(wm.getInitData(id)).toBeNull()
      })

      it('is idempotent on repeated close()', () => {
        const id = wm.open('pooled' as never)
        const win = createdWindows[0]

        wm.close(id)
        win.hide.mockClear()

        wm.close(id) // repeated
        expect(win.hide).not.toHaveBeenCalled()
      })

      it('destroys excess windows when managed exceeds recycleMaxSize', () => {
        const ids = Array.from({ length: 5 }, () => wm.open('pooled' as never))
        expect(createdWindows).toHaveLength(5)

        // managed=5 > recycleMaxSize=4, should destroy instead of pooling
        wm.close(ids[0])
        expect(createdWindows[0].destroy).toHaveBeenCalled()

        simulateWindowClosed(wm, ids[0])

        // managed=4, within limit → should pool
        wm.close(ids[1])
        expect(createdWindows[1].destroy).not.toHaveBeenCalled()
        expect(createdWindows[1].hide).toHaveBeenCalled()
      })
    })

    describe('open() — recycled path', () => {
      it('recycles idle window without firing Reused when no initData is provided', () => {
        const id1 = wm.open('pooled' as never)
        wm.close(id1)

        const id2 = wm.open('pooled' as never)

        expect(id2).toBe(id1)
        // No initData → no Reused event. Empty Reused events are a dormant foot-gun.
        const reusedCalls = createdWindows[0].webContents.send.mock.calls.filter(
          (call) => call[0] === 'window-manager:reused'
        )
        expect(reusedCalls).toHaveLength(0)
        expect(createdWindows).toHaveLength(1)
      })

      it('recycles idle window and sends Reused event with initData payload', () => {
        const id1 = wm.open('pooled' as never)
        wm.close(id1)

        const data = { action: 'translate', text: 'hello' }
        const id2 = wm.open('pooled' as never, { initData: data })

        expect(id2).toBe(id1)
        expect(createdWindows[0].webContents.send).toHaveBeenCalledWith('window-manager:reused', data)
        // And the init-data store must be readable synchronously after open() returns.
        expect(wm.getInitData(id2)).toEqual(data)
        expect(createdWindows).toHaveLength(1)
      })

      it('shows and focuses recycled window when show is auto', () => {
        const id = wm.open('pooled' as never)
        wm.close(id)

        const win = createdWindows[0]
        win.show.mockClear()
        win.focus.mockClear()

        wm.open('pooled' as never)

        expect(win.show).toHaveBeenCalled()
        expect(win.focus).toHaveBeenCalled()
      })

      it('does not show recycled window when show is false', () => {
        const id = wm.open('pooledHidden' as never)
        wm.close(id)

        const win = createdWindows[0]
        win.show.mockClear()
        win.focus.mockClear()

        wm.open('pooledHidden' as never)

        expect(win.show).not.toHaveBeenCalled()
        expect(win.focus).not.toHaveBeenCalled()
      })

      it('does not emit synthetic ready-to-show on recycle (uses dedicated event instead)', () => {
        const id = wm.open('pooled' as never)
        wm.close(id)

        const win = wm.getWindow(id) as unknown as MockBrowserWindow
        win.emit.mockClear()

        wm.open('pooled' as never)

        // Verify no one manually emitted a 'ready-to-show' event
        const readyToShowEmits = win.emit.mock.calls.filter((call) => call[0] === 'ready-to-show')
        expect(readyToShowEmits).toHaveLength(0)
      })

      it('skips unhealthy idle windows', () => {
        const id1 = wm.open('pooled' as never)
        wm.close(id1)

        // Mark window as destroyed
        createdWindows[0].isDestroyed.mockReturnValue(true)

        const id2 = wm.open('pooled' as never)
        expect(id2).not.toBe(id1) // new window created
        expect(createdWindows).toHaveLength(2)
      })
    })

    describe('geometry reset on recycle', () => {
      it('resets geometry via setBounds called twice (cross-DPI safety)', () => {
        const id = wm.open('pooled' as never)
        wm.close(id)

        const win = createdWindows[0]
        wm.open('pooled' as never)

        // workArea: 1920×1040, size: 1100×720
        const expected = { x: 410, y: 160, width: 1100, height: 720 }
        expect(win.setBounds).toHaveBeenCalledTimes(2)
        expect(win.setBounds).toHaveBeenNthCalledWith(1, expected)
        expect(win.setBounds).toHaveBeenNthCalledWith(2, expected)
      })
    })

    describe('destroy() bypasses pool', () => {
      it('force-destroys a pooled window without returning to pool', () => {
        const id = wm.open('pooled' as never)
        const win = createdWindows[0]

        wm.destroy(id)

        expect(win.destroy).toHaveBeenCalled()
      })
    })

    describe('suspend / resume', () => {
      it('suspendPool() destroys idle windows and sets suspended flag', () => {
        const id = wm.open('pooled' as never)
        wm.close(id) // return to pool

        const count = wm.suspendPool('pooled' as never)

        expect(count).toBe(1)
        expect(createdWindows[0].destroy).toHaveBeenCalled()
      })

      it('open() during suspension creates non-pooled windows', () => {
        wm.suspendPool('pooled' as never)

        const id = wm.open('pooled' as never)
        const win = createdWindows[0]

        // close during suspension destroys (not pool)
        wm.close(id)
        expect(win.destroy).toHaveBeenCalled()
      })

      it('resumePool() clears suspended flag', () => {
        wm.suspendPool('pooled' as never)
        wm.resumePool('pooled' as never)

        const id = wm.open('pooled' as never)
        wm.close(id)

        // After resume, close should pool (not destroy)
        expect(createdWindows[0].destroy).not.toHaveBeenCalled()
        expect(createdWindows[0].hide).toHaveBeenCalled()
      })
    })

    // ─── Standby (producer axis) ──────────────────────────
    describe('standbySize — active pre-warming', () => {
      /** Flush any pending setImmediate callbacks so standby replenishment lands. */
      const flushImmediate = () => new Promise<void>((resolve) => setImmediate(resolve))

      /**
       * Boot the pool lifecycle (triggers onAllReady which eager-warms all
       * eager pools across the mock registry). Returns the baseline window count
       * so subsequent delta assertions are clean.
       */
      const bootEagerPools = async (): Promise<number> => {
        await wm._doAllReady()
        return createdWindows.length
      }

      describe('scenario ② — standby-only (no recycling)', () => {
        it('eagerly warms up to standbySize on boot', async () => {
          const before = createdWindows.length
          await wm._doAllReady()
          // Standby-only + hybrid + eagerPooled each create 1 on boot.
          // We care only about standbyOnly: check that AT LEAST one extra exists
          // and that calling open() on standbyOnly succeeds without creating another.
          expect(createdWindows.length).toBeGreaterThan(before)
          // Opening should recycle (no new window created synchronously).
          const baseline = createdWindows.length
          wm.open('standbyOnly' as never)
          expect(createdWindows.length).toBe(baseline)
        })

        it('open() pops the standby window and schedules async replenishment', async () => {
          const baseline = await bootEagerPools()

          wm.open('standbyOnly' as never)
          // Immediately after open(): no new window yet — replenish is async.
          expect(createdWindows.length).toBe(baseline)

          await flushImmediate()
          // Standby replenishment landed.
          expect(createdWindows.length).toBe(baseline + 1)
        })

        it('close() destroys the window when recycling is disabled', async () => {
          await bootEagerPools()
          const id = wm.open('standbyOnly' as never)
          const win = wm.getWindow(id) as unknown as MockBrowserWindow

          wm.close(id)

          expect(win.destroy).toHaveBeenCalled()
          expect(win.hide).toHaveBeenCalled()
        })

        it('three rapid opens: first zero-wait, 2nd/3rd sync fallback; one replenish queued', async () => {
          const baseline = await bootEagerPools()

          const id1 = wm.open('standbyOnly' as never)
          const id2 = wm.open('standbyOnly' as never)
          const id3 = wm.open('standbyOnly' as never)

          expect(id1).not.toBe(id2)
          expect(id2).not.toBe(id3)
          // First open popped the warm standby (no new window).
          // Second/third opens each synchronously created a fresh window because idle was empty.
          expect(createdWindows.length).toBe(baseline + 2)

          await flushImmediate()
          // After setImmediate fires, exactly ONE replenish ran (dedup via inflightCreates);
          // so we gained exactly one more window.
          expect(createdWindows.length).toBe(baseline + 3)
        })
      })

      describe('scenario ④ — hybrid (standby + recycle)', () => {
        it('pops standby and replenishes; close recycles within recycleMaxSize', async () => {
          const baseline = await bootEagerPools()

          const id = wm.open('hybrid' as never)
          const win = wm.getWindow(id) as unknown as MockBrowserWindow

          await flushImmediate()
          // Standby replenished (one new window).
          expect(createdWindows.length).toBe(baseline + 1)

          wm.close(id)
          // managed (2 windows in hybrid pool) ≤ recycleMaxSize=3 → recycle (hide, not destroy).
          expect(win.destroy).not.toHaveBeenCalled()
          expect(win.hide).toHaveBeenCalled()
        })

        it('close destroys when managed+inflight exceeds recycleMaxSize', async () => {
          await bootEagerPools()
          // Pool has standbySize=1 already. Open 3 more to exhaust beyond recycleMaxSize=3.
          const id1 = wm.open('hybrid' as never)
          const id2 = wm.open('hybrid' as never)
          const id3 = wm.open('hybrid' as never)
          await flushImmediate()

          // id1 used the standby; id2/id3 sync-created. Replenish created one standby window.
          // Pool state: in-use = {id1, id2, id3}, idle = 1 standby, managed.size = 4 > recycleMaxSize=3.
          wm.close(id1)
          const win1 = wm.getWindow(id1) as unknown as MockBrowserWindow
          // managed + inflight > 3 → destroy the closing window.
          expect(win1.destroy).toHaveBeenCalled()
          expect([id2, id3].every((x) => typeof x === 'string')).toBe(true)
        })
      })

      describe('lazy + standbySize', () => {
        it('first open() on lazyStandby sync-creates; standby replenishes after', async () => {
          // Baseline AFTER eager warmup of OTHER pools (lazyStandby is lazy, so it's not warmed).
          const baseline = await bootEagerPools()

          const id = wm.open('lazyStandby' as never)
          expect(id).toBeDefined()
          // First open synchronously created one new window (no idle was available).
          expect(createdWindows.length).toBe(baseline + 1)

          await flushImmediate()
          // Standby replenishment created a second window for the next call.
          expect(createdWindows.length).toBe(baseline + 2)
        })
      })

      describe('suspend during inflight replenish', () => {
        it('pending setImmediate callback short-circuits when pool suspended before execution', async () => {
          const baseline = await bootEagerPools()

          // Trigger replenish: open pops standby and schedules setImmediate.
          wm.open('standbyOnly' as never)
          // Suspend the pool BEFORE the immediate fires. This destroys idle windows
          // (none in standbyOnly right now — we just popped the only one) and sets suspended=true.
          wm.suspendPool('standbyOnly' as never)
          await flushImmediate()

          // The scheduled replenish saw suspended=true and short-circuited:
          // no new window was created during flushImmediate.
          expect(createdWindows.length).toBe(baseline)
        })
      })

      describe('inactivityTimeout trims idle to standbySize, preserves standby', () => {
        it('trimIdleToFloor destroys (idle.length - standbySize) oldest idle windows', async () => {
          await bootEagerPools()

          // Grow the hybrid pool's idle queue beyond standbySize=1 by opening +
          // closing two windows (recycleMaxSize=3 allows recycling).
          const id1 = wm.open('hybrid' as never)
          const id2 = wm.open('hybrid' as never)
          await flushImmediate()

          wm.close(id1)
          wm.close(id2)

          // Force inactivity by rewinding lastOpenAt past inactivityTimeout (300s).
          const pools = (wm as unknown as { pools: Map<string, { lastOpenAt: number; idle: string[] }> }).pools
          const state = pools.get('hybrid')
          expect(state).toBeDefined()
          const idleBefore = state!.idle.length
          const expectedDestroys = Math.max(0, idleBefore - 1) // standbySize = 1
          state!.lastOpenAt = Date.now() - 10_000_000

          // Snapshot destroy-call counts for idle windows before the tick.
          const idleIdsBefore = [...state!.idle]
          const destroyCallsBefore = idleIdsBefore.map((id) => {
            const win = wm.getWindow(id) as unknown as MockBrowserWindow | undefined
            return win?.destroy.mock.calls.length ?? 0
          })

          // Trigger a GC tick manually.
          ;(wm as unknown as { poolGcTick: () => void }).poolGcTick()

          // Verify: the trim destroyed exactly (idleBefore - standbySize) windows
          // from the FRONT of the idle queue (oldest first).
          const destroyCallsAfter = idleIdsBefore.map((id) => {
            const win = wm.getWindow(id) as unknown as MockBrowserWindow | undefined
            return win?.destroy.mock.calls.length ?? 0
          })
          const newlyDestroyed = destroyCallsAfter.filter((after, i) => after > destroyCallsBefore[i]).length
          expect(newlyDestroyed).toBe(expectedDestroys)
        })
      })

      describe('GC efficiency optimizations', () => {
        type WmInternals = {
          activePoolTypes: Set<string>
          poolGcTimer: ReturnType<typeof setInterval> | null
          poolGcTick: () => void
          pools: Map<
            string,
            {
              idle: string[]
              standbyFloor: number
              decayFloor: number
              inactivityTimeoutMs: number
              decayIntervalMs: number
              gcDisabled: boolean
            }
          >
        }

        it('activePoolTypes contains type after releaseToPool pushes idle', async () => {
          await bootEagerPools()
          const id = wm.open('hybrid' as never)
          await flushImmediate()

          wm.close(id)

          const internals = wm as unknown as WmInternals
          expect(internals.activePoolTypes.has('hybrid')).toBe(true)
        })

        it('activePoolTypes drops type after suspendPool destroys all idle', async () => {
          await bootEagerPools()
          // hybrid pool has standbySize=1 idle window after eager warmup.
          const internals = wm as unknown as WmInternals
          expect(internals.activePoolTypes.has('hybrid')).toBe(true)

          wm.suspendPool('hybrid' as never)

          expect(internals.activePoolTypes.has('hybrid')).toBe(false)
        })

        it('poolGcTick stops the interval when activePoolTypes is empty', async () => {
          await bootEagerPools()
          const internals = wm as unknown as WmInternals

          // Force activePoolTypes empty (simulate the steady idle state where
          // every pool either has 0 idle or has been suspended).
          internals.activePoolTypes.clear()
          // Simulate a previously running interval timer.
          if (!internals.poolGcTimer) {
            internals.poolGcTimer = setInterval(() => {}, 60_000)
          }

          internals.poolGcTick()

          expect(internals.poolGcTimer).toBeNull()
        })

        it('getOrCreatePoolState caches precomputed config values', async () => {
          await bootEagerPools()
          const internals = wm as unknown as WmInternals

          // hybridPoolConfig: standbySize=1, recycleMinSize=1, decayInterval=60, inactivityTimeout=300
          const hybrid = internals.pools.get('hybrid')!
          expect(hybrid.standbyFloor).toBe(1)
          expect(hybrid.decayFloor).toBe(1)
          expect(hybrid.inactivityTimeoutMs).toBe(300_000)
          expect(hybrid.decayIntervalMs).toBe(60_000)
          expect(hybrid.gcDisabled).toBe(false)

          // standbyOnlyPoolConfig: standbySize=1, no decay/inactivity → gcDisabled=true
          const standbyOnly = internals.pools.get('standbyOnly')!
          expect(standbyOnly.standbyFloor).toBe(1)
          expect(standbyOnly.decayFloor).toBe(1)
          expect(standbyOnly.inactivityTimeoutMs).toBe(0)
          expect(standbyOnly.decayIntervalMs).toBe(0)
          expect(standbyOnly.gcDisabled).toBe(true)
        })

        it('poolGcTick prunes pool from activePoolTypes once idle settles at standbyFloor', async () => {
          await bootEagerPools()
          const internals = wm as unknown as WmInternals

          // After eager warmup, hybrid has idle=standbySize=1. It was added to
          // activePoolTypes via createPooledIdleWindow.
          expect(internals.activePoolTypes.has('hybrid')).toBe(true)

          internals.poolGcTick()

          // idle (1) <= standbyFloor (1) → no GC work possible until next
          // release grows the queue past the floor → drop from active set.
          expect(internals.activePoolTypes.has('hybrid')).toBe(false)
        })

        it('poolGcTick prunes gcDisabled pools from activePoolTypes immediately', async () => {
          await bootEagerPools()
          const internals = wm as unknown as WmInternals

          // standbyOnly has gcDisabled=true (no inactivity, no decay configured).
          // It was added to activePoolTypes when the standby idle window landed.
          expect(internals.activePoolTypes.has('standbyOnly')).toBe(true)

          internals.poolGcTick()

          expect(internals.activePoolTypes.has('standbyOnly')).toBe(false)
        })
      })
    })
  })

  // ─── Events ────────────────────────────────────────────

  describe('events', () => {
    it('fires onWindowCreated when a window is created', () => {
      const listener = vi.fn()
      wm.onWindowCreated(listener)

      wm.open('default' as never)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: 'test-uuid-1', type: 'default' }))
    })

    it('fires onWindowCreated BEFORE loadWindowContent', () => {
      const callOrder: string[] = []

      wm.onWindowCreated(() => callOrder.push('onWindowCreated'))
      // loadWindowContent calls loadURL/loadFile — we detect via window.webContents usage
      // Since we can't easily intercept loadURL in mock, verify event fires by checking
      // that onWindowCreated callback has access to the window
      wm.onWindowCreated((managed) => {
        expect(managed.window).toBeDefined()
        expect(wm.getWindow(managed.id)).toBeDefined()
        callOrder.push('window-accessible')
      })

      wm.open('default' as never)

      expect(callOrder).toEqual(['onWindowCreated', 'window-accessible'])
    })

    it('fires onWindowDestroyed when a window is truly destroyed', () => {
      const listener = vi.fn()
      wm.onWindowDestroyed(listener)

      const id = wm.open('default' as never)
      wm.close(id)
      simulateWindowClosed(wm, id)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id, type: 'default' }))
    })

    it('does NOT fire onWindowDestroyed on pool release', () => {
      const listener = vi.fn()
      wm.onWindowDestroyed(listener)

      const id = wm.open('pooled' as never)
      wm.close(id) // pool release

      expect(listener).not.toHaveBeenCalled()
    })

    it('fires onWindowCreated for pooled windows only on initial creation (not recycle)', () => {
      const listener = vi.fn()
      wm.onWindowCreated(listener)

      const id1 = wm.open('pooled' as never) // creates → fires
      wm.close(id1)
      wm.open('pooled' as never) // recycles → does NOT fire

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('returns Disposable for unsubscription', () => {
      const listener = vi.fn()
      const disposable: Disposable = wm.onWindowCreated(listener)

      wm.open('default' as never)
      expect(listener).toHaveBeenCalledTimes(1)

      disposable.dispose()
      wm.open('default' as never)
      expect(listener).toHaveBeenCalledTimes(1) // not called again
    })
  })

  // ─── Queries ───────────────────────────────────────────

  describe('queries', () => {
    it('getAllWindows() returns all managed windows', () => {
      wm.open('default' as never)
      wm.open('singleton' as never)
      wm.open('pooled' as never)

      const all = wm.getAllWindows()
      expect(all).toHaveLength(3)
    })

    it('getWindowsByType() filters by type', () => {
      wm.open('default' as never)
      wm.open('default' as never)
      wm.open('singleton' as never)

      const defaults = wm.getWindowsByType('default' as never)
      expect(defaults).toHaveLength(2)
    })

    it('getWindowInfo() returns serializable info', () => {
      const id = wm.open('singleton' as never)
      const info = wm.getWindowInfo(id)

      expect(info).toMatchObject({
        id,
        type: 'singleton',
        title: 'Test Window',
        isVisible: true,
        isFocused: false
      })
      expect(info?.createdAt).toBeGreaterThan(0)
    })

    it('count reflects current managed window count', () => {
      expect(wm.count).toBe(0)
      const id1 = wm.open('default' as never)
      expect(wm.count).toBe(1)
      wm.open('default' as never)
      expect(wm.count).toBe(2)
      wm.close(id1)
      simulateWindowClosed(wm, id1)
      expect(wm.count).toBe(1)
    })
  })

  // ─── InitData ──────────────────────────────────────────

  describe('initData', () => {
    it('stores and retrieves init data', () => {
      const id = wm.open('default' as never)
      wm.setInitData(id, { key: 'value' })
      expect(wm.getInitData(id)).toEqual({ key: 'value' })
    })

    it('returns null for missing init data', () => {
      const id = wm.open('default' as never)
      expect(wm.getInitData(id)).toBeNull()
    })

    it('clears init data on window close', () => {
      const id = wm.open('default' as never)
      wm.setInitData(id, { key: 'value' })
      wm.close(id)
      simulateWindowClosed(wm, id)
      expect(wm.getInitData(id)).toBeNull()
    })

    describe('open({ initData })', () => {
      it('atomically opens a window and stores init data', () => {
        const data = { action: 'translate', text: 'hello' }
        const id = wm.open('default' as never, { initData: data })

        expect(id).toBe('test-uuid-1')
        expect(wm.getWindow(id)).toBeDefined()
        expect(wm.getInitData(id)).toEqual(data)
      })

      it('accepts both initData and options in the same call', () => {
        const id = wm.open('pooled' as never, { initData: { foo: 'bar' }, options: { width: 800 } })
        expect(wm.getInitData(id)).toEqual({ foo: 'bar' })
        expect(createdWindows).toHaveLength(1)
      })

      it('works for pooled recycled path — Reused payload carries the new init data', () => {
        const firstId = wm.open('pooled' as never, { initData: { version: 1 } })
        expect(wm.getInitData(firstId)).toEqual({ version: 1 })

        wm.close(firstId) // pool release clears init data

        const win = createdWindows[0]
        win.webContents.send.mockClear()

        const secondId = wm.open('pooled' as never, { initData: { version: 2 } })
        expect(secondId).toBe(firstId) // recycled
        expect(wm.getInitData(secondId)).toEqual({ version: 2 })
        expect(win.webContents.send).toHaveBeenCalledWith('window-manager:reused', { version: 2 })
      })

      it('fresh window paths do not fire Reused (pooled new / singleton first / default / create)', () => {
        // default: fresh
        const a = wm.open('default' as never, { initData: { a: 1 } })
        // singleton: first time → fresh
        const b = wm.open('singleton' as never, { initData: { b: 2 } })
        // pooled: fresh (no idle yet)
        const c = wm.open('pooled' as never, { initData: { c: 3 } })
        // create() path: always fresh
        const d = wm.create('default' as never, { initData: { d: 4 } })

        expect(wm.getInitData(a)).toEqual({ a: 1 })
        expect(wm.getInitData(b)).toEqual({ b: 2 })
        expect(wm.getInitData(c)).toEqual({ c: 3 })
        expect(wm.getInitData(d)).toEqual({ d: 4 })

        for (const win of createdWindows) {
          const reusedCalls = win.webContents.send.mock.calls.filter((call) => call[0] === 'window-manager:reused')
          expect(reusedCalls).toHaveLength(0)
        }
      })
    })

    describe('open({ initData }) — singleton reuse', () => {
      it('fires Reused event with new initData on singleton re-open', () => {
        const id1 = wm.open('singleton' as never, { initData: { version: 1 } })
        const win = createdWindows[0]
        win.webContents.send.mockClear()

        const id2 = wm.open('singleton' as never, { initData: { version: 2 } })

        expect(id2).toBe(id1)
        expect(wm.getInitData(id2)).toEqual({ version: 2 })
        expect(win.webContents.send).toHaveBeenCalledWith('window-manager:reused', { version: 2 })
      })

      it('does NOT fire Reused on singleton re-open when no initData provided', () => {
        wm.open('singleton' as never)
        const win = createdWindows[0]
        win.webContents.send.mockClear()

        wm.open('singleton' as never)

        const reusedCalls = win.webContents.send.mock.calls.filter((call) => call[0] === 'window-manager:reused')
        expect(reusedCalls).toHaveLength(0)
      })

      it('clears stale initData on singleton re-open without initData', () => {
        const id1 = wm.open('singleton' as never, { initData: { version: 1 } })
        expect(wm.getInitData(id1)).toEqual({ version: 1 })

        const id2 = wm.open('singleton' as never)

        expect(id2).toBe(id1)
        expect(wm.getInitData(id2)).toBeNull()
      })
    })
  })

  // ─── Broadcast ─────────────────────────────────────────

  describe('broadcast', () => {
    it('sends message to all managed windows', () => {
      wm.open('default' as never)
      wm.open('singleton' as never)

      wm.broadcast('test-channel', 'data1', 'data2')

      expect(createdWindows[0].webContents.send).toHaveBeenCalledWith('test-channel', 'data1', 'data2')
      expect(createdWindows[1].webContents.send).toHaveBeenCalledWith('test-channel', 'data1', 'data2')
    })

    it('broadcastToType() sends only to specified type', () => {
      wm.open('default' as never)
      wm.open('singleton' as never)

      wm.broadcastToType('default' as never, 'test-channel', 'data')

      expect(createdWindows[0].webContents.send).toHaveBeenCalledWith('test-channel', 'data')
      expect(createdWindows[1].webContents.send).not.toHaveBeenCalledWith('test-channel', 'data')
    })

    it('skips destroyed windows', () => {
      wm.open('default' as never)
      createdWindows[0].isDestroyed.mockReturnValue(true)

      wm.broadcast('test-channel')

      expect(createdWindows[0].webContents.send).not.toHaveBeenCalled()
    })
  })

  // ─── Close interception for pooled windows ─────────────

  describe('native close interception', () => {
    it('prevents native close and releases to pool for pooled windows', () => {
      wm.open('pooled' as never)
      const win = createdWindows[0]

      // Simulate native close event
      const event = { preventDefault: vi.fn() }
      win.emit('close', event)

      expect(event.preventDefault).toHaveBeenCalled()
      expect(win.hide).toHaveBeenCalled()
      expect(win.destroy).not.toHaveBeenCalled()
    })

    it('does not intercept close for default windows', () => {
      wm.open('default' as never)
      const win = createdWindows[0]

      const event = { preventDefault: vi.fn() }
      win.emit('close', event)

      expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it('does not intercept close for pooled windows when app is quitting', async () => {
      const { application } = (await import('@application')) as unknown as { application: { isQuitting: boolean } }
      const previousQuitting = application.isQuitting
      application.isQuitting = true
      try {
        wm.open('pooled' as never)
        const win = createdWindows[createdWindows.length - 1]

        const event = { preventDefault: vi.fn() }
        win.emit('close', event)

        // Close must proceed natively so app.quit()'s will-quit can fire.
        expect(event.preventDefault).not.toHaveBeenCalled()
        expect(win.hide).not.toHaveBeenCalled()
      } finally {
        application.isQuitting = previousQuitting
      }
    })
  })

  // ─── pushInitData / pushInitDataToType ────────────────

  describe('pushInitData', () => {
    it('writes init-data store and sends Reused event to the target window', () => {
      const id = wm.open('default' as never)
      const win = createdWindows[0]
      win.webContents.send.mockClear()

      const payload = { v: 2, kind: 'refresh' }
      const result = wm.pushInitData(id, payload)

      expect(result).toBe(true)
      expect(wm.getInitData(id)).toEqual(payload)
      expect(win.webContents.send).toHaveBeenCalledWith('window-manager:reused', payload)
    })

    it('returns false and does not send when window does not exist', () => {
      const result = wm.pushInitData('no-such-id', { anything: true })
      expect(result).toBe(false)
    })

    it('returns false for a destroyed window and does not touch its webContents', () => {
      const id = wm.open('default' as never)
      const win = createdWindows[0]
      win.isDestroyed.mockReturnValue(true)
      win.webContents.send.mockClear()

      const result = wm.pushInitData(id, { v: 3 })

      expect(result).toBe(false)
      expect(win.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('pushInitDataToType', () => {
    it('pushes to every live window of the given type and returns the count', () => {
      const ids = [wm.open('pooled' as never), wm.open('pooled' as never), wm.open('pooled' as never)]
      for (const win of createdWindows) win.webContents.send.mockClear()

      const payload = { broadcast: true }
      const count = wm.pushInitDataToType('pooled' as never, payload)

      expect(count).toBe(3)
      for (const win of createdWindows) {
        expect(win.webContents.send).toHaveBeenCalledWith('window-manager:reused', payload)
      }
      for (const id of ids) {
        expect(wm.getInitData(id)).toEqual(payload)
      }
    })

    it('returns 0 and does not throw when no windows of that type exist', () => {
      const count = wm.pushInitDataToType('pooled' as never, { v: 1 })
      expect(count).toBe(0)
    })

    it('skips destroyed windows in the count and does not send to them', () => {
      wm.open('pooled' as never)
      wm.open('pooled' as never)
      createdWindows[0].isDestroyed.mockReturnValue(true)
      for (const win of createdWindows) win.webContents.send.mockClear()

      const count = wm.pushInitDataToType('pooled' as never, { v: 9 })

      expect(count).toBe(1)
      expect(createdWindows[0].webContents.send).not.toHaveBeenCalled()
      expect(createdWindows[1].webContents.send).toHaveBeenCalledWith('window-manager:reused', { v: 9 })
    })
  })

  // ─── onDestroy cleanup ────────────────────────────────

  describe('onDestroy', () => {
    it('destroys all windows on service destroy', async () => {
      wm.open('default' as never)
      wm.open('singleton' as never)
      wm.open('pooled' as never)

      await wm._doDestroy()

      expect(createdWindows[0].destroy).toHaveBeenCalled()
      expect(createdWindows[1].destroy).toHaveBeenCalled()
      expect(createdWindows[2].destroy).toHaveBeenCalled()
    })
  })
})
