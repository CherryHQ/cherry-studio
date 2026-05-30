import type { ManagedWindow, WindowBehavior, WindowOptions, WindowType } from '@main/core/window/types'
import type { BrowserWindow } from 'electron'

/**
 * Apply the declarative {@link WindowBehavior} layer to a freshly-created window.
 *
 * This is the non-hacky counterpart to `applyWindowQuirks`: it runs the initial
 * setter calls that Electron's `BrowserWindow` constructor cannot express, and
 * mounts the `blur → hide` listener for {@link WindowBehavior.hideOnBlur}.
 *
 * Call ordering in `WindowManager.createWindow`:
 *
 *   1. `new BrowserWindow(constructorOptions)` — Electron-native setup
 *   2. `applyWindowBehavior(window, behavior, ...)` — initial setters + blur hook
 *   3. `applyWindowQuirks(window, quirks, behavior)` — monkey-patches hide/show
 *
 * Running behavior BEFORE quirks has two intentional effects:
 *   - The initial `setAlwaysOnTop(true, level)` is free of monkey-patch overhead
 *     (first-time setup with no hide/show loop to guard against).
 *   - The blur → `window.hide()` call inherits whatever `quirks` install on
 *     `hide` (macRestoreFocusOnHide, macClearHoverOnHide), because quirks
 *     re-assign `window.hide` after this function returns but the listener
 *     body dereferences `window.hide` at event-fire time.
 *
 * @param window - The BrowserWindow instance
 * @param behavior - The declarative behavior metadata (undefined skips all work)
 * @param id - The WindowManager-assigned windowId (used as override map key)
 * @param getHideOnBlurOverride - Closure returning the runtime override for this
 *   window id (or undefined if unset). Provided by WindowManager — passing a
 *   closure instead of the WM instance keeps this module free of a reverse
 *   dependency.
 * @param windowOptions - The merged WindowOptions used to construct the window.
 *   Consulted to decide whether to re-apply `setAlwaysOnTop` with the
 *   `behavior.alwaysOnTop` level: the initial call is skipped if
 *   `windowOptions.alwaysOnTop !== true`, since Electron did not enable it
 *   during construction and the caller has not opted in.
 */
export function applyWindowBehavior(
  window: BrowserWindow,
  behavior: WindowBehavior | undefined,
  id: string,
  getHideOnBlurOverride: (id: string) => boolean | undefined,
  windowOptions: WindowOptions
): void {
  if (!behavior) return

  // ── Initial alwaysOnTop with level/relativeLevel ─────────────────────
  // Electron's `new BrowserWindow({ alwaysOnTop: true })` enables the flag but
  // cannot accept a level. We enhance it here once so the level takes effect
  // before any show happens. The macReapplyAlwaysOnTop quirk (if set) will
  // keep re-applying on subsequent show/showInactive to survive macOS demotion.
  if (windowOptions.alwaysOnTop === true && behavior.alwaysOnTop) {
    const { level, relativeLevel } = behavior.alwaysOnTop
    if (level !== undefined && relativeLevel !== undefined) {
      window.setAlwaysOnTop(true, level, relativeLevel)
    } else if (level !== undefined) {
      window.setAlwaysOnTop(true, level)
    }
    // No-op when only relativeLevel is set without level — not a meaningful
    // Electron call (the method's 2nd parameter must be a level string).
  }

  // ── Initial setVisibleOnAllWorkspaces ────────────────────────────────
  // One-shot on create. Windows whose true/false options differ per call
  // (e.g. SelectionAction's full-screen show sequence) should not declare
  // this — they drive both directions via direct window calls.
  if (behavior.visibleOnAllWorkspaces) {
    const { enabled, ...options } = behavior.visibleOnAllWorkspaces
    window.setVisibleOnAllWorkspaces(enabled, options)
  }

  // ── hideOnBlur listener ──────────────────────────────────────────────
  // Auto-hide on blur, with runtime override via wm.behavior.setHideOnBlur(id, enabled).
  // `window.hide()` dereferences at fire time, so it picks up any monkey-patch
  // quirks (macRestoreFocusOnHide, macClearHoverOnHide) installed later.
  if (behavior.hideOnBlur) {
    window.on('blur', () => {
      if (window.isDestroyed() || !window.isVisible()) return
      // override === false means "pinned / don't auto-hide"; undefined falls
      // through to the registry-declared default (true in this branch).
      if (getHideOnBlurOverride(id) === false) return
      window.hide()
    })
  }
}

/**
 * Minimal callback surface that {@link BehaviorController} needs from
 * WindowManager. Keeping this an interface (rather than importing the WM
 * class) preserves the one-way dependency direction: behavior.ts knows
 * nothing about WindowManager beyond these two accessors.
 */
export interface BehaviorHost {
  getManagedWindow(id: string): ManagedWindow | undefined
  updateDockVisibility(): void
}

