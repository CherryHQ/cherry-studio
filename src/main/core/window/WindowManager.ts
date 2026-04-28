import { join } from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isDev, isMac } from '@main/constant'
import {
  BaseService,
  type Disposable,
  Emitter,
  type Event,
  Injectable,
  Phase,
  Priority,
  ServicePhase
} from '@main/core/lifecycle'
import { applyWindowBehavior, BehaviorController } from '@main/core/window/behavior'
import { applyWindowQuirks } from '@main/core/window/quirks'
import type { WindowType } from '@main/core/window/types'
import {
  type ManagedWindow,
  type OpenWindowArgs,
  type PoolConfig,
  type SingletonConfig,
  VALID_WINDOW_TYPES,
  type WarmupState,
  type WarmupStateInit,
  type WindowInfo,
  type WindowOptions
} from '@main/core/window/types'
import { getWindowTypeMetadata, mergeWindowOptions, WINDOW_TYPE_REGISTRY } from '@main/core/window/windowRegistry'
import { IpcChannel } from '@shared/IpcChannel'
import { app, BrowserWindow, screen, shell, type TitleBarOverlayOptions } from 'electron'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('WindowManager')

/** GC tick interval in ms — minute-grained precision is sufficient for decay/inactivity. */
const WARMUP_GC_INTERVAL = 60_000

/**
 * Structured warmup operation tags. Every warmup state mutation logs exactly one
 * `warmup[type] <op>` line carrying the full `{idle, managed, inflight}` snapshot,
 * so a type's timeline can be reconstructed by grepping `op:` or `warmup[<type>]`.
 *
 * Naming convention: ops that only fire on pool code paths carry the `pool-`
 * prefix; ops that only fire on singleton code paths carry the `singleton-`
 * prefix; ops emitted from code paths shared by both lifecycles (idle-queue
 * bookkeeping, GC trim, warmup entry points) carry no prefix.
 */
type WarmupOp =
  // Shared — fired from code paths used by both pool and singleton
  | 'create-idle'
  | 'release-skip'
  | 'inactivity-trim'
  | 'warmup'
  // Pool-only — fired exclusively from pool code paths
  | 'pool-recycle'
  | 'pool-create-fresh'
  | 'pool-release'
  | 'pool-release-destroy-disabled'
  | 'pool-release-destroy-overcap'
  | 'pool-decay'
  | 'pool-lazy-backfill'
  | 'pool-suspend'
  | 'pool-resume'
  // Singleton-only — fired exclusively from singleton code paths
  | 'singleton-hide'
  | 'singleton-reuse'

/**
 * Default warmup mode when not explicitly set: 'eager' when the user has
 * expressed an intent to keep windows pre-warmed (`standbySize` or
 * `initialSize` set), otherwise 'lazy'.
 */
function defaultWarmup(cfg: PoolConfig): 'eager' | 'lazy' {
  return (cfg.standbySize ?? 0) > 0 || (cfg.initialSize ?? 0) > 0 ? 'eager' : 'lazy'
}

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
 * @see docs/references/window-manager/README.md for architecture overview, usage guide, and API reference
 */
@Injectable('WindowManager')
@ServicePhase(Phase.WhenReady)
@Priority(5)
export class WindowManager extends BaseService {
  /** All managed windows keyed by UUID */
  private windows = new Map<string, ManagedWindow>()

  /** Window IDs indexed by type for fast lookups */
  private windowsByType = new Map<WindowType, Set<string>>()

  /** Warmup state per window type — shared by pooled and singleton lifecycles */
  private warmupStates = new Map<WindowType, WarmupState>()

  /** One-time initialization data per window (consumed by renderer via getInitData IPC) */
  private initDataStore = new Map<string, unknown>()

  /**
   * Runtime overrides and setters for the declarative `behavior` layer
   * (`hideOnBlur`, `alwaysOnTop`, `macShowInDock`). Exposed as `wm.behavior`;
   * see {@link BehaviorController} for the full API.
   *
   * The host callbacks wire controller ↔ WM in one direction: the controller
   * can resolve a `ManagedWindow` by id and trigger a Dock recompute, but
   * knows nothing else about WM internals.
   */
  public readonly behavior = new BehaviorController({
    getManagedWindow: (id) => this.windows.get(id),
    updateDockVisibility: () => this.updateDockVisibility()
  })

  /** Single GC timer shared across all warmup states (null when no idle windows exist) */
  private warmupGcTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Window types whose `idle.length > 0`. Lets `warmupGcTick` iterate only over
   * entries with actual work to do, avoiding empty-state overhead. Subset of
   * `warmupStates.keys()`. Maintained on every push/shift/splice of `state.idle`.
   * The `warmupGcTick` defends against brief inconsistency (between
   * `destroyWindow()` and the async `closed` listener splice) by re-checking
   * `state.idle.length === 0` inside the loop.
   */
  private activeWarmupTypes = new Set<WindowType>()

  // ─── Events ────────────────────────────────────────────────────

  private readonly _onWindowCreated = this.registerDisposable(new Emitter<ManagedWindow>())
  /** Fires when a new window is created. Domain services subscribe to inject behavior. */
  public readonly onWindowCreated: Event<ManagedWindow> = this._onWindowCreated.event

  private readonly _onWindowDestroyed = this.registerDisposable(new Emitter<ManagedWindow>())
  /** Fires when a window is truly destroyed (NOT on pool release). */
  public readonly onWindowDestroyed: Event<ManagedWindow> = this._onWindowDestroyed.event

  /**
   * Subscribe to window creations for a specific {@link WindowType}. Equivalent to
   * `onWindowCreated` + an inline type filter — prefer this when you only care
   * about one window type, which is the typical consumer pattern.
   *
   * Fires exactly once per fresh `BrowserWindow` instance matching `type`;
   * pool recycles and singleton reopens do NOT re-fire. Returns a `Disposable`
   * to unsubscribe (usually passed to `this.registerDisposable(...)`).
   */
  public onWindowCreatedByType(type: WindowType, listener: (managed: ManagedWindow) => void): Disposable {
    return this.onWindowCreated((managed) => {
      if (managed.type === type) listener(managed)
    })
  }

