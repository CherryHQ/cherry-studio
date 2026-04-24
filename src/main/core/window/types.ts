import type { BrowserWindow, BrowserWindowConstructorOptions, VisibleOnAllWorkspacesOptions } from 'electron'

/**
 * Window type enumeration.
 * Defines all window types managed by the WindowManager.
 * New types are added here when migrating windows to the WindowManager.
 */
export enum WindowType {
  Main = 'main',
  Settings = 'settings',
  QuickAssistant = 'quickAssistant',
  SubWindow = 'subWindow',
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
 * Two-axis pool configuration.
 *
 * The pool supports two orthogonal axes, each independently enabled:
 *
 * 1. **Producer axis (standby):** `standbySize` pre-warmed windows are always
 *    maintained in the idle queue, actively replenished on every `open()` via
 *    `setImmediate`. This guarantees zero-wait for the next caller regardless
 *    of concurrent usage, matching the "warm pool" pattern (AWS EC2 Warm Pools,
 *    RAID hot spares, GPU triple buffering).
 *
 * 2. **Consumer axis (recycle):** `recycleMinSize` / `recycleMaxSize` govern
 *    what happens when a window is closed — push to idle for reuse (bounded by
 *    `recycleMaxSize`) or destroy, with `recycleMinSize` acting as a passive
 *    floor for decay-based eviction.
 *
 * Field dimensions: all `*Size` fields are counts; `decayInterval` and
 * `inactivityTimeout` are seconds. `standbySize` is compared against idle count,
 * while `recycleMaxSize` / `initialSize` are compared against managed count
 * (in-use + idle).
 *
 * **Important:** `standbySize` is NOT bound by `recycleMaxSize`. The pool may
 * temporarily have `managed = in-use + standbySize` windows during bursts
 * where in-use exceeds `recycleMaxSize`; close paths converge back over time.
 *
 * See `docs/references/window-manager/window-manager-pool-mechanics.md` for the
 * full behavior matrix and scenario walk-throughs.
 */
export interface PoolConfig {
  // ─── Producer axis: active pre-warming ───
  /**
   * Pre-warmed spares always maintained in the idle queue. On every `open()`,
   * one is popped and an async replacement is scheduled via `setImmediate`.
   * Not bound by `recycleMaxSize` (producer-side guarantee overrides recycle cap).
   * 0 or undefined = disabled (no active pre-warming).
   */
  standbySize?: number

  /**
   * Target managed count at warmup. When omitted, defaults to
   * `max(standbySize ?? 0, recycleMinSize ?? 0)`. Useful when the user wants
   * a larger initial buffer to absorb cold-start bursts (e.g. `initialSize: 5`
   * with `standbySize: 1` will pre-create 5 and decay back down to 1).
   */
  initialSize?: number

  // ─── Consumer axis: recycling policy ───
  /**
   * Decay floor for idle queue after recycling. Decay evicts oldest idle down
   * to this count but stops here. Passive — NOT actively replenished on `open()`.
   * Meaningless unless `recycleMaxSize > 0` (no recycling means no windows
   * ever enter idle via release to retain).
   */
  recycleMinSize?: number

  /**
   * Soft cap on the number of managed windows that are eligible for recycling.
   * On `close()`, if `managed.size + inflightCreates > recycleMaxSize`, the
   * closing window is destroyed instead of returning to the idle queue. 0 or
   * undefined disables recycling entirely (close always destroys).
   * Note: `standbySize`-maintained windows are NOT counted against this cap.
   */
  recycleMaxSize?: number

  // ─── Time parameters ───
  /**
   * Seconds between decay ticks. Each tick evicts the oldest idle window when
   * `idle.length > max(standbySize ?? 0, recycleMinSize ?? 0)`. The floor here
   * is intentionally the max of both axes, so decay cannot drop idle below
   * `standbySize`. 0 or undefined = no decay.
   */
  decayInterval?: number

