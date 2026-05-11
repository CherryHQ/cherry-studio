import { isMac } from '@main/constant'
import type { WindowBehavior, WindowQuirks } from '@main/core/window/types'
import { BrowserWindow } from 'electron'

/**
 * Apply declarative OS quirks to a freshly-created window by monkey-patching
 * the native instance methods. Consumers continue calling `window.hide()` /
 * `window.show()` as usual; the wrappers transparently run the pre/post hooks.
 *
 * The native method is captured via `.bind(w)` so inner Electron C++ bindings
 * still see the correct `this`; other properties (`webContents`, EventEmitter
 * `.on/.once`, etc.) remain untouched.
 *
 * Distinct from `applyWindowBehavior`: this module holds **OS-specific hacks**
 * (workarounds for macOS bugs). Non-hacky declarative behavior (hideOnBlur,
 * initial setVisibleOnAllWorkspaces, etc.) lives in `behavior.ts`.
 *
 * Must be called AFTER `applyWindowBehavior` so that the behavior layer's
 * initial setter calls (e.g. the first `setAlwaysOnTop(true, level)`) do not
 * accidentally re-trigger the monkey-patched show/showInactive hooks.
 *
 * @param window - The BrowserWindow instance
 * @param quirks - The OS workaround flags (undefined skips all work)
 * @param behavior - The declarative behavior layer, consulted for the level
 *   to re-apply under `macReapplyAlwaysOnTop` (single source of truth for
 *   level/relativeLevel — see `behavior.alwaysOnTop`).
 */
export function applyWindowQuirks(
  window: BrowserWindow,
  quirks: WindowQuirks | undefined,
  behavior: WindowBehavior | undefined
): void {
  if (!quirks) return

  // ── macRestoreFocusOnHide + macClearHoverOnHide ──────────────────────
  // Why:   On macOS, hiding/closing a floating panel-style window lets the
  //        OS pick a random other window as the new frontmost one, visibly
  //        bringing unrelated apps to the foreground. Separately, because
  //        the window is often not FOCUSED, its internal hover state never
  //        clears and ghost-highlights the last-hovered element next show.
  // Does:  Wraps hide()/close() with a focus-guard dance; optionally sends
  //        a synthetic mouseMove(-1, -1) inside the guard to reset hover.
  // When:  Floating / panel-style windows that hide frequently and must
  //        not disturb z-order (SelectionToolbar, SelectionAction).
  //
  // [macOS] Exit-path methods (hide/close): preserve HEAD's ordering —
  //   focus-down (begin guard) → native hide/close → sendInputEvent → 50ms restore (end guard)
  if (isMac && (quirks.macRestoreFocusOnHide || quirks.macClearHoverOnHide)) {
    const originalHide = window.hide.bind(window)
    const originalClose = window.close.bind(window)

    window.hide = () => {
      const guard = quirks.macRestoreFocusOnHide ? beginMacFocusGuard() : null
      originalHide()
      if (quirks.macClearHoverOnHide && !window.isDestroyed()) {
        // [macOS] hacky way — because the window may not be a FOCUSED window,
        // the hover status remains on next show. Send a synthetic mouseMove
        // at (-1, -1) to force the hover state off.
        window.webContents.sendInputEvent({ type: 'mouseMove', x: -1, y: -1 })
      }
      if (guard) endMacFocusGuard(guard)
    }

    // close only wraps the focus dance; hover clearing would be meaningless
    // because webContents is about to be destroyed.
    if (quirks.macRestoreFocusOnHide) {
      window.close = () => {
        const guard = beginMacFocusGuard()
        originalClose()
        endMacFocusGuard(guard)
      }
    }
  }

  // ── macReapplyAlwaysOnTop ────────────────────────────────────────────
  // Why:   On macOS, the level passed to setAlwaysOnTop() is not sticky
  //        across hide/show cycles — after the next show() the level can
  //        silently demote, causing the window to slide behind fullscreen
  //        apps or the menu bar.
  // Does:  After show() / showInactive(), re-applies
  //        setAlwaysOnTop(true, level, relativeLevel) with values read from
  //        `behavior.alwaysOnTop` (single source of truth).
  // When:  Windows that must retain an elevated stacking level (screen-saver
  //        for overlays on top of fullscreen apps; floating otherwise).
  //        No-op when `behavior.alwaysOnTop.level` / `relativeLevel` are unset.
  //
  // [macOS] Show-path methods (show/showInactive): post-hook re-applies alwaysOnTop level.
  if (isMac && quirks.macReapplyAlwaysOnTop) {
    // When behavior doesn't declare a level, fall back to 'floating' explicitly
    // rather than relying on Electron's internal default — this keeps the
    // re-apply call signature stable across Electron upgrades.
    const level = behavior?.alwaysOnTop?.level ?? 'floating'
    const relativeLevel = behavior?.alwaysOnTop?.relativeLevel
    const originalShow = window.show.bind(window)
    const originalShowInactive = window.showInactive.bind(window)
    const reapply = () => {
      if (window.isDestroyed()) return
      // Pass relativeLevel only when declared — avoids polluting the call
      // site with a trailing `undefined` that changes spy signatures.
      if (relativeLevel !== undefined) {
        window.setAlwaysOnTop(true, level, relativeLevel)
      } else {
        window.setAlwaysOnTop(true, level)
      }
    }
    window.show = () => {
      originalShow()
      reapply()
    }
    window.showInactive = () => {
      originalShowInactive()
      reapply()
    }
  }
}

// ─── module-private helpers ──────────────────────────────────────

// [macOS] a HACKY way
// make sure other windows do not bring to front when the window is hidden
// get all focusable windows and set them to not focusable
function beginMacFocusGuard(): BrowserWindow[] {
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
function endMacFocusGuard(focusableWindows: BrowserWindow[]): void {
  setTimeout(() => {
    for (const window of focusableWindows) {
      if (!window.isDestroyed()) {
        window.setFocusable(true)
      }
    }
  }, 50)
}
