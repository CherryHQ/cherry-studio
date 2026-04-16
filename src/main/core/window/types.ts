import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

/**
 * Window type enumeration.
 * Defines all window types managed by the WindowManager.
 * New types are added here when migrating windows to the WindowManager.
 */
export enum WindowType {
  Main = 'main',
  Mini = 'mini',
  DetachedTab = 'detachedTab',
  SelectionToolbar = 'selectionToolbar',
  SelectionAction = 'selectionAction'
}

/** Valid WindowType values for runtime validation */
export const VALID_WINDOW_TYPES = new Set<string>(Object.values(WindowType))

/** Window lifecycle mode — determines how WindowManager handles creation, reuse, and destruction */
export type WindowLifecycleMode = 'default' | 'singleton' | 'pooled'

/** Pool warmup strategy */
export type PoolWarmup = 'eager' | 'lazy'

/**
 * Elastic pool configuration.
 * Classic pool pattern: minIdle(p) ≤ initialSize(n) ≤ maxSize(m).
 *
 * Dimension note: `minIdle` is compared against idle window count,
 * while `initialSize` and `maxSize` are compared against managed count
 * (total = in-use + idle).
 */
export interface PoolConfig {
  /** Minimum idle windows to keep. Decay evicts down to this level but stops here. */
  minIdle: number
  /** Target managed (total) window count — filled at warmup (eager) or after first release (lazy). */
  initialSize: number
  /** Maximum managed (total) windows (in-use + idle). Soft cap: open()/create() warn but allow overflow; excess windows are destroyed immediately on release. */
  maxSize: number
  /** 'eager' = pre-create initialSize at startup, 'lazy' = fill pool after first release. */
  warmup: PoolWarmup
  /** Seconds between decay ticks (evict one idle window above minIdle). 0 = no decay. */
  decayInterval: number
  /** Seconds since last open() before releasing ALL idle windows, ignoring minIdle. 0 = never. */
  idleTimeout: number
}

/**
 * Window configuration options.
 * Combines Electron's native configuration with custom overrides.
 * `show` is omitted — use `WindowTypeMetadataBase.show` instead.
 */
export interface WindowOptions extends Omit<BrowserWindowConstructorOptions, 'show'> {
  /**
   * Per-platform overrides deeply merged into the base options for the matching platform.
   * Only the branch matching the current runtime (mac/win/linux) is applied; unmatched
   * branches are ignored. The `platformOverrides` field itself is stripped before the
   * result is passed to `new BrowserWindow(...)` so it never leaks into Electron.
   */
  platformOverrides?: {
    mac?: Partial<Omit<WindowOptions, 'platformOverrides'>>
    win?: Partial<Omit<WindowOptions, 'platformOverrides'>>
    linux?: Partial<Omit<WindowOptions, 'platformOverrides'>>
  }
}

/**
 * Platform quirks — opt-in OS-specific workarounds that WindowManager applies
 * automatically at the right lifecycle moments by monkey-patching the BrowserWindow
 * instance methods (`hide`/`close`/`show`/`showInactive`).
 *
 * Each quirk is empirically derived from hard-won experience in SelectionService;
 * enabling it in a window's metadata is a declarative replacement for hand-rolling
 * the same dance at every call site.
 */
export interface WindowQuirks {
  /**
   * [macOS] a HACKY way
   * make sure other windows do not bring to front when the window is hidden or closed.
   *
   * Before invoking the native `hide()`/`close()`, iterates every visible focusable
   * window and calls `setFocusable(false)` on it, then restores them 50ms later.
   */
  macRestoreFocusOnHide?: boolean

  /**
   * [macOS] hacky way
   * Because the window may not be a FOCUSED window, the hover status will remain
   * when next time show. After invoking the native `hide()`, send a synthetic
   * mouseMove event at (-1, -1) to the window so the hover status disappears.
   */
  macClearHoverOnHide?: boolean

  /**
   * [macOS] set the window to always on top (highest level)
   * should set every time the window is shown.
   *
   * After invoking `show()` or `showInactive()`, re-apply `setAlwaysOnTop(true, level)`
   * so that the level configured here takes effect on the freshly-shown window.
   */
  macReapplyAlwaysOnTop?: 'screen-saver' | 'floating' | true
}