  /**
   * Seconds of no `open()` activity before trimming the idle queue. The floor
   * for this trim is `standbySize` ONLY — `recycleMinSize` is NOT preserved
   * (asymmetric by design): `standbySize` is a permanent availability
   * commitment; `recycleMinSize` is a short-term retention buffer meant for
   * active usage and should be released when the feature is truly idle.
   * 0 or undefined = never trim.
   */
  inactivityTimeout?: number

  // ─── Warmup mode ───
  /**
   * `'eager'` pre-creates `initialSize` windows during `onAllReady()`.
   * `'lazy'` defers until the first `close()` returns a window, then backfills
   * to `initialSize`. When `standbySize > 0` or `initialSize > 0` and `warmup`
   * is omitted, defaults to `'eager'` (standby implies zero-wait intent).
   * When both are unset, defaults to `'lazy'`.
   */
  warmup?: PoolWarmup
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
 * Level type for `setAlwaysOnTop`, derived from Electron's method signature so it
 * stays in sync with `@types/electron` automatically. Electron currently
 * enumerates 9 values (`'normal' | 'floating' | 'torn-off-menu' | 'modal-panel'
 * | 'main-menu' | 'status' | 'pop-up-menu' | 'screen-saver' | 'dock'`) — we
 * never restate them.
 *
 * Note: if Electron adds additional overloads to `setAlwaysOnTop`, `Parameters<>`
 * resolves against the last overload only; re-verify this type when upgrading.
 */
export type AlwaysOnTopLevel = NonNullable<Parameters<BrowserWindow['setAlwaysOnTop']>[1]>

/**
 * WM-level declarative behavior — cross-platform, non-hacky configuration that
 * cannot be expressed via Electron's `BrowserWindow` constructor (either because
 * the API is setter-only, or because the behavior is higher-level than a single
 * Electron call).
 *
 * Distinct from `WindowQuirks` (OS hacks / monkey-patches) and from
 * `WindowOptions` (Electron constructor parameters). See the window-manager
 * README for the three-layer split rationale.
 */
export interface WindowBehavior {
  /**
   * Auto-hide the window on the `blur` event. Runtime override via
   * `wm.behavior.setHideOnBlur(id, enabled)` — the override suppresses
   * (or enables) the declared behavior for this instance only.
   */
  hideOnBlur?: boolean

  /**
   * Extensions to Electron's boolean `alwaysOnTop` construction flag. Since
   * `new BrowserWindow` cannot accept a level, this block is the single source
   * of truth for `level` / `relativeLevel`. Consumed at three points:
   *   1. Initial application after window create (when `windowOptions.alwaysOnTop` is true).
   *   2. `wm.behavior.setAlwaysOnTop(id, enabled)` runtime calls.
   *   3. `quirks.macReapplyAlwaysOnTop` re-application after show/showInactive.
   */
  alwaysOnTop?: {
    level?: AlwaysOnTopLevel
    relativeLevel?: number
  }

  /**
   * Declarative initial `setVisibleOnAllWorkspaces(enabled, options)` call,
   * applied once after window creation. Since the Electron constructor has no
   * equivalent option, WM invokes the setter on create.
   *
   * Intentionally no runtime WM setter — windows whose true/false options
   * differ across calls (e.g. SelectionAction's full-screen show sequence)
   * should drive both directions directly on the `BrowserWindow` instance.
   *
   * Reuses Electron's named type `VisibleOnAllWorkspacesOptions` directly,
   * so any field additions in `@types/electron` flow in automatically.
   */
  visibleOnAllWorkspaces?: { enabled: boolean } & VisibleOnAllWorkspacesOptions

  /**
   * [macOS-only effect] Whether this window type triggers Dock icon visibility.
   * No-op on Windows/Linux. Defaults to true when omitted.
   */
  macShowInDock?: boolean