  /**
   * Subscribe to window destructions for a specific {@link WindowType}. Fires
   * when the underlying `BrowserWindow` is truly destroyed — not on pool release.
   */
  public onWindowDestroyedByType(type: WindowType, listener: (managed: ManagedWindow) => void): Disposable {
    return this.onWindowDestroyed((managed) => {
      if (managed.type === type) listener(managed)
    })
  }

  // ─── Lifecycle hooks ───────────────────────────────────────────

  protected override onInit(): void {
    this.updateDockVisibility()
    this.registerIpcHandlers()
  }

  /**
   * Warm up eager pools and singletons after all services are ready.
   * This runs after all bootstrap phases complete, ensuring domain services
   * have already subscribed to onWindowCreated.
   */
  protected override onAllReady(): void {
    for (const [type, metadata] of Object.entries(WINDOW_TYPE_REGISTRY)) {
      if (metadata.lifecycle === 'pooled') {
        this.validatePoolConfig(type as WindowType, metadata.poolConfig)
        const warmup = metadata.poolConfig.warmup ?? defaultWarmup(metadata.poolConfig)
        if (warmup !== 'eager') continue
        const state = this.warmupStates.get(type as WindowType)
        if (state?.suspended) continue
        this.warmPool(type as WindowType, metadata.poolConfig)
        continue
      }
      if (metadata.lifecycle === 'singleton' && metadata.singletonConfig) {
        const validated = this.validateSingletonConfig(type as WindowType, metadata.singletonConfig)
        if (validated.warmup === 'eager') {
          this.warmSingleton(type as WindowType, validated)
        }
      }
    }
  }

  /** Warn on pool configurations that express contradictory intent. */
  private validatePoolConfig(type: WindowType, cfg: PoolConfig): void {
    const recycleMin = cfg.recycleMinSize ?? 0
    const recycleMax = cfg.recycleMaxSize ?? 0
    if (recycleMin > 0 && recycleMax <= 0) {
      logger.warn(
        'Pool config: recycleMinSize is set without recycleMaxSize — recycling is disabled, recycleMinSize has no effect',
        { type, recycleMinSize: recycleMin, recycleMaxSize: recycleMax }
      )
    }
    const standby = cfg.standbySize ?? 0
    const initialSize = cfg.initialSize ?? 0
    if (standby === 0 && recycleMin === 0 && recycleMax === 0 && initialSize === 0) {
      logger.warn('Pool config: all pool sizes are zero/undefined — consider using lifecycle: "default" instead', {
        type
      })
    }
  }

  /**
   * Validate a {@link SingletonConfig}. Normalizes invalid `retentionTime`
   * values (non-integer, negative ≠ -1, NaN/Infinity) back to `undefined`
   * with a warn log. Also warns on `{ warmup: 'eager' }` without retention —
   * the pre-warmed hidden instance would be destroyed on first close and
   * never recreated, reducing warmup to a single-use optimization.
   *
   * Returns the (possibly normalized) config. Callers should use the returned
   * value when deriving {@link WarmupStateInit}.
   */
  private validateSingletonConfig(type: WindowType, cfg: SingletonConfig): SingletonConfig {
    const { warmup, retentionTime } = cfg
    let normalized = retentionTime

    if (normalized !== undefined) {
      const isInvalid =
        !Number.isFinite(normalized) || !Number.isInteger(normalized) || (normalized < 0 && normalized !== -1)
      if (isInvalid) {
        logger.warn('Singleton config: invalid retentionTime, falling back to undefined', { type, retentionTime })
        normalized = undefined
      }
    }

    if (warmup === 'eager' && (normalized === undefined || normalized === 0)) {
      logger.warn(
        'Singleton config: warmup "eager" without retentionTime will destroy the hidden instance on first close. ' +
          'Use retentionTime: -1 to keep forever, or a positive number to keep for N seconds.',
        { type }
      )
    }

    return normalized === retentionTime ? cfg : { ...cfg, retentionTime: normalized }
  }

