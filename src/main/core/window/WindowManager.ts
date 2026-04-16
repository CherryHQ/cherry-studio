import { join } from 'node:path'

import { loggerService } from '@logger'
import { isDev, isMac } from '@main/constant'
import { BaseService, Emitter, type Event, Injectable, Phase, Priority, ServicePhase } from '@main/core/lifecycle'
import type { WindowType } from '@main/core/window/types'
import {
  type ManagedWindow,
  type OpenWindowArgs,
  type PoolConfig,
  type PoolState,
  VALID_WINDOW_TYPES,
  type WindowInfo,
  type WindowOptions
} from '@main/core/window/types'
import { getWindowTypeMetadata, mergeWindowConfig, WINDOW_TYPE_REGISTRY } from '@main/core/window/windowRegistry'
import { IpcChannel } from '@shared/IpcChannel'
import { app, BrowserWindow, screen, shell, type TitleBarOverlayOptions } from 'electron'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('WindowManager')

/** GC tick interval in ms */
const POOL_GC_INTERVAL = 120_000

/**
 * WindowManager — lifecycle-managed service for managing application windows.
 *
 * Handles window creation, lifecycle modes (default/singleton/pooled),
 * elastic pool reuse, IPC handlers, queries, and inter-service events.
 *
 * Domain services inject window-specific behavior via the `onWindowCreated` event,
 * which fires synchronously BEFORE content is loaded — guaranteeing that all
 * event listeners are attached before `ready-to-show` can fire.
 *
 * @see README.md for architecture overview and usage guide
 */
@Injectable('WindowManager')
@ServicePhase(Phase.WhenReady)
@Priority(5)
export class WindowManager extends BaseService {
  /** All managed windows keyed by UUID */
  private windows = new Map<string, ManagedWindow>()

  /** Window IDs indexed by type for fast lookups */
  private windowsByType = new Map<WindowType, Set<string>>()

  /** Pool state per window type */
  private pools = new Map<WindowType, PoolState>()

  /** One-time initialization data per window (consumed by renderer via getInitData IPC) */
  private initDataStore = new Map<string, unknown>()

  /** Single GC timer shared across all pools (null when no idle windows exist) */
  private poolGcTimer: ReturnType<typeof setInterval> | null = null

  // ─── Events ────────────────────────────────────────────────────

  private readonly _onWindowCreated = this.registerDisposable(new Emitter<ManagedWindow>())
  /** Fires when a new window is created. Domain services subscribe to inject behavior. */
  public readonly onWindowCreated: Event<ManagedWindow> = this._onWindowCreated.event

  private readonly _onWindowDestroyed = this.registerDisposable(new Emitter<ManagedWindow>())
  /** Fires when a window is truly destroyed (NOT on pool release). */
  public readonly onWindowDestroyed: Event<ManagedWindow> = this._onWindowDestroyed.event

  // ─── Lifecycle hooks ───────────────────────────────────────────

  protected override onInit(): void {
    this.updateDockVisibility()
    this.registerIpcHandlers()
  }

  /**
   * Warm up eager pools after all services are ready.
   * This runs after all bootstrap phases complete, ensuring domain services
   * have already subscribed to onWindowCreated.
   */
  protected override onAllReady(): void {
    for (const [type, metadata] of Object.entries(WINDOW_TYPE_REGISTRY)) {
      if (metadata.lifecycle === 'pooled' && metadata.poolConfig.warmup === 'eager') {
        const state = this.pools.get(type as WindowType)
        if (state?.suspended) continue
        this.warmPool(type as WindowType, metadata.poolConfig)
      }
    }
  }

  protected override onDestroy(): void {
    logger.info('Destroying, closing all windows...')

    if (this.poolGcTimer) {
      clearInterval(this.poolGcTimer)
      this.poolGcTimer = null
    }
    this.pools.clear()
    this.initDataStore.clear()

    for (const managed of this.windows.values()) {
      this.destroyWindow(managed.window)
    }
    this.windows.clear()
    this.windowsByType.clear()
  }