  /**
   * Treat close as hide for reusable singleton surfaces. Applies to both
   * WindowManager.close() and native close events, but native close still
   * proceeds during app quit so shutdown is not blocked.
   */
  closeToHide?: boolean
}

/**
 * Platform quirks — opt-in OS-specific workarounds that WindowManager applies
 * automatically at the right lifecycle moments by monkey-patching the BrowserWindow
 * instance methods (`hide`/`close`/`show`/`showInactive`).
 *
 * Each quirk is empirically derived from hard-won experience in SelectionService;
 * enabling it in a window's metadata is a declarative replacement for hand-rolling
 * the same dance at every call site.
 *
 * Distinct from `WindowBehavior`: quirks are genuine hacks tied to specific OS
 * bugs; pure-semantic declarative config lives in `behavior`.
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
   * [macOS] Re-apply `setAlwaysOnTop(true, level, relativeLevel)` after every
   * `show()`/`showInactive()` call, because macOS silently demotes the level
   * across show cycles. Pure boolean switch — the actual level/relativeLevel
   * are read from `behavior.alwaysOnTop` (single source of truth).
   * No-op when `behavior.alwaysOnTop.level` is unset.
   */
  macReapplyAlwaysOnTop?: boolean
}

/** Common fields shared by all window type metadata variants */
interface WindowTypeMetadataBase {
  /** Window type identifier */
  type: WindowType
  /** Path to the HTML file for this window (relative to renderer root) */
  htmlPath: string
  /**
   * Preload script filename (basename with extension) in `src/preload/`.
   * - Omitted → defaults to `'index.js'`
   * - Empty string → no preload (for windows with `nodeIntegration: true`)
   * - Otherwise → WM prefixes `'../preload/'` and loads that file
   * Mirrors `htmlPath`'s three-state encoding (omitted / non-empty / empty).
   */
  preload?: string
  /**
   * WindowManager creation strategy — controls who drives first-show.
   * - `'auto'`: WM manages visibility — creates hidden, shows on `ready-to-show`
   *   (fresh path) or immediately (recycled path).
   * - `'immediate'`: Window becomes visible as soon as it is constructed
   *   (`new BrowserWindow({ show: true })`). Skips the `ready-to-show` handshake.
   * - `'manual'`: Consumer manages visibility — WM never calls `show()`
   *   for this window type (neither on create nor on singleton reopen).
   * @default 'auto'
   */
  showMode?: 'auto' | 'immediate' | 'manual'
  /** Electron `BrowserWindow` constructor parameters (plus `platformOverrides`). */
  windowOptions: WindowOptions
  /**
   * WindowManager declarative behavior layer. Cross-platform, non-hacky
   * configuration that Electron's constructor cannot express directly.
   * See `WindowBehavior` for each field's semantics and the three-layer
   * split rationale (documented in the window-manager README).
   */
  behavior?: WindowBehavior
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
  /**
   * Count of standby replenishment creates scheduled via `setImmediate` but not
   * yet executed. Included in cap checks (`managed.size + inflightCreates`) to
   * avoid accounting drift between scheduling and actual window creation.
   */
  inflightCreates: number
  /**
   * Pre-computed pool config values, populated once at PoolState creation and
   * never mutated. Caching them on the state lets `poolGcTick` skip per-tick
   * `getWindowTypeMetadata` lookups, `?? 0` coalescing, and `* 1000` arithmetic.
   */
  /** `cfg.standbySize ?? 0` — inactivity-trim floor. */
  readonly standbyFloor: number
  /** `max(standbySize, recycleMinSize) ?? 0` — decay floor. */
  readonly decayFloor: number
  /** `cfg.inactivityTimeout * 1000` (0 means feature disabled). */
  readonly inactivityTimeoutMs: number
  /** `cfg.decayInterval * 1000` (0 means feature disabled). */
  readonly decayIntervalMs: number
  /** True when both inactivity and decay are disabled — GC tick can skip this pool entirely. */
  readonly gcDisabled: boolean
}