  protected override onDestroy(): void {
    logger.info('Destroying, closing all windows...')

    if (this.warmupGcTimer) {
      clearInterval(this.warmupGcTimer)
      this.warmupGcTimer = null
    }
    this.activeWarmupTypes.clear()
    // Signal any pending setImmediate standby replenish callbacks to bail out.
    // They check `state.suspended` at execution time.
    for (const state of this.warmupStates.values()) {
      state.suspended = true
    }
    this.warmupStates.clear()
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

    this.ipcHandle(IpcChannel.WindowManager_Close, (event) => {
      const windowId = this.getWindowIdByWebContents(event.sender)
      if (!windowId) return false
      return this.close(windowId)
    })

    this.ipcHandle(IpcChannel.WindowManager_Minimize, (event) => {
      const windowId = this.getWindowIdByWebContents(event.sender)
      if (!windowId) return false
      return this.minimize(windowId)
    })

    this.ipcHandle(IpcChannel.WindowManager_Maximize, (event) => {
      const windowId = this.getWindowIdByWebContents(event.sender)
      if (!windowId) return false
      return this.maximize(windowId)
    })

    this.ipcHandle(IpcChannel.WindowManager_Unmaximize, (event) => {
      const windowId = this.getWindowIdByWebContents(event.sender)
      if (!windowId) return false
      return this.unmaximize(windowId)
    })

    this.ipcHandle(IpcChannel.WindowManager_IsMaximized, (event) => {
      const windowId = this.getWindowIdByWebContents(event.sender)
      if (!windowId) return false
      return this.isMaximized(windowId)
    })

    this.ipcHandle(IpcChannel.WindowManager_SetFullScreen, (event, value: boolean) => {
      const windowId = this.getWindowIdByWebContents(event.sender)
      if (!windowId) return false
      return this.setFullScreen(windowId, value)
    })

    this.ipcHandle(IpcChannel.WindowManager_IsFullScreen, (event) => {
      const windowId = this.getWindowIdByWebContents(event.sender)
      if (!windowId) return false
      return this.isFullScreen(windowId)
    })
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
      // Step A: hidden instance awaiting promotion (eager warmup or close→hide).
      //
      // INTENTIONAL — do NOT call resetPooledWindowGeometry here. Singleton
      // hide→show preserves user state (window size, React tree, form inputs).
      // Pool reuse resets because it is a multi-consumer resource; singleton is
      // single-consumer.
      const state = this.warmupStates.get(type)
      if (state && !state.suspended && state.idle.length > 0) {
        const candidateId = state.idle.shift()!
        if (state.idle.length === 0) this.activeWarmupTypes.delete(type)
        const candidate = this.windows.get(candidateId)
        if (candidate && !candidate.window.isDestroyed() && !candidate.window.webContents.isCrashed()) {
          // Only call applyReusedInitData when the caller actually provides new
          // initData. `applyReusedInitData(managed, undefined)` deletes the
          // initDataStore entry, which violates the "preserve state across hide"
          // contract — the stored payload must survive hide so a renderer
          // reload during hide can restore context via `WindowManager_GetInitData`.
          if (args?.initData !== undefined) {
            this.applyReusedInitData(candidate, args.initData)
          }
          if (metadata.showMode !== 'manual') {
            candidate.window.show()
            candidate.window.focus()
          }
          state.lastActivityAt = Date.now()
          this.logWarmupEvent('singleton-reuse', type, state, { windowId: candidateId })
          return candidateId
        }
        // Unhealthy idle candidate — mirror openPooled's cleanup so
        // windowsByType index is not leaked.
        state.managed.delete(candidateId)
        if (candidate) {
          this.cleanupWindowTracking(candidateId, candidate.type)
        }
      }

      // Step B: already-visible singleton instance.
      const existing = this.findWindowByType(type)
      if (existing) {
        // Singleton reuse: push initData to renderer BEFORE show/focus, so the
        // UI updates in the same frame the window is re-activated.
        this.applyReusedInitData(existing, args?.initData)

        // Respect showMode: 'manual' — consumer manages visibility itself.
        // Only show/focus when showMode is 'auto' (default) or 'immediate'.
        if (metadata.showMode !== 'manual') {
          existing.window.show()
          existing.window.focus()
        }
        return existing.id
      }

      // Step C: first-time create. If the type declares `singletonConfig`,
      // register it into WarmupState so later close() can intercept.
      if (metadata.singletonConfig) {
        const validated = this.validateSingletonConfig(type, metadata.singletonConfig)
        const st = this.getOrCreateWarmupState(type, this.warmupInitFromSingletonConfig(validated))
        const windowId = this.createWindow(type, args)
        if (!st.suspended) {
          st.managed.add(windowId)
          st.lastActivityAt = Date.now()
        }
        return windowId
      }
    }

