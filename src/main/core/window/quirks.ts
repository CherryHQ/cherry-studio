import { isMac } from '@main/constant'
import type { WindowQuirks } from '@main/core/window/types'
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
 * Extracted from WindowManager to keep platform-specific workarounds in a
 * single quarantined module. See `WindowQuirks` in `types.ts` for the field
 * contract and the empirical motivation of each quirk.
 */
export function applyWindowQuirks(window: BrowserWindow, quirks: WindowQuirks | undefined): void {
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
  // Does:  After show() / showInactive(), re-applies setAlwaysOnTop(true, level).
  // When:  Windows that must retain an elevated stacking level (screen-saver
  //        for overlays on top of fullscreen apps; floating otherwise).
  //
  // [macOS] Show-path methods (show/showInactive): post-hook re-applies alwaysOnTop level.
  if (isMac && quirks.macReapplyAlwaysOnTop) {
    const level = quirks.macReapplyAlwaysOnTop === true ? 'floating' : quirks.macReapplyAlwaysOnTop
    const originalShow = window.show.bind(window)
    const originalShowInactive = window.showInactive.bind(window)
    window.show = () => {
      originalShow()
      if (!window.isDestroyed()) window.setAlwaysOnTop(true, level)
    }
    window.showInactive = () => {
      originalShowInactive()
      if (!window.isDestroyed()) window.setAlwaysOnTop(true, level)
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