/** Common fields shared by all window type metadata variants */
interface WindowTypeMetadataBase {
  /** Window type identifier */
  type: WindowType
  /** Path to the HTML file for this window (relative to renderer root) */
  htmlPath: string
  /** Default BrowserWindow configuration for this window type */
  defaultConfig: WindowOptions
  /**
   * Window show behavior.
   * - `'auto'`: WindowManager manages visibility — creates hidden, shows on `ready-to-show`
   *   (fresh path) or immediately (recycled path)
   * - `false`: Consumer manages visibility — WindowManager never calls `show()`
   * - `true`: Immediately visible — BrowserWindow created with `show: true`
   * @default 'auto'
   */
  show?: 'auto' | boolean
  /**
   * (macOS only) Whether this window type should trigger Dock icon visibility.
   * When true or undefined, showing this window will make the Dock icon appear.
   * When false, this window will not affect Dock visibility.
   * @default true
   */
  showInDock?: boolean
  /**
   * Preload script variant.
   * - `'standard'`: Full API preload (default, index.js)
   * - `'simplest'`: Minimal preload (simplest.js)
   * - `'none'`: No preload (for windows with nodeIntegration:true)
   * @default 'standard'
   */
  preload?: 'standard' | 'simplest' | 'none'
  /**
   * Opt-in OS-specific quirks applied by WindowManager via method-slot monkey-patches.
   * See `WindowQuirks` for each flag's semantics.
   */
  quirks?: WindowQuirks
}

/**
 * Window type metadata — discriminated union on `lifecycle`.
 * TypeScript narrows `poolConfig` to be present only when `lifecycle === 'pooled'`.
 */
export type WindowTypeMetadata = WindowTypeMetadataBase &
  ({ lifecycle: 'default' } | { lifecycle: 'singleton' } | { lifecycle: 'pooled'; poolConfig: PoolConfig })

/**
 * Managed window instance.
 * Internal representation of a window tracked by WindowManager.
 */
export interface ManagedWindow {
  /** Unique window identifier (UUID) */
  readonly id: string
  /** Window type */
  readonly type: WindowType
  /** Electron BrowserWindow instance */
  readonly window: BrowserWindow
  /** Window type metadata from the registry */
  readonly metadata: WindowTypeMetadata
  /** Creation timestamp */
  readonly createdAt: number
}

/**
 * Window information for external consumers.
 * Serializable snapshot of window state, safe to pass across IPC.
 */
export interface WindowInfo {
  /** Unique window identifier */
  id: string
  /** Window type */
  type: WindowType
  /** Window title */
  title: string
  /** Whether the window is currently visible */
  isVisible: boolean
  /** Whether the window is currently focused */
  isFocused: boolean
  /** Creation timestamp */
  createdAt: number
}

/**
 * Arguments for `WindowManager.open()` / `create()`.
 *
 * Both fields are optional — callers can pass any combination:
 *   wm.open(type)
 *   wm.open(type, { initData })
 *   wm.open(type, { options })
 *   wm.open(type, { initData, options })
 *
 * When `initData` is provided, the value is:
 *   - synchronously written into `initDataStore` before `open()` returns
 *     (so renderer `getInitData` invokes always see the fresh value);
 *   - for reuse paths (pool recycle / singleton reopen), also pushed to the
 *     renderer via `IpcChannel.WindowManager_Reused` as the event payload.
 *
 * Never pushed for fresh-window paths (pooled new / default / singleton first /
 * `create()` — all create paths), because the renderer is not yet ready to
 * receive IPC during those moments.
 */
export interface OpenWindowArgs<T = unknown> {
  /** Optional payload stored for the window; retrievable by the renderer via `getInitData`. */
  initData?: T
  /** Optional BrowserWindow configuration overrides. */
  options?: Partial<WindowOptions>
}

/** Runtime state for a single pool type */
export interface PoolState {
  /** Idle windows available for reuse (FIFO queue) */
  idle: string[]
  /** All pool-managed window IDs (in-use + idle) */
  managed: Set<string>
  /** Timestamp of last open() for this type */
  lastOpenAt: number
  /** Timestamp of last decay action */
  lastDecayAt: number
  /** When true, pool is suspended — no warmup, no pool tracking for new windows */
  suspended: boolean
}