/**
 * Owns runtime state and setter API for the declarative {@link WindowBehavior}
 * layer. Exposed on WindowManager as `wm.behavior`, mirroring the three-layer
 * `windowOptions` / `behavior` / `quirks` conceptual split at the API surface.
 *
 * State owned here:
 *   - Per-window override for `behavior.hideOnBlur`, consulted by the blur
 *     listener installed in {@link applyWindowBehavior}.
 *   - Per-type override for `behavior.macShowInDock`, consulted by the
 *     Dock-visibility predicate in WindowManager.
 *
 * `setAlwaysOnTop` is stateless — it forwards to Electron using the level
 * declared in the registry as the single source of truth.
 *
 * Lifetime: {@link clearForWindow} is called from WindowManager on window
 * destroy and pool release so pooled windows reopened by a different consumer
 * start from registry defaults.
 */
export class BehaviorController {
  private hideOnBlurOverride = new Map<string, boolean>()
  private macShowInDockOverrideByType = new Map<WindowType, boolean>()

  constructor(private readonly host: BehaviorHost) {}

  /**
   * Override the declarative `behavior.hideOnBlur` at runtime for a single
   * window instance. Used by consumers to implement "pin"-style toggles
   * without mutating the registry default.
   *
   * Semantics:
   *   - `enabled: true` — window auto-hides on blur (same as declared default)
   *   - `enabled: false` — blur is ignored (effectively pinned)
   *   - Not called — the declared `behavior.hideOnBlur` is used as-is
   *
   * Lifetime: cleared on window destroy and on pool release so the next
   * `open()` for a different consumer sees a clean slate. Consumers using
   * pooled windows that need a non-default value should re-apply it from
   * their `onWindowCreatedByType` / reuse callback.
   *
   * No-op when the window doesn't exist or the type's registry metadata
   * does not declare `behavior.hideOnBlur` (no listener was ever installed).
   */
  public setHideOnBlur(windowId: string, enabled: boolean): void {
    const managed = this.host.getManagedWindow(windowId)
    if (!managed) return
    if (!managed.metadata.behavior?.hideOnBlur) {
      // No listener was installed by applyWindowBehavior for this window — the
      // override would have no effect. Skip silently rather than create a
      // false impression of capability.
      return
    }
    this.hideOnBlurOverride.set(windowId, enabled)
  }

  /**
   * Set the always-on-top flag for a single window instance, using the
   * `level` and `relativeLevel` declared in `behavior.alwaysOnTop` as the
   * single source of truth (no hardcoded level in consumer code).
   *
   * When `behavior.alwaysOnTop` is unset, the underlying
   * `window.setAlwaysOnTop(enabled)` is called with `level` / `relativeLevel`
   * both undefined — matching Electron's default. Consumers that need a
   * per-call level should drive `window.setAlwaysOnTop` directly.
   *
   * Note: Electron ignores `level` when `enabled === false`.
   */
  public setAlwaysOnTop(windowId: string, enabled: boolean): void {
    const managed = this.host.getManagedWindow(windowId)
    if (!managed || managed.window.isDestroyed()) return
    const { level, relativeLevel } = managed.metadata.behavior?.alwaysOnTop ?? {}
    // Pass only the arguments actually declared — avoids trailing `undefined`s
    // that would change the call signature observed by spies or future overloads.
    if (level !== undefined && relativeLevel !== undefined) {
      managed.window.setAlwaysOnTop(enabled, level, relativeLevel)
    } else if (level !== undefined) {
      managed.window.setAlwaysOnTop(enabled, level)
    } else {
      managed.window.setAlwaysOnTop(enabled)
    }
  }

  /**
   * Override the Dock-contribution flag for a window type at runtime.
   *
   * Typical use: a service enters or exits a "tray mode" where its window type
   * should disappear from the Dock. For example, `MainWindowService` sets
   * `(Main, false)` when handling close-to-tray, and `(Main, true)` when the
   * user reopens the window from the tray.
   *
   * Safe to call BEFORE any instance of the type exists — the override is
   * stored by type, so it takes effect the moment the first window of that
   * type is created (see `createWindow`'s trailing `updateDockVisibility` call).
   *
   * Idempotent: repeated calls with the same value only re-run the native
   * show/hide path when the aggregate decision actually changes.
   */
  public setMacShowInDockByType(type: WindowType, value: boolean): void {
    this.macShowInDockOverrideByType.set(type, value)
    this.host.updateDockVisibility()
  }

  // ─── Internal hooks (called by WindowManager) ────────────────────

  /** @internal */
  public getHideOnBlurOverride(id: string): boolean | undefined {
    return this.hideOnBlurOverride.get(id)
  }

  /** @internal */
  public getMacShowInDockOverride(type: WindowType): boolean | undefined {
    return this.macShowInDockOverrideByType.get(type)
  }

  /**
   * Clear per-window runtime state on window destroy / pool release.
   * WindowManager calls this from `cleanupWindowTracking` and `releaseToPool`
   * so pooled windows reopened later for a different consumer start from the
   * registry-declared defaults.
   * @internal
   */
  public clearForWindow(windowId: string): void {
    this.hideOnBlurOverride.delete(windowId)
  }
}
