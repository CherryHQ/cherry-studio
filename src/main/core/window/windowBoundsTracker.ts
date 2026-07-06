import { application } from '@application'
import type { WindowOptions, WindowType } from '@main/core/window/types'
import type { WindowBoundsState } from '@shared/data/cache/cacheValueTypes'
import type { BrowserWindow, Rectangle } from 'electron'
import { screen } from 'electron'

/**
 * Stateless bounds I/O for WindowManager's "remember bounds" capability.
 *
 * A free-function module (not a class) mirroring `behavior.ts`'s `applyWindowBehavior`
 * — there is no per-tracker state to hold: the only durable state is the
 * `window.bounds` record in the main-process persist cache, and the only runtime
 * toggle (the override map) lives on WindowManager. Each function resolves the
 * CacheService lazily via `application.get` so the module has no init-time
 * service dependency.
 *
 * Storage shape: `window.bounds` is a `Record<WindowType, WindowBoundsState>`.
 * This module is its sole writer; WindowManager gates every call behind
 * `shouldRememberBounds(type)` (singleton-only), so only singleton window types
 * ever appear as keys.
 */

const PERSIST_KEY = 'window.bounds' as const

/** A finite rectangle with a strictly positive size. */
function isValidRect(r: { x: number; y: number; width: number; height: number } | undefined): boolean {
  return (
    !!r &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    r.width > 0 &&
    Number.isFinite(r.height) &&
    r.height > 0
  )
}

/**
 * Guard against corrupted / partial persisted geometry (hand-edited JSON, a
 * schema change, a Wayland `{x:0,y:0,width:0,height:0}` snapshot). Ported from
 * electron-window-state's `hasBounds`: the window rect AND the `displayBounds`
 * reference must both be finite with a positive size. `displayBounds` is checked
 * because the restore path feeds it straight to `screen.getDisplayMatching`,
 * which throws on a missing/malformed rect — and `injectSavedBounds` runs before
 * `new BrowserWindow`, so an unguarded throw there would block the window from
 * opening. An invalid record is treated as "no saved bounds".
 */
function isValidBounds(b: WindowBoundsState | undefined): b is WindowBoundsState {
  return !!b && isValidRect(b) && isValidRect(b.displayBounds)
}

/** Whether `rect` lies entirely within `area`. */
function isFullyInside(rect: Rectangle, area: Rectangle): boolean {
  return (
    rect.x >= area.x &&
    rect.y >= area.y &&
    rect.x + rect.width <= area.x + area.width &&
    rect.y + rect.height <= area.y + area.height
  )
}

/**
 * Fit `rect` into `area`: shrink the size to fit when it is larger than the
 * work area, then clamp the origin so the whole rect stays on-screen.
 */
function clampInto(rect: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(rect.width, area.width)
  const height = Math.min(rect.height, area.height)
  const x = Math.min(Math.max(rect.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - height)
  return { x, y, width, height }
}

/**
 * Read the persisted geometry for a window type, validated. Returns `undefined`
 * when nothing is saved OR the stored record is corrupt/partial — so every
 * consumer (restore, and `peekWindowBounds`) gets a usable value or nothing,
 * never a half-valid record.
 */
export function peekSavedState(type: WindowType): WindowBoundsState | undefined {
  const saved = application.get('CacheService').getPersist(PERSIST_KEY)[type]
  return isValidBounds(saved) ? saved : undefined
}

/**
 * Inject saved geometry into the merged window options before construction.
 *
 * No saved bounds (or an invalid record) leaves `config` untouched, so the
 * window opens at its registry default. With valid bounds, the window is
 * restored onto the display it was last on: `getDisplayMatching` resolves the
 * nearest still-attached display, the rect is kept as-is when it still fits, and
 * clamped into that display's work area otherwise (so a removed/resized monitor
 * never leaves the window off-screen). Never falls back to the primary display.
 */
export function injectSavedBounds(type: WindowType, config: WindowOptions): void {
  const saved = peekSavedState(type)
  if (!saved) return

  const target = screen.getDisplayMatching(saved.displayBounds)
  const rect: Rectangle = { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
  const placed = isFullyInside(rect, target.workArea) ? rect : clampInto(rect, target.workArea)

  config.x = placed.x
  config.y = placed.y
  config.width = placed.width
  config.height = placed.height
}

/**
 * Snapshot a live window's geometry into the persist cache.
 *
 * Uses `getNormalBounds()` (the pre-maximize rect) so a maximized window stores
 * its restore size while `isMaximized` records the maximized flag — the consumer
 * re-applies maximize on restore. The display is captured from the normal rect
 * so it tracks where the window actually lives. A destroyed window is skipped.
 */
export function persistNow(window: BrowserWindow, type: WindowType): void {
  if (window.isDestroyed()) return

  const normal = window.getNormalBounds()
  const display = screen.getDisplayMatching(normal)
  const state: WindowBoundsState = {
    x: normal.x,
    y: normal.y,
    width: normal.width,
    height: normal.height,
    isMaximized: window.isMaximized(),
    displayBounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    }
  }

  const cache = application.get('CacheService')
  cache.setPersist(PERSIST_KEY, { ...cache.getPersist(PERSIST_KEY), [type]: state })
}

/**
 * Drop the saved geometry for a single window type (used when the runtime
 * toggle is switched off). Rewrites the record without this type's slot rather
 * than calling `deletePersist`, which would reset the whole `window.bounds`
 * record to `{}` and wipe every other type's saved geometry.
 */
export function clearSavedBounds(type: WindowType): void {
  const cache = application.get('CacheService')
  const current = cache.getPersist(PERSIST_KEY)
  if (!(type in current)) return

  const next = { ...current }
  delete next[type]
  cache.setPersist(PERSIST_KEY, next)
}