  // ─── IPC handlers ─────────────────────────────────────────────

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.WindowManager_Open, (_event, type: string, initData?: unknown) => {
      if (!VALID_WINDOW_TYPES.has(type)) {
        throw new Error(`Invalid window type: ${type}`)
      }
      return this.open(type as WindowType, initData !== undefined ? { initData } : undefined)
    })

    this.ipcHandle(IpcChannel.WindowManager_GetInitData, (event) => {
      const windowId = this.getWindowIdByWebContents(event.sender)
      if (!windowId) return null
      return this.getInitData(windowId)
    })

    this.ipcHandle(IpcChannel.WindowManager_Close, (event, type?: string) => {
      const windowId = this.resolveTargetWindowId(event.sender, type)
      if (!windowId) return false
      return this.close(windowId)
    })

    this.ipcHandle(IpcChannel.WindowManager_Show, (event, type?: string) => {
      const windowId = this.resolveTargetWindowId(event.sender, type)
      if (!windowId) return false
      return this.show(windowId)
    })

    this.ipcHandle(IpcChannel.WindowManager_Hide, (event, type?: string) => {
      const windowId = this.resolveTargetWindowId(event.sender, type)
      if (!windowId) return false
      return this.hide(windowId)
    })

    this.ipcHandle(IpcChannel.WindowManager_Minimize, (event, type?: string) => {
      const windowId = this.resolveTargetWindowId(event.sender, type)
      if (!windowId) return false
      return this.minimize(windowId)
    })

    this.ipcHandle(IpcChannel.WindowManager_Maximize, (event, type?: string) => {
      const windowId = this.resolveTargetWindowId(event.sender, type)
      if (!windowId) return false
      return this.maximize(windowId)
    })

    this.ipcHandle(IpcChannel.WindowManager_Focus, (event, type?: string) => {
      const windowId = this.resolveTargetWindowId(event.sender, type)
      if (!windowId) return false
      return this.focus(windowId)
    })
  }

  /**
   * Resolve target windowId from optional type string or IPC event sender.
   * - No type: resolve from sender webContents (self)
   * - With type: must be a valid singleton WindowType
   */
  private resolveTargetWindowId(sender: Electron.WebContents, type?: string): string | null {
    if (type) {
      if (!VALID_WINDOW_TYPES.has(type)) return null
      const metadata = getWindowTypeMetadata(type as WindowType)
      if (metadata.lifecycle !== 'singleton') return null
      const windows = this.getWindowsByType(type as WindowType)
      if (windows.length === 0) return null
      return windows[0].id
    }
    return this.getWindowIdByWebContents(sender) ?? null
  }

  // ─── Public API: Open / Create / Close / Destroy ──────────────

  /**
   * Open a window (lifecycle-aware).
   * - Singleton: shows and focuses existing, creates if not found
   * - Pooled: takes from pool or creates new; recycled windows get a Reused IPC
   * - Default: always creates a new window
   *
   * When `args.initData` is provided:
   * - The data is synchronously written into the init-data store before this
   *   method returns, so `getInitData(windowId)` always sees the fresh value.
   * - For **reuse** paths (singleton reopen / pool recycle), the data is ALSO
   *   pushed to the renderer via `IpcChannel.WindowManager_Reused` as the event
   *   payload. Fresh-window paths do not fire the event (renderer is not yet
   *   ready to listen).
   *
   * @param type - Window type to open
   * @param args - Optional `{ initData, options }` — both fields optional
   * @returns Window ID (UUID)
   */
  public open<T = unknown>(type: WindowType, args?: OpenWindowArgs<T>): string {
    const metadata = getWindowTypeMetadata(type)

    if (metadata.lifecycle === 'singleton') {
      const existing = this.findWindowByType(type)
      if (existing) {
        // Singleton reuse: push initData to renderer BEFORE show/focus, so the
        // UI updates in the same frame the window is re-activated.
        this.applyReusedInitData(existing, args?.initData)

        // Respect show: false — consumer manages visibility itself.
        // Only show/focus when show is 'auto' (default) or true.
        if (metadata.show !== false) {
          existing.window.show()
          existing.window.focus()
        }
        return existing.id
      }
    }

    if (metadata.lifecycle === 'pooled') {
      const state = this.pools.get(type)
      if (state?.suspended) {
        return this.createWindow(type, args)
      }
      return this.openPooled(type, metadata.poolConfig, args)
    }

    return this.createWindow(type, args)
  }

  /**
   * Force create a new window.
   * - Singleton windows: throws error if already exists
   * - Other types: always creates a new window
   *
   * Because `create()` never reuses an existing window, it never fires a
   * `WindowManager_Reused` event — only `setInitData` is called so the renderer
   * can read the payload via cold-start `getInitData` once it mounts.
   *
   * @param type - Window type to create
   * @param args - Optional `{ initData, options }` — both fields optional
   * @returns Window ID (UUID)
   * @throws Error if singleton window already exists
   */
  public create<T = unknown>(type: WindowType, args?: OpenWindowArgs<T>): string {
    const metadata = getWindowTypeMetadata(type)

    if (metadata.lifecycle === 'singleton') {
      const existing = this.findWindowByType(type)
      if (existing) {
        throw new Error(`Singleton window of type '${type}' already exists (id: ${existing.id})`)
      }
    }

    const windowId = this.createWindow(type, args)

    if (metadata.lifecycle === 'pooled') {
      const state = this.getOrCreatePoolState(type)
      if (!state.suspended) {
        state.managed.add(windowId)
      }
      if (!state.suspended && state.managed.size > metadata.poolConfig.maxSize) {
        logger.warn('Pool managed count exceeds maxSize via create()', {
          type,
          managed: state.managed.size,
          maxSize: metadata.poolConfig.maxSize
        })
      }
    }

    return windowId
  }

  /**
   * Apply init data to a window that is being re-used (singleton reopen or
   * pool recycle). Writes to the init-data store and pushes the same payload
   * to the renderer via `WindowManager_Reused` so the renderer can update
   * in-place without a round-trip.
   *
   * No-op when `data === undefined` — never fire empty Reused events.
   */
  private applyReusedInitData(managed: ManagedWindow, data: unknown): void {
    if (data === undefined) return
    this.setInitData(managed.id, data)
    if (!managed.window.isDestroyed()) {
      managed.window.webContents.send(IpcChannel.WindowManager_Reused, data)
    }
  }

  /**
   * Close a window.
   * Pooled windows are silently returned to the pool instead of being destroyed.
   * @param windowId - Window ID to close
   * @returns True if window was found and closed/returned
   */
  public close(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false

    for (const [type, state] of this.pools) {
      if (state.managed.has(windowId)) {
        const metadata = getWindowTypeMetadata(type)
        if (metadata.lifecycle === 'pooled') {
          if (state.suspended) break
          this.releaseToPool(windowId, managed, state, metadata.poolConfig, type)
          return true
        }
      }
    }

    this.destroyWindow(managed.window)
    return true
  }

  /**
   * Force destroy a window, bypassing pool return.
   * Always destroys the window regardless of lifecycle mode.
   * @param windowId - Window ID to destroy
   * @returns True if window was found and destroyed
   */
  public destroy(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    this.destroyWindow(managed.window)
    return true
  }

  // ─── Public API: Window operations ────────────────────────────

  public show(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    managed.window.show()
    this.updateDockVisibility()
    return true
  }

  public hide(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    managed.window.hide()
    this.updateDockVisibility()
    return true
  }

  public minimize(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    managed.window.minimize()
    return true
  }

  /** Maximize or unmaximize a window (toggle) */
  public maximize(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    if (managed.window.isMaximized()) {
      managed.window.unmaximize()
    } else {
      managed.window.maximize()
    }
    return true
  }

  public restore(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    managed.window.restore()
    return true
  }

  public focus(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    managed.window.focus()
    return true
  }

  // ─── Public API: Queries ──────────────────────────────────────

  /** Get BrowserWindow instance by window ID */
  public getWindow(windowId: string): BrowserWindow | undefined {
    return this.windows.get(windowId)?.window
  }

  /** Get window info by window ID */
  public getWindowInfo(windowId: string): WindowInfo | undefined {
    const managed = this.windows.get(windowId)
    if (!managed) return undefined
    return {
      id: managed.id,
      type: managed.type,
      title: managed.window.getTitle(),
      isVisible: managed.window.isVisible(),
      isFocused: managed.window.isFocused(),
      createdAt: managed.createdAt
    }
  }

  /** Get all managed windows info */
  public getAllWindows(): ManagedWindow[] {
    return Array.from(this.windows.values())
  }

  /** Get all windows of a specific type */
  public getWindowsByType(type: WindowType): WindowInfo[] {
    const windowIds = this.windowsByType.get(type)
    if (!windowIds) return []
    return Array.from(windowIds)
      .map((id) => this.getWindowInfo(id))
      .filter((info): info is WindowInfo => info !== undefined)
  }

  /** Get window ID from BrowserWindow instance */
  public getWindowId(window: BrowserWindow): string | undefined {
    for (const [id, managed] of this.windows.entries()) {
      if (managed.window === window) return id
    }
    return undefined
  }

  /** Get window ID from WebContents (e.g., from IPC event.sender) */
  public getWindowIdByWebContents(webContents: Electron.WebContents): string | undefined {
    const browserWindow = BrowserWindow.fromWebContents(webContents)
    if (!browserWindow) return undefined
    return this.getWindowId(browserWindow)
  }

  /** Number of managed windows */
  public get count(): number {
    return this.windows.size
  }

  // ─── Public API: Title bar overlay ────────────────────────────

  /**
   * Update title bar overlay colors on all windows that have overlay configured.
   * Only affects window types whose defaultConfig includes titleBarOverlay.
   */
  public setTitleBarOverlay(options: TitleBarOverlayOptions): void {
    for (const [type, windowIds] of this.windowsByType) {
      const metadata = getWindowTypeMetadata(type)
      if (!metadata.defaultConfig.titleBarOverlay) continue
      for (const id of windowIds) {
        const managed = this.windows.get(id)
        if (managed && !managed.window.isDestroyed()) {
          managed.window.setTitleBarOverlay(options)
        }
      }
    }
  }

  // ─── Public API: Broadcast (Cherry Studio extension) ──────────

  /**
   * Broadcast an IPC message to all managed windows.
   * Skips destroyed windows automatically.
   */
  public broadcast(channel: string, ...args: unknown[]): void {
    for (const managed of this.windows.values()) {
      if (!managed.window.isDestroyed()) {
        managed.window.webContents.send(channel, ...args)
      }
    }
  }

  /**
   * Broadcast an IPC message to windows of a specific type.
   */
  public broadcastToType(type: WindowType, channel: string, ...args: unknown[]): void {
    const windowIds = this.windowsByType.get(type)
    if (!windowIds) return
    for (const id of windowIds) {
      const managed = this.windows.get(id)
      if (managed && !managed.window.isDestroyed()) {
        managed.window.webContents.send(channel, ...args)
      }
    }
  }

  // ─── Public API: Init data ────────────────────────────────────

  /** Store initialization data for a window (retrieved once by renderer via getInitData IPC) */
  public setInitData(windowId: string, data: unknown): void {
    this.initDataStore.set(windowId, data)
  }

  /** Retrieve initialization data for a window */
  public getInitData(windowId: string): unknown | null {
    return this.initDataStore.get(windowId) ?? null
  }

  // ─── Public API: Pool management ──────────────────────────────

  /**
   * Suspend a pool, destroying idle windows and preventing warmup / pool
   * tracking until resumePool() is called.
   * In-use windows are left alone — callers close them at their own pace.
   * @returns Number of idle windows destroyed
   */
  public suspendPool(type: WindowType): number {
    const metadata = getWindowTypeMetadata(type)
    if (metadata.lifecycle !== 'pooled') {
      logger.warn('suspendPool() called on non-pooled window type', { type, lifecycle: metadata.lifecycle })
      return 0
    }

    const state = this.getOrCreatePoolState(type)
    state.suspended = true

    if (state.idle.length === 0) return 0

    const toDestroy = state.idle.slice()
    let count = 0
    for (const windowId of toDestroy) {
      const managed = this.windows.get(windowId)
      if (managed) {
        this.destroyWindow(managed.window)
        count++
      }
    }

    logger.info('Pool suspended', { type, count })
    this.updateDockVisibility()
    return count
  }

  /**
   * Resume a previously suspended pool.
   * If pool warmup is 'eager', immediately pre-creates windows to initialSize.
   */
  public resumePool(type: WindowType): void {
    const metadata = getWindowTypeMetadata(type)
    if (metadata.lifecycle !== 'pooled') {
      logger.warn('resumePool() called on non-pooled window type', { type, lifecycle: metadata.lifecycle })
      return
    }

    const state = this.pools.get(type)
    if (!state || !state.suspended) return

    state.suspended = false
    state.lastOpenAt = Date.now()

    if (metadata.poolConfig.warmup === 'eager') {
      this.warmPool(type, metadata.poolConfig)
    }

    logger.info('Pool resumed', { type })
  }

  // ─── Pool internals ───────────────────────────────────────────

  /**
   * Open a pooled window: recycle from idle pool or create fresh.
   *
   * Recycled windows:
   * - Receive `WindowManager_Reused` IPC **only when** `args.initData` is
   *   provided — the event payload is that initData. No data → no event.
   * - Are shown/focused immediately based on metadata `show` behavior.
   */
  private openPooled<T>(type: WindowType, poolConfig: PoolConfig, args?: OpenWindowArgs<T>): string {
    const state = this.getOrCreatePoolState(type)

    // Try to find a healthy idle window
    while (state.idle.length > 0) {
      const candidateId = state.idle.shift()!
      const candidate = this.windows.get(candidateId)

      if (!candidate || candidate.window.isDestroyed() || candidate.window.webContents.isCrashed()) {
        state.managed.delete(candidateId)
        if (candidate) {
          this.cleanupWindowTracking(candidateId, candidate.type)
        }
        logger.warn('Pool idle window unhealthy, skipping', { windowId: candidateId, type })
        continue
      }

      // Reset native geometry state to match fresh-creation config
      this.resetPooledWindowGeometry(candidate.window, type, args?.options)

      // Push initData into the store and send it in the Reused event payload.
      // No-op when initData is undefined — we never fire empty Reused events.
      this.applyReusedInitData(candidate, args?.initData)

      // Show recycled window based on metadata
      const showBehavior = getWindowTypeMetadata(type).show ?? 'auto'
      if (showBehavior === 'auto' || showBehavior === true) {
        candidate.window.show()
        candidate.window.focus()
      }

      state.lastOpenAt = Date.now()
      logger.debug('Window recycled from pool', {
        windowId: candidateId,
        type,
        idle: state.idle.length,
        managed: state.managed.size
      })
      return candidateId
    }

    // Fresh path: create new window and track in pool
    const windowId = this.createWindow(type, args)
    state.managed.add(windowId)
    state.lastOpenAt = Date.now()

    if (state.managed.size > poolConfig.maxSize) {
      logger.warn('Pool managed count exceeds maxSize', {
        type,
        managed: state.managed.size,
        maxSize: poolConfig.maxSize
      })
    }

    logger.debug('Pool fresh window created', {
      windowId,
      type,
      idle: state.idle.length,
      managed: state.managed.size
    })
    return windowId
  }

  /**
   * Reset a recycled pooled window's native geometry state.
   * Restores from fullscreen/maximized/minimized, then applies the merged config.
   * Calls setBounds twice to work around Windows cross-DPI multi-monitor bug (Electron #16444).
   */
  private resetPooledWindowGeometry(window: BrowserWindow, type: WindowType, options?: Partial<WindowOptions>): void {
    if (window.isFullScreen()) window.setFullScreen(false)
    if (window.isMaximized()) window.unmaximize()
    if (window.isMinimized()) window.restore()

    const config = mergeWindowConfig(type, options)
    const { width, height } = config
    const setBoundsMethod = config.useContentSize
      ? (b: Electron.Rectangle) => window.setContentBounds(b)
      : (b: Electron.Rectangle) => window.setBounds(b)

    if (config.x !== undefined && config.y !== undefined && width !== undefined && height !== undefined) {
      const bounds = { x: config.x, y: config.y, width, height }
      setBoundsMethod(bounds) // 1st: reposition (may use stale DPI)
      setBoundsMethod(bounds) // 2nd: correct DPI after context switch
    } else if (width !== undefined && height !== undefined) {
      const cursor = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(cursor)
      // macOS centers on display.bounds (full screen incl. menu bar);
      // Windows/Linux use display.workArea (excl. taskbar)
      const area = isMac ? display.bounds : display.workArea
      const bounds = {
        x: Math.round(area.x + (area.width - width) / 2),
        y: Math.round(area.y + (area.height - height) / 2),
        width,
        height
      }
      setBoundsMethod(bounds)
      setBoundsMethod(bounds)
    } else if (config.x !== undefined && config.y !== undefined) {
      window.setPosition(config.x, config.y)
    } else {
      window.center()
    }
  }

  /** Release a window back to the pool instead of destroying it */
  private releaseToPool(
    windowId: string,
    managed: ManagedWindow,
    state: PoolState,
    poolConfig: PoolConfig,
    type: WindowType
  ): void {
    // Idempotency guard
    if (state.idle.includes(windowId)) {
      logger.debug('Pool release skipped - window already idle', { windowId, type })
      return
    }

    // Excess capacity: destroy immediately instead of pooling.
    if (state.managed.size > poolConfig.maxSize) {
      if (!managed.window.isDestroyed()) {
        managed.window.hide()
      }
      this.destroyWindow(managed.window)
      this.initDataStore.delete(windowId)
      logger.debug('Pool over maxSize - window destroyed on release', {
        windowId,
        type,
        managed: state.managed.size,
        maxSize: poolConfig.maxSize
      })
      this.updateDockVisibility()
      return
    }

    if (!managed.window.isDestroyed()) {
      managed.window.hide()
    }

    // Clear session-scoped init data (after subscribers have had a chance to read it)
    this.initDataStore.delete(windowId)

    state.idle.push(windowId)
    logger.debug('Window released to pool', {
      windowId,
      type,
      idle: state.idle.length,
      managed: state.managed.size
    })

    this.startPoolGc()

    // Lazy warmup: backfill to initialSize after first release
    if (poolConfig.warmup === 'lazy' && state.managed.size < poolConfig.initialSize) {
      const deficit = poolConfig.initialSize - state.managed.size
      for (let i = 0; i < deficit; i++) {
        this.createPooledIdleWindow(type, state)
      }
      logger.debug('Pool lazy warmup backfill', {
        type,
        deficit,
        idle: state.idle.length,
        managed: state.managed.size
      })
    }

    this.updateDockVisibility()
  }

  /** Create a hidden window and add it directly to the pool as idle */
  private createPooledIdleWindow(type: WindowType, state: PoolState): void {
    const windowId = this.createWindow(type, undefined, true)
    state.managed.add(windowId)
    state.idle.push(windowId)
    logger.debug('Pool idle window created', { windowId, type })
  }

  /** Pre-create idle windows for eager warmup pools */
  private warmPool(type: WindowType, poolConfig: PoolConfig): void {
    const state = this.getOrCreatePoolState(type)
    const count = poolConfig.initialSize - state.managed.size
    for (let i = 0; i < count; i++) {
      this.createPooledIdleWindow(type, state)
    }
    if (count > 0) {
      this.startPoolGc()
      logger.info('Pool warmed', { type, count })
    }
  }

  /** Get or create PoolState for a window type */
  private getOrCreatePoolState(type: WindowType): PoolState {
    let state = this.pools.get(type)
    if (!state) {
      state = {
        idle: [],
        managed: new Set(),
        lastOpenAt: Date.now(),
        lastDecayAt: Date.now(),
        suspended: false
      }
      this.pools.set(type, state)
    }
    return state
  }

  // ─── GC Timer ─────────────────────────────────────────────────

  /** Start the shared GC timer if not already running */
  private startPoolGc(): void {
    if (this.poolGcTimer) return
    this.poolGcTimer = setInterval(() => this.poolGcTick(), POOL_GC_INTERVAL)
    logger.debug('Pool GC timer started', { intervalMs: POOL_GC_INTERVAL })
  }

  /** Single GC tick — handles decay and idle timeout for all pool types */
  private poolGcTick(): void {
    const now = Date.now()
    let hasIdle = false

    for (const [type, state] of this.pools) {
      if (state.idle.length === 0) continue
      hasIdle = true

      const metadata = getWindowTypeMetadata(type)
      if (metadata.lifecycle !== 'pooled') continue
      const pool = metadata.poolConfig

      // Idle timeout (priority 1): release ALL idle if no open() for idleTimeout seconds
      if (pool.idleTimeout > 0 && now - state.lastOpenAt > pool.idleTimeout * 1000) {
        this.destroyAllIdle(type, state)
        continue
      }

      // Decay (priority 2): evict one idle window above minIdle
      if (pool.decayInterval > 0 && state.idle.length > pool.minIdle) {
        if (now - state.lastOpenAt > pool.decayInterval * 1000 && now - state.lastDecayAt > pool.decayInterval * 1000) {
          this.destroyOneIdle(type, state)
          state.lastDecayAt = now
        }
      }
    }

    if (!hasIdle) {
      clearInterval(this.poolGcTimer!)
      this.poolGcTimer = null
      logger.debug('Pool GC timer stopped - no idle windows')
    }
  }

  /** Destroy all idle windows for a pool type */
  private destroyAllIdle(type: WindowType, state: PoolState): void {
    const toDestroy = state.idle.slice()
    const count = toDestroy.length
    for (const id of toDestroy) {
      const managed = this.windows.get(id)
      if (managed) {
        this.destroyWindow(managed.window)
      }
    }
    logger.debug('Pool idle timeout - all idle destroyed', { type, count })
  }

  /** Destroy the oldest idle window for a pool type */
  private destroyOneIdle(type: WindowType, state: PoolState): void {
    const id = state.idle.shift()
    if (!id) return
    const managed = this.windows.get(id)
    if (managed) {
      this.destroyWindow(managed.window)
    }
    logger.debug('Pool decay - idle window destroyed', { type, windowId: id })
  }

  // ─── Window creation & lifecycle ──────────────────────────────

  /**
   * Internal method to create a new window instance.
   *
   * CRITICAL TIMING CONTRACT:
   * 1. new BrowserWindow(config)
   * 2. setupWindowListeners() — close/closed/show/hide
   * 3. windows.set() — add to registry
   * 4. _onWindowCreated.fire() — domain services inject behavior
   * 5. loadWindowContent() — load HTML (ready-to-show may fire after this)
   *
   * @param type - Window type to create
   * @param args - Optional `{ initData, options }`; initData is stored synchronously before returning
   * @param suppressAutoShow - When true, skip auto-show handler (used for pool idle windows)
   * @returns Window ID (UUID)
   */
  private createWindow<T>(type: WindowType, args?: OpenWindowArgs<T>, suppressAutoShow = false): string {
    const metadata = getWindowTypeMetadata(type)
    const windowId = uuidv4()
    const config = mergeWindowConfig(type, args?.options)
    const showBehavior = metadata.show ?? 'auto'

    // Resolve preload path
    const preloadVariant = metadata.preload ?? 'standard'
    const preloadPath =
      preloadVariant === 'standard'
        ? join(__dirname, '../preload/index.js')
        : preloadVariant === 'simplest'
          ? join(__dirname, '../preload/simplest.js')
          : undefined

    // 1. Create BrowserWindow
    const window = new BrowserWindow({
      ...config,
      show: showBehavior === true,
      webPreferences: {
        ...(preloadPath ? { preload: preloadPath } : {}),
        ...config.webPreferences
      }
    })

    // Intercept external links: open in system browser
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http:') || url.startsWith('https:')) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    window.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith('http:') || url.startsWith('https:')) {
        const currentURL = window.webContents.getURL()
        if (currentURL && new URL(url).origin !== new URL(currentURL).origin) {
          event.preventDefault()
          void shell.openExternal(url)
        }
      }
    })

    // 2. Setup event listeners
    this.setupWindowListeners(windowId, window)

    // Auto-show on ready-to-show (suppressed for pool idle windows).
    // Windows with show: false opt out entirely — their owner drives visibility
    // on its own schedule (see e.g. SelectionService.processAction).
    if (showBehavior === 'auto' && !suppressAutoShow) {
      window.once('ready-to-show', () => {
        if (!window.isDestroyed()) window.show()
      })
    }

    // 3. Store window reference
    const managedWindow: ManagedWindow = {
      id: windowId,
      type,
      window,
      metadata,
      createdAt: Date.now()
    }
    this.windows.set(windowId, managedWindow)

    if (!this.windowsByType.has(type)) {
      this.windowsByType.set(type, new Set())
    }
    this.windowsByType.get(type)!.add(windowId)

    // 4. Fire event — domain services inject behavior HERE (before content loads)
    this._onWindowCreated.fire(managedWindow)

    // 4a. Apply declarative platform quirks (method-slot monkey-patches).
    // Runs AFTER onWindowCreated so domain-service listeners attach first; the quirk
    // wrappers then transparently apply around any subsequent hide()/show()/close().
    this.applyQuirks(managedWindow)

    // 5. Store initData synchronously — renderer's cold-start `getInitData`
    //    invoke (fired after mount) is guaranteed to see the fresh value.
    //    Never fire WindowManager_Reused for fresh windows: the renderer is
    //    not yet ready to listen. Fresh windows must PULL via getInitData.
    if (args?.initData !== undefined) {
      this.setInitData(windowId, args.initData)
    }

    // 6. Load content (skip if htmlPath is empty — domain service handles loading)
    if (metadata.htmlPath) {
      this.loadWindowContent(windowId, window, metadata.htmlPath)
    }

    logger.debug('Window created', { windowId, type })
    return windowId
  }

  /** Force-destroy a BrowserWindow. Skips the `close` event — only `closed` fires. */
  private destroyWindow(window: BrowserWindow): void {
    if (window.isDestroyed()) return
    window.destroy()
  }

  /** Find first window of a specific type */
  private findWindowByType(type: WindowType): ManagedWindow | undefined {
    const windowIds = this.windowsByType.get(type)
    if (!windowIds || windowIds.size === 0) return undefined
    const firstId = windowIds.values().next().value
    if (!firstId) return undefined
    return this.windows.get(firstId)
  }

  // ─── Window event listeners ───────────────────────────────────

  private setupWindowListeners(windowId: string, window: BrowserWindow): void {
    window.on('show', () => this.updateDockVisibility())
    window.on('hide', () => this.updateDockVisibility())
    window.on('minimize', () => this.updateDockVisibility())
    window.on('restore', () => this.updateDockVisibility())

    // Intercept native close for pooled windows — hide and return to pool
    window.on('close', (event) => {
      for (const [type, state] of this.pools) {
        if (state.managed.has(windowId)) {
          const metadata = getWindowTypeMetadata(type)
          if (metadata.lifecycle === 'pooled') {
            if (state.suspended) return // let native close proceed
            event.preventDefault()
            if (state.idle.includes(windowId)) return // already idle
            const managed = this.windows.get(windowId)
            if (managed) {
              this.releaseToPool(windowId, managed, state, metadata.poolConfig, type)
            }
            return
          }
        }
      }
    })

    window.on('closed', () => {
      window.removeAllListeners()

      const managed = this.windows.get(windowId)
      if (managed) {
        this.cleanupWindowTracking(windowId, managed.type)
        this._onWindowDestroyed.fire(managed)
        logger.debug('Window closed', { windowId, type: managed.type })
      }

      // Pool cleanup
      for (const [type, state] of this.pools) {
        if (state.managed.has(windowId)) {
          state.managed.delete(windowId)
          const idx = state.idle.indexOf(windowId)
          if (idx !== -1) state.idle.splice(idx, 1)
          logger.debug('Pool window removed on close', {
            windowId,
            type,
            idle: state.idle.length,
            managed: state.managed.size
          })
          break
        }
      }

      this.updateDockVisibility()
    })
  }

  /** Remove a window from type tracking and the main window map */
  private cleanupWindowTracking(windowId: string, type: WindowType): void {
    const typeSet = this.windowsByType.get(type)
    if (typeSet) {
      typeSet.delete(windowId)
      if (typeSet.size === 0) {
        this.windowsByType.delete(type)
      }
    }
    this.windows.delete(windowId)
    this.initDataStore.delete(windowId)
  }

  // ─── Content loading ──────────────────────────────────────────

  private loadWindowContent(windowId: string, window: BrowserWindow, htmlPath: string): void {
    if (isDev && process.env.ELECTRON_RENDERER_URL) {
      const url = `${process.env.ELECTRON_RENDERER_URL}/${htmlPath}`
      logger.debug('Loading dev server', { windowId, url })
      window.loadURL(url).catch((err) => {
        logger.error('Failed to load window content', { windowId, url, error: String(err) })
      })
    } else {
      const filePath = join(__dirname, `../renderer/${htmlPath}`)
      logger.debug('Loading production build', { windowId, filePath })
      window.loadFile(filePath).catch((err) => {
        logger.error('Failed to load window content', { windowId, filePath, error: String(err) })
      })
    }
  }

  // ─── Platform quirks ──────────────────────────────────────────

  /**
   * Apply declarative OS quirks to a freshly-created window by monkey-patching
   * the native instance methods. Consumers continue calling `window.hide()` /
   * `window.show()` as usual; the wrappers transparently run the pre/post hooks.
   *
   * The native method is captured via `.bind(w)` so inner Electron C++ bindings
   * still see the correct `this`; other properties (`webContents`, EventEmitter
   * `.on/.once`, etc.) remain untouched.
   */
  private applyQuirks(managed: ManagedWindow): void {
    const q = managed.metadata.quirks
    if (!q) return
    const w = managed.window

    // [macOS] Exit-path methods (hide/close): preserve HEAD's ordering —
    //   focus-down (begin guard) → native hide/close → sendInputEvent → 50ms restore (end guard)
    if (isMac && (q.macRestoreFocusOnHide || q.macClearHoverOnHide)) {
      const originalHide = w.hide.bind(w)
      const originalClose = w.close.bind(w)

      w.hide = () => {
        const guard = q.macRestoreFocusOnHide ? this.beginMacFocusGuard() : null
        originalHide()
        if (q.macClearHoverOnHide && !w.isDestroyed()) {
          // [macOS] hacky way — because the window may not be a FOCUSED window,
          // the hover status remains on next show. Send a synthetic mouseMove
          // at (-1, -1) to force the hover state off.
          w.webContents.sendInputEvent({ type: 'mouseMove', x: -1, y: -1 })
        }
        if (guard) this.endMacFocusGuard(guard)
      }

      // close only wraps the focus dance; hover clearing would be meaningless
      // because webContents is about to be destroyed.
      if (q.macRestoreFocusOnHide) {
        w.close = () => {
          const guard = this.beginMacFocusGuard()
          originalClose()
          this.endMacFocusGuard(guard)
        }
      }
    }

    // [macOS] Show-path methods (show/showInactive): post-hook re-applies alwaysOnTop level.
    if (isMac && q.macReapplyAlwaysOnTop) {
      const level = q.macReapplyAlwaysOnTop === true ? 'floating' : q.macReapplyAlwaysOnTop
      const originalShow = w.show.bind(w)
      const originalShowInactive = w.showInactive.bind(w)
      w.show = () => {
        originalShow()
        if (!w.isDestroyed()) w.setAlwaysOnTop(true, level)
      }
      w.showInactive = () => {
        originalShowInactive()
        if (!w.isDestroyed()) w.setAlwaysOnTop(true, level)
      }
    }
  }

  // [macOS] a HACKY way
  // make sure other windows do not bring to front when the window is hidden
  // get all focusable windows and set them to not focusable
  private beginMacFocusGuard(): BrowserWindow[] {
    const focusableWindows: BrowserWindow[] = []
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && window.isVisible()) {
        if (window.isFocusable()) {
          focusableWindows.push(window)
          window.setFocusable(false)
        }
      }
    }
    return focusableWindows
  }

  // set them back to focusable after 50ms
  private endMacFocusGuard(focusableWindows: BrowserWindow[]): void {
    setTimeout(() => {
      for (const window of focusableWindows) {
        if (!window.isDestroyed()) {
          window.setFocusable(true)
        }
      }
    }, 50)
  }

  // ─── macOS Dock visibility ────────────────────────────────────

  private dockShouldBeVisible = false

  /**
   * Update macOS Dock icon visibility based on visible windows.
   * Windows with showInDock: false do not affect Dock visibility.
   */
  private updateDockVisibility(): void {
    if (!isMac) return

    const hasVisibleDockWindow = Array.from(this.windows.values()).some(
      (managed) =>
        managed.metadata.showInDock !== false &&
        !managed.window.isDestroyed() &&
        (managed.window.isVisible() || managed.window.isMinimized())
    )

    if (hasVisibleDockWindow && !this.dockShouldBeVisible) {
      this.dockShouldBeVisible = true
      void app.dock?.show().then(() => {
        if (!this.dockShouldBeVisible) app.dock?.hide()
      })
    } else if (!hasVisibleDockWindow && this.dockShouldBeVisible) {
      this.dockShouldBeVisible = false
      app.dock?.hide()
    }
  }
}