    if (metadata.lifecycle === 'pooled') {
      const state = this.warmupStates.get(type)
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
      const state = this.getOrCreateWarmupState(type, this.warmupInitFromPoolConfig(metadata.poolConfig))
      if (!state.suspended) {
        state.managed.add(windowId)
      }
      const recycleMax = metadata.poolConfig.recycleMaxSize ?? 0
      if (!state.suspended && recycleMax > 0 && state.managed.size + state.inflightCreates > recycleMax) {
        logger.warn('Pool managed count exceeds recycleMaxSize via create()', {
          type,
          managed: state.managed.size,
          inflight: state.inflightCreates,
          recycleMaxSize: recycleMax
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
   * When `data === undefined`, any previously stored init data for this window
   * is cleared so the renderer does not observe a stale payload from an earlier
   * open() on the same singleton/pooled instance. No Reused event is fired in
   * that case.
   */
  private applyReusedInitData(managed: ManagedWindow, data: unknown): void {
    if (data === undefined) {
      this.initDataStore.delete(managed.id)
      return
    }
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

    if (managed.metadata.behavior?.closeToHide) {
      managed.window.hide()
      this.updateDockVisibility()
      return true
    }

    for (const [type, state] of this.warmupStates) {
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

  public maximize(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    managed.window.maximize()
    return true
  }

  public unmaximize(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    managed.window.unmaximize()
    return true
  }

  public isMaximized(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    return managed.window.isMaximized()
  }

  public setFullScreen(windowId: string, value: boolean): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    managed.window.setFullScreen(value)
    return true
  }

  public isFullScreen(windowId: string): boolean {
    const managed = this.windows.get(windowId)
    if (!managed) return false
    return managed.window.isFullScreen()
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

  // ─── Public API: Behavior runtime overrides ───────────────────
  //
  // Exposed on `this.behavior` (a {@link BehaviorController} instance);
  // see behavior.ts for the full API surface. Kept off the flat WindowManager
  // namespace so the declarative three-layer split (windowOptions / behavior
  // / quirks) is visible at the call site.

  // ─── Public API: Title bar overlay ────────────────────────────

  /**
   * Update title bar overlay colors on all windows that have overlay configured.
   * Only affects window types whose windowOptions includes titleBarOverlay.
   */
  public setTitleBarOverlay(options: TitleBarOverlayOptions): void {
    for (const [type, windowIds] of this.windowsByType) {
      const metadata = getWindowTypeMetadata(type)
      if (!metadata.windowOptions.titleBarOverlay) continue
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

  /**
   * Push fresh init data to a single already-open window and notify its
   * renderer in-place, reusing the same IPC channel (`WindowManager_Reused`)
   * that pool-recycle and singleton-reopen paths use. The renderer's
   * `useWindowInitData` hook picks this up without remounting the subtree.
   *
   * Use this for "update the already-visible window with new context"
   * scenarios — e.g. a main-process service reacting to an external event
   * and wanting the current window to swap its payload. For first-time
   * creation or recycling, continue using `open({ initData })`.
   *
   * Semantics:
   * - Writes `data` into the init-data store so subsequent `getInitData()`
   *   calls (devtools reload, lazy child mount) observe the latest value.
   * - Sends `WindowManager_Reused` to the window's `webContents`.
   * - Returns `true` if the window exists and is not destroyed, `false`
   *   otherwise. No throw on miss.
   *
   * The signature forbids `undefined` on purpose: unlike the reuse path,
   * "pushing undefined" has no meaningful semantics here, and silently
   * no-oping would hide caller bugs.
   */
  public pushInitData<T>(windowId: string, data: T): boolean {
    const managed = this.windows.get(windowId)
    if (!managed || managed.window.isDestroyed()) return false
    this.setInitData(windowId, data)
    managed.window.webContents.send(IpcChannel.WindowManager_Reused, data)
    return true
  }

  /**
   * Push fresh init data to every currently-open window of the given type.
   * Returns the number of windows that received the event.
   *
   * Does NOT filter by visibility — an idle pooled window sitting in the
   * recycle queue will also receive the event, so when it is next taken
   * out of the pool its renderer already has the latest payload. If you
   * need visibility filtering, iterate `getWindows(type)` and call
   * `pushInitData` selectively.
   */
  public pushInitDataToType<T>(type: WindowType, data: T): number {
    const ids = this.windowsByType.get(type)
    if (!ids || ids.size === 0) return 0
    let count = 0
    for (const id of ids) {
      if (this.pushInitData(id, data)) count++
    }
    return count
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

    const state = this.getOrCreateWarmupState(type, this.warmupInitFromPoolConfig(metadata.poolConfig))
    state.suspended = true

    if (state.idle.length === 0) {
      this.activeWarmupTypes.delete(type)
      return 0
    }

    const toDestroy = state.idle.slice()
    let count = 0
    for (const windowId of toDestroy) {
      const managed = this.windows.get(windowId)
      if (managed) {
        this.destroyWindow(managed.window)
        count++
      }
    }

    this.activeWarmupTypes.delete(type)

    this.logWarmupEvent('pool-suspend', type, state, { count })
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

    const state = this.warmupStates.get(type)
    if (!state || !state.suspended) return

    state.suspended = false
    state.lastActivityAt = Date.now()

    const warmup = metadata.poolConfig.warmup ?? defaultWarmup(metadata.poolConfig)
    if (warmup === 'eager') {
      this.warmPool(type, metadata.poolConfig)
    } else {
      // Lazy pools with standbySize still need the spare materialised on resume.
      this.replenishStandby(type, state, metadata.poolConfig)
    }

    this.logWarmupEvent('pool-resume', type, state)
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
    const state = this.getOrCreateWarmupState(type, this.warmupInitFromPoolConfig(poolConfig))

    // Try to find a healthy idle window
    while (state.idle.length > 0) {
      const candidateId = state.idle.shift()!
      if (state.idle.length === 0) this.activeWarmupTypes.delete(type)
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

      // Show recycled window based on metadata. 'manual' opts out entirely;
      // both 'auto' and 'immediate' show + focus on recycle (the immediate vs
      // ready-to-show distinction only applies to fresh construction).
      const showMode = getWindowTypeMetadata(type).showMode ?? 'auto'
      if (showMode !== 'manual') {
        candidate.window.show()
        candidate.window.focus()
      }

      state.lastActivityAt = Date.now()
      this.replenishStandby(type, state, poolConfig)
      this.logWarmupEvent('pool-recycle', type, state, { windowId: candidateId })
      return candidateId
    }

    // Fresh path: create new window and track in pool
    const windowId = this.createWindow(type, args)
    state.managed.add(windowId)
    state.lastActivityAt = Date.now()

    const recycleMax = poolConfig.recycleMaxSize ?? 0
    if (recycleMax > 0 && state.managed.size + state.inflightCreates > recycleMax) {
      logger.warn('Pool managed count exceeds recycleMaxSize', {
        type,
        managed: state.managed.size,
        inflight: state.inflightCreates,
        recycleMaxSize: recycleMax
      })
    }

    this.replenishStandby(type, state, poolConfig)
    this.logWarmupEvent('pool-create-fresh', type, state, { windowId })
    return windowId
  }

  /**
   * Schedule async standby replenishment after `open()` consumed an idle window
   * (or had to synchronously create because idle was empty). Uses `setImmediate`
   * to defer creation to the next tick so the current open() returns without
   * paying for the replenish-create cost.
   *
   * The `inflightCreates` counter prevents double-scheduling when multiple
   * opens fire within the same tick before scheduled callbacks execute.
   * Callbacks check `state.suspended` at execution time to stay correct if
   * `suspendPool()` fires between scheduling and execution.
   */
  private replenishStandby(type: WindowType, state: WarmupState, cfg: PoolConfig): void {
    // Do not prewarm during app quit — otherwise newly created pooled windows
    // would re-trigger the close intercept and stall app.quit().
    if (application.isQuitting) return
    const target = cfg.standbySize ?? 0
    if (target <= 0 || state.suspended) return
    const shortfall = target - state.idle.length - state.inflightCreates
    for (let i = 0; i < shortfall; i++) {
      state.inflightCreates++
      setImmediate(() => {
        try {
          if (state.suspended) return
          this.createIdleWindow(type, state)
        } catch (err) {
          logger.error('standbySize replenish failed', { type, err })
        } finally {
          state.inflightCreates--
        }
      })
    }
    if (shortfall > 0) {
      this.startWarmupGc()
    }
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

    const config = mergeWindowOptions(type, options)
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
    state: WarmupState,
    poolConfig: PoolConfig,
    type: WindowType
  ): void {
    // Idempotency guard
    if (state.idle.includes(windowId)) {
      this.logWarmupEvent('release-skip', type, state, { windowId })
      return
    }

    // Clear runtime overrides before the window goes hidden/idle. The three
    // branches below all call `window.hide()` on this window before either
    // destroying it or pushing it back to the idle queue — clearing here
    // ensures (a) no stale override leaks through destroy→cleanupWindowTracking
    // (already clears, but this is a belt-and-suspenders), and (b) a pool
    // window reopened later for a different consumer starts from the
    // registry-declared defaults rather than the previous consumer's pin.
    this.behavior.clearForWindow(windowId)

    const recycleMax = poolConfig.recycleMaxSize ?? 0
    const standby = poolConfig.standbySize ?? 0

    // Recycling disabled (recycleMaxSize not configured): destroy the closing window.
    // In pure standby mode (scenario ②) this still yields "close destroys, async
    // replenish keeps one warm" because `replenishStandby` fires on the next open.
    if (recycleMax <= 0) {
      if (!managed.window.isDestroyed()) {
        managed.window.hide()
      }
      this.destroyWindow(managed.window)
      this.initDataStore.delete(windowId)
      this.logWarmupEvent('pool-release-destroy-disabled', type, state, { windowId })
      this.updateDockVisibility()
      return
    }

    // Excess capacity: destroy immediately instead of pooling. Include inflight
    // standby replenishments in the cap check to avoid accounting drift between
    // scheduling and window creation.
    if (state.managed.size + state.inflightCreates > recycleMax) {
      if (!managed.window.isDestroyed()) {
        managed.window.hide()
      }
      this.destroyWindow(managed.window)
      this.initDataStore.delete(windowId)
      this.logWarmupEvent('pool-release-destroy-overcap', type, state, { windowId, recycleMaxSize: recycleMax })
      this.updateDockVisibility()
      return
    }

    if (!managed.window.isDestroyed()) {
      managed.window.hide()
    }

    // Clear session-scoped init data (after subscribers have had a chance to read it)
    this.initDataStore.delete(windowId)

    state.idle.push(windowId)
    this.activeWarmupTypes.add(type)
    // Reset the inactivity/decay clock at close time too: `lastActivityAt`
    // captures the end of a usage cycle so the retention timer only starts
    // counting from the last interaction (open OR close), not from the
    // last open() far in the past.
    state.lastActivityAt = Date.now()
    this.logWarmupEvent('pool-release', type, state, { windowId })

    this.startWarmupGc()

    // Lazy warmup: backfill to initialSize after first release. Skipped when
    // standbySize is configured — standby replenish already keeps the idle
    // queue populated, and running both paths would double-create.
    if (poolConfig.warmup === 'lazy' && standby === 0) {
      const initialSize = poolConfig.initialSize ?? poolConfig.recycleMinSize ?? 0
      if (initialSize > 0 && state.managed.size < initialSize) {
        const deficit = initialSize - state.managed.size
        for (let i = 0; i < deficit; i++) {
          this.createIdleWindow(type, state)
        }
        this.logWarmupEvent('pool-lazy-backfill', type, state, { deficit })
      }
    }

    this.updateDockVisibility()
  }

  /**
   * Release a singleton window back to the warmup state machine as a hidden
   * idle instance (as opposed to `releaseToPool`, which may destroy on
   * overcap / recycling-disabled).
   *
   * Unlike `releaseToPool`, this deliberately preserves user-facing state:
   * no behavior override clear, no initDataStore delete, no geometry reset.
   * Singleton hide is "temporarily hidden, preserve state", not "return to a
   * shared pool, reset to clean slate for the next consumer".
   */
  private releaseSingletonToHidden(
    windowId: string,
    managed: ManagedWindow,
    state: WarmupState,
    cfg: SingletonConfig,
    type: WindowType
  ): void {
    if (state.idle.includes(windowId)) {
      this.logWarmupEvent('release-skip', type, state, { windowId })
      return
    }

    // INTENTIONAL — preserve state across hide. Do NOT:
    //   - clear behavior override: user-pinned alwaysOnTop / hideOnBlur survives.
    //   - delete initDataStore entry: allows renderer reload during hide to
    //     restore last initData via WindowManager_GetInitData. Next open() with
    //     fresh args will overwrite via applyReusedInitData; next open() without
    //     args leaves the entry intact (singleton's single-consumer semantics).
    //   - reset geometry: user-adjusted window size is part of preserved state.
    // Renderer state (DOM / React tree / component state) is auto-preserved
    // by Electron since hide() does not destroy the renderer process.
    if (!managed.window.isDestroyed()) managed.window.hide()

    state.idle.push(windowId)
    this.activeWarmupTypes.add(type)
    state.lastActivityAt = Date.now()
    this.logWarmupEvent('singleton-hide', type, state, { windowId })

    // Only retentionTime > 0 needs the GC timer. retentionTime === -1 (permanent)
    // means "never evict" — leave GC alone (gcDisabled in WarmupState will also
    // short-circuit the tick for this type).
    if ((cfg.retentionTime ?? 0) > 0) this.startWarmupGc()

    this.updateDockVisibility()
  }

  /** Create a hidden window and add it directly to the pool as idle */
  private createIdleWindow(type: WindowType, state: WarmupState): void {
    const windowId = this.createWindow(type, undefined, true)
    state.managed.add(windowId)
    state.idle.push(windowId)
    this.activeWarmupTypes.add(type)
    this.logWarmupEvent('create-idle', type, state, { windowId })
  }

  /** Pre-create idle windows for eager warmup pools */
  private warmPool(type: WindowType, poolConfig: PoolConfig): void {
    const state = this.getOrCreateWarmupState(type, this.warmupInitFromPoolConfig(poolConfig))
    const target = poolConfig.initialSize ?? Math.max(poolConfig.standbySize ?? 0, poolConfig.recycleMinSize ?? 0)
    const count = target - state.managed.size
    for (let i = 0; i < count; i++) {
      this.createIdleWindow(type, state)
    }
    if (count > 0) {
      this.startWarmupGc()
      this.logWarmupEvent('warmup', type, state, { count })
    }
  }

  /**
   * Pre-create the single hidden instance for an eager-warmup singleton.
   * No-op when the state already has a managed window or is suspended.
   */
  private warmSingleton(type: WindowType, cfg: SingletonConfig): void {
    const state = this.getOrCreateWarmupState(type, this.warmupInitFromSingletonConfig(cfg))
    if (state.managed.size > 0 || state.suspended) return
    this.createIdleWindow(type, state)
    this.startWarmupGc()
    this.logWarmupEvent('warmup', type, state, { count: 1, lifecycle: 'singleton' })
  }

  /**
   * Get or create WarmupState for a window type. The `init` argument is consumed
   * only on first creation to populate the readonly precomputed fields; later
   * calls ignore it (config is immutable per state lifetime). Each lifecycle
   * maps its own config shape into {@link WarmupStateInit} via its own adapter
   * (see {@link warmupInitFromPoolConfig}, {@link warmupInitFromSingletonConfig}).
   */
  private getOrCreateWarmupState(type: WindowType, init: WarmupStateInit): WarmupState {
    const existing = this.warmupStates.get(type)
    if (existing) return existing

    const state: WarmupState = {
      idle: [],
      managed: new Set(),
      lastActivityAt: Date.now(),
      lastDecayAt: Date.now(),
      suspended: false,
      inflightCreates: 0,
      standbyFloor: init.standbyFloor,
      decayFloor: init.decayFloor,
      inactivityTimeoutMs: init.inactivityTimeoutMs,
      decayIntervalMs: init.decayIntervalMs,
      gcDisabled: init.inactivityTimeoutMs === 0 && init.decayIntervalMs === 0
    }
    this.warmupStates.set(type, state)
    return state
  }

  /**
   * Map a pool lifecycle's {@link PoolConfig} to the generic {@link WarmupStateInit}
   * seed used by {@link getOrCreateWarmupState}. Pool uses two-axis floors
   * (standby vs. decay) and treats `inactivityTimeout` / `decayInterval` directly.
   */
  private warmupInitFromPoolConfig(cfg: PoolConfig): WarmupStateInit {
    const standbyFloor = cfg.standbySize ?? 0
    return {
      standbyFloor,
      decayFloor: Math.max(standbyFloor, cfg.recycleMinSize ?? 0),
      inactivityTimeoutMs: (cfg.inactivityTimeout ?? 0) * 1000,
      decayIntervalMs: (cfg.decayInterval ?? 0) * 1000
    }
  }

  /**
   * Map a singleton lifecycle's {@link SingletonConfig} to the generic
   * {@link WarmupStateInit} seed. Singleton is the degenerate case: capacity
   * ∈ {0, 1}, no decay. `standbyFloor` is 1 iff a permanent hidden instance
   * is desired (`warmup: 'eager'` or `retentionTime: -1`), else 0.
   */
  private warmupInitFromSingletonConfig(cfg: SingletonConfig): WarmupStateInit {
    const permanentHidden = cfg.warmup === 'eager' || cfg.retentionTime === -1
    const floor = permanentHidden ? 1 : 0
    const retention = cfg.retentionTime
    return {
      standbyFloor: floor,
      decayFloor: floor,
      inactivityTimeoutMs: retention !== undefined && retention > 0 ? retention * 1000 : 0,
      decayIntervalMs: 0
    }
  }

  /**
   * Single entry point for pool state-change logs. Produces one structured line
   * per state mutation: `pool[<type>] <op>` with `{op, type, idle, managed, inflight}`
   * plus any caller-supplied extras. Caller responsibility: invoke after the
   * mutation lands, so the snapshot reflects post-state.
   */
  private logWarmupEvent(op: WarmupOp, type: WindowType, state: WarmupState, extra?: Record<string, unknown>): void {
    logger.debug(`warmup[${type}] ${op}`, {
      op,
      type,
      idle: state.idle.length,
      managed: state.managed.size,
      inflight: state.inflightCreates,
      ...extra
    })
  }

  // ─── GC Timer ─────────────────────────────────────────────────

  /** Start the shared GC timer if not already running */
  private startWarmupGc(): void {
    if (this.warmupGcTimer) return
    this.warmupGcTimer = setInterval(() => this.warmupGcTick(), WARMUP_GC_INTERVAL)
    logger.debug('warmup gc-start', { intervalMs: WARMUP_GC_INTERVAL })
  }

  /**
   * Single GC tick — handles decay and idle timeout.
   *
   * Iterates only `activeWarmupTypes` (entries with `idle.length > 0`),
   * skipping empty entries entirely. All threshold values are read from
   * precomputed `WarmupState` fields, avoiding per-tick
   * `getWindowTypeMetadata` lookups, `?? 0` coalescing, and `* 1000`
   * arithmetic.
   */
  private warmupGcTick(): void {
    if (this.activeWarmupTypes.size === 0) {
      if (this.warmupGcTimer) {
        clearInterval(this.warmupGcTimer)
        this.warmupGcTimer = null
        logger.debug('warmup gc-stop', { reason: 'no active warmup states' })
      }
      return
    }

    const now = Date.now()
    let toDeactivate: WindowType[] | null = null

    for (const type of this.activeWarmupTypes) {
      const state = this.warmupStates.get(type)
      if (!state || state.suspended) continue
      // Entries with no time-driven GC at all (no inactivity, no decay) have
      // nothing to do — drop from active set so the timer can self-stop.
      if (state.gcDisabled) {
        ;(toDeactivate ??= []).push(type)
        continue
      }
      // Defense against the brief inconsistency window between destroyWindow()
      // and the async `closed` listener splice — activeWarmupTypes may still
      // point at this type while `state.idle` has already been emptied.
      if (state.idle.length === 0) continue

      // Inactivity timeout (priority 1): trim idle queue down to standbyFloor.
      if (state.inactivityTimeoutMs > 0 && now - state.lastActivityAt > state.inactivityTimeoutMs) {
        this.trimIdleToFloor(type, state, state.standbyFloor)
      } else if (state.decayIntervalMs > 0 && state.idle.length > state.decayFloor) {
        // Decay (priority 2): evict one idle window above decayFloor when interval elapsed.
        if (now - state.lastActivityAt > state.decayIntervalMs && now - state.lastDecayAt > state.decayIntervalMs) {
          this.destroyOneIdle(type, state)
          state.lastDecayAt = now
        }
      }

      // Steady-state pruning: an entry with `idle <= standbyFloor` has no
      // inactivity-trim work (excess = idle - standbyFloor ≤ 0); since
      // `standbyFloor ≤ decayFloor` by definition, it also has no decay work.
      // Drop from `activeWarmupTypes` so the timer self-stops once ALL entries
      // converge to steady state. Subsequent `release` / `replenish` will
      // re-add via the maintenance points.
      if (state.idle.length <= state.standbyFloor) {
        ;(toDeactivate ??= []).push(type)
      }
    }

    if (toDeactivate) {
      for (const type of toDeactivate) this.activeWarmupTypes.delete(type)
    }
  }

  /**
   * Trim the idle queue down to `floor` by destroying the oldest windows from
   * the front (FIFO semantics). When `floor <= 0`, all idle windows are
   * destroyed. Used by the inactivity timeout path with `floor = standbySize`
   * to preserve the standby commitment while releasing the recycle buffer.
   *
   * Per-window cleanup (removing from `state.idle` / `state.managed`) flows
   * through the centralized `closed` event listener — this method only issues
   * `destroyWindow()` calls.
   */
  private trimIdleToFloor(type: WindowType, state: WarmupState, floor: number): void {
    const excess = state.idle.length - Math.max(0, floor)
    if (excess <= 0) return
    const toDestroy = state.idle.slice(0, excess)
    for (const id of toDestroy) {
      const managed = this.windows.get(id)
      if (managed) {
        this.destroyWindow(managed.window)
      }
    }
    this.logWarmupEvent('inactivity-trim', type, state, { floor, destroyed: excess })
  }

  /** Destroy the oldest idle window for a pool type */
  private destroyOneIdle(type: WindowType, state: WarmupState): void {
    const id = state.idle.shift()
    if (!id) return
    if (state.idle.length === 0) this.activeWarmupTypes.delete(type)
    const managed = this.windows.get(id)
    if (managed) {
      this.destroyWindow(managed.window)
    }
    this.logWarmupEvent('pool-decay', type, state, { windowId: id })
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
    const config = mergeWindowOptions(type, args?.options)
    const showMode = metadata.showMode ?? 'auto'

    // Resolve preload path. `metadata.preload` mirrors `htmlPath`'s three-state
    // encoding: omitted → default file, non-empty string → that file, empty
    // string → no preload (for nodeIntegration:true cases).
    const preloadName = metadata.preload ?? 'index.js'
    const preloadPath = preloadName ? join(__dirname, '../preload/', preloadName) : undefined

    // 1. Create BrowserWindow
    const window = new BrowserWindow({
      ...config,
      show: showMode === 'immediate',
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
    // Windows with showMode: 'manual' opt out entirely — their owner drives visibility
    // on its own schedule (see e.g. SelectionService.processAction).
    // 'immediate' also skips this path: the window was already shown by the
    // `show: true` above, and ready-to-show will fire after content loads.
    if (showMode === 'auto' && !suppressAutoShow) {
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

    // 4a. Apply the declarative behavior layer (non-hacky: initial alwaysOnTop
    // level, initial setVisibleOnAllWorkspaces, blur→hide listener). Pass a
    // closure that reads the runtime override map for hideOnBlur, so the
    // behavior module stays free of a reverse WindowManager reference.
    applyWindowBehavior(
      managedWindow.window,
      managedWindow.metadata.behavior,
      windowId,
      (id) => this.behavior.getHideOnBlurOverride(id),
      config
    )

    // 4b. Apply declarative platform quirks (method-slot monkey-patches).
    // Runs AFTER onWindowCreated so domain-service listeners attach first; the quirk
    // wrappers then transparently apply around any subsequent hide()/show()/close().
    // Also runs AFTER applyWindowBehavior so the behavior layer's initial setter
    // calls do not trigger the monkey-patched show/showInactive.
    applyWindowQuirks(managedWindow.window, managedWindow.metadata.quirks, managedWindow.metadata.behavior)

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

    // 7. Reconcile macOS Dock visibility. A fresh window added to `this.windows`
    // changes the set of contributing windows; any pre-set per-type override (e.g.
    // tray-on-launch having called wm.behavior.setMacShowInDockByType(Main, false)
    // before the first open) is applied here without requiring a separate arg on
    // createWindow.
    this.updateDockVisibility()

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
    // Intentionally no show/hide/minimize/restore triggers for updateDockVisibility.
    // Dock state tracks window EXISTENCE + per-type override, not visibility — matching
    // macOS native semantics where Cmd+W (hide) keeps the dock icon, Cmd+Q (destroy) removes it.
    // The 'closed' handler below triggers updateDockVisibility on destruction; type-override
    // changes via wm.behavior.setMacShowInDockByType do so explicitly.

    // Forward OS-level window state changes to the window's own webContents so its
    // renderer chrome (titlebar buttons, fullscreen-aware layout) can stay in sync
    // with state changes that bypass IPC: double-click titlebar, Win+↑/↓, Windows
    // Snap, macOS green button, F11, third-party tiling WMs.
    //
    // - setupWindowListeners runs exactly once per BrowserWindow lifetime (called
    //   from createWindow); pooled windows reuse the same instance + listeners on
    //   recycle, so there is no listener accumulation. The window.on('closed')
    //   handler below calls window.removeAllListeners() as a final safety net.
    // - macOS does NOT reliably fire 'maximize'/'unmaximize' (electron#3325, #28699)
    //   so MaximizedChanged is Win/Linux-effective. Renderer code on macOS should
    //   treat FullscreenChanged as the source of truth (the green button defaults
    //   to native fullscreen, which fires reliably).
    // - HTML5 element.requestFullscreen() and macOS setSimpleFullScreen() are
    //   intentionally NOT bridged here: useFullscreen / useFullScreenNotice
    //   semantics is OS-level native fullscreen only.
    window.on('maximize', () => {
      window.webContents.send(IpcChannel.WindowManager_MaximizedChanged, true)
    })
    window.on('unmaximize', () => {
      window.webContents.send(IpcChannel.WindowManager_MaximizedChanged, false)
    })
    window.on('enter-full-screen', () => {
      window.webContents.send(IpcChannel.WindowManager_FullscreenChanged, true)
    })
    window.on('leave-full-screen', () => {
      window.webContents.send(IpcChannel.WindowManager_FullscreenChanged, false)
    })

    // Intercept native close for warmup-tracked windows — hide and return to
    // the idle queue (pool) or preserve hidden state (singleton w/ retention).
    window.on('close', (event) => {
      // App is quitting — let native close proceed so app.quit() can complete.
      // Without this, preventDefault'd windows stall will-quit indefinitely.
      if (application.isQuitting) return

      const managed = this.windows.get(windowId)
      if (managed?.metadata.behavior?.closeToHide) {
        event.preventDefault()
        managed.window.hide()
        this.updateDockVisibility()
        return
      }

      for (const [type, state] of this.warmupStates) {
        if (!state.managed.has(windowId)) continue
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
        if (metadata.lifecycle === 'singleton' && metadata.singletonConfig?.retentionTime !== undefined) {
          if (state.suspended) return
          event.preventDefault()
          if (state.idle.includes(windowId)) return
          const managed = this.windows.get(windowId)
          if (managed) {
            this.releaseSingletonToHidden(windowId, managed, state, metadata.singletonConfig, type)
          }
          return
        }
      }
      // Singleton without retentionTime / default: fall through, native destroy.
    })

    window.on('closed', () => {
      window.removeAllListeners()

      const managed = this.windows.get(windowId)
      if (managed) {
        this.cleanupWindowTracking(windowId, managed.type)
        this._onWindowDestroyed.fire(managed)
        logger.debug('Window closed', { windowId, type: managed.type })
      }

      // Pool cleanup. The upper-level pool op (decay / inactivity-trim / suspend
      // / release-destroy-*) already logged its own snapshot before this fires;
      // we deliberately do not emit a second per-window log here. For natively
      // closed (user-initiated) windows, the generic `Window closed` line above
      // is the lifecycle marker.
      for (const [type, state] of this.warmupStates) {
        if (state.managed.has(windowId)) {
          state.managed.delete(windowId)
          const idx = state.idle.indexOf(windowId)
          if (idx !== -1) state.idle.splice(idx, 1)
          if (state.idle.length === 0) this.activeWarmupTypes.delete(type)
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
    // Hidden runtime state must not survive the underlying BrowserWindow —
    // any future open() allocates a fresh windowId anyway, but guarding here
    // is cheap and keeps the map bounded.
    this.behavior.clearForWindow(windowId)
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

  // ─── macOS Dock visibility ────────────────────────────────────
  //
  // Per-type runtime override for `behavior.macShowInDock` lives on
  // {@link BehaviorController} (see `this.behavior`). Services call
  // `wm.behavior.setMacShowInDockByType(type, value)` to express tray-mode
  // intent; `windowContributesToDock` reads the override via the controller.

  /**
   * Tracks the Dock icon visibility that WM has committed to, so repeated calls
   * deduplicate native Dock show/hide invocations. Initialized to `true` because
   * macOS Electron apps start with the Dock icon visible; the first
   * `updateDockVisibility()` will correctly transition to `false` when needed
   * (e.g. tray-on-launch sets the Main override to `false` before window creation).
   */
  private dockShouldBeVisible = true

  /**
   * Whether a managed window currently contributes to "app wants the Dock icon".
   * Checks, in order:
   *   - window not destroyed (destroyed windows never contribute)
   *   - per-type override (if set, wins over registry default)
   *   - registry's `behavior.macShowInDock` (defaults to true when omitted)
   *
   * This predicate is existence-based, not visibility-based — consistent with
   * native macOS semantics where hiding a window does not remove its app from
   * the Dock. Apps opt into tray-style "hide Dock when hidden" behavior
   * explicitly via `wm.behavior.setMacShowInDockByType`.
   */
  private windowContributesToDock(managed: ManagedWindow): boolean {
    if (managed.window.isDestroyed()) return false
    const typeOverride = this.behavior.getMacShowInDockOverride(managed.type)
    if (typeOverride !== undefined) return typeOverride
    return managed.metadata.behavior?.macShowInDock !== false
  }

  /**
   * Recompute and sync the macOS Dock icon visibility.
   *
   * Triggered by lifecycle events that change the set of contributing windows:
   *   - window creation (in `createWindow`)
   *   - window destruction (in the 'closed' listener)
   *   - per-type override changes (in `wm.behavior.setMacShowInDockByType`)
   *
   * NOT triggered by show/hide/minimize/restore — see `setupWindowListeners` comment.
   */
  private updateDockVisibility(): void {
    if (!isMac) return

    const shouldShow = Array.from(this.windows.values()).some((managed) => this.windowContributesToDock(managed))

    if (shouldShow && !this.dockShouldBeVisible) {
      this.dockShouldBeVisible = true
      void app.dock?.show().then(() => {
        if (!this.dockShouldBeVisible) app.dock?.hide()
      })
    } else if (!shouldShow && this.dockShouldBeVisible) {
      this.dockShouldBeVisible = false
      app.dock?.hide()
    }
  }
}
