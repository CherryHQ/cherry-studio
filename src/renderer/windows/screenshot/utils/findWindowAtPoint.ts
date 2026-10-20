import type { DetectedWindow } from '@shared/types/screenshot'

/**
 * Topmost foreign window under a point, or null.
 *
 * `windows` arrives sorted front-to-back from the main process, so the first hit
 * wins — that ordering is part of the contract, not an implementation detail here.
 * The interval is half-open on the right/bottom edges so two edge-adjacent windows
 * never both match and let z-order pick the wrong one.
 */
export function findWindowAtPoint(x: number, y: number, windows: DetectedWindow[]): DetectedWindow | null {
  for (const w of windows) {
    if (x >= w.x && x < w.x + w.width && y >= w.y && y < w.y + w.height) {
      return w
    }
  }
  return null
}
