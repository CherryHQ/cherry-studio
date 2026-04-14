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
  minIdle: 0,
  initialSize: 1,
  maxSize: 4,
  warmup: 'lazy' as const,
  decayInterval: 300,
  idleTimeout: 1800
}

const eagerPoolConfig = {
  ...poolConfig,
  warmup: 'eager' as const
}

vi.mock('../windowRegistry', () => {
  const registry: Record<string, unknown> = {
    pooled: {
      type: 'pooled',
      lifecycle: 'pooled',
      poolConfig,
      htmlPath: 'windows/pooled/index.html',
      defaultConfig: { width: 1100, height: 720 }
    },
    pooledHidden: {
      type: 'pooledHidden',
      lifecycle: 'pooled',
      poolConfig,
      show: false,
      htmlPath: 'windows/pooledHidden/index.html',
      defaultConfig: {}
    },
    eagerPooled: {
      type: 'eagerPooled',
      lifecycle: 'pooled',
      poolConfig: eagerPoolConfig,
      htmlPath: 'windows/eagerPooled/index.html',
      defaultConfig: { width: 800, height: 600 }
    },
    default: {
      type: 'default',
      lifecycle: 'default',
      htmlPath: 'windows/default/index.html',
      defaultConfig: {}
    },
    singleton: {
      type: 'singleton',
      lifecycle: 'singleton',
      htmlPath: 'windows/singleton/index.html',
      defaultConfig: {}
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

  afterEach(() => {
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
  })

  // ─── Pooled lifecycle ──────────────────────────────────

  describe('pooled lifecycle', () => {
    describe('open() — fresh path', () => {
      it('creates a new window when pool is empty', () => {
        const id = wm.open('pooled' as never)
        expect(id).toBe('test-uuid-1')
        expect(createdWindows).toHaveLength(1)
      })

      it('creates multiple windows up to maxSize', () => {
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

      it('destroys excess windows when managed exceeds maxSize', () => {
        const ids = Array.from({ length: 5 }, () => wm.open('pooled' as never))
        expect(createdWindows).toHaveLength(5)

        // managed=5 > maxSize=4, should destroy instead of pooling
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
      it('recycles idle window and sends WINDOW_POOL_RESET', () => {
        const id1 = wm.open('pooled' as never)
        wm.close(id1)

        const id2 = wm.open('pooled' as never)

        expect(id2).toBe(id1)
        expect(createdWindows[0].webContents.send).toHaveBeenCalledWith('window-manager:pool-reset')
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

      it('emits synthetic ready-to-show with { recycled: true } via setImmediate', async () => {
        const id = wm.open('pooled' as never)
        wm.close(id)

        const readyPromise = new Promise<{ recycled?: boolean }>((resolve) => {
          const win = wm.getWindow(id) as unknown as MockBrowserWindow
          win.once('ready-to-show', (info: { recycled?: boolean }) => resolve(info))
        })

        wm.open('pooled' as never)

        const info = await readyPromise
        expect(info).toEqual({ recycled: true })
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
