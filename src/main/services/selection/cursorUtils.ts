/**
 * macOS I-beam cursor hotspot detection with tolerance.
 *
 * Mirrors the native fix in patches/selection-hook@2.0.3.patch so the
 * tolerance logic is unit-testable without a macOS build. The native code
 * is the source of truth; this module documents the contract and guards
 * against regressions such as fractional Retina hotspots (e.g. 11.5, 11.0
 * on macOS 26 — see https://github.com/CherryHQ/cherry-studio/issues/19044).
 */

export type HotSpot = { x: number; y: number }

/** Known I-beam hotspots from selection-hook (all macOS versions to date). */
const KNOWN_IBEAM_HOTSPOTS: HotSpot[] = [
  { x: 4, y: 9 },
  { x: 16, y: 16 },
  { x: 12, y: 11 }
]

/** Tolerance that covers Retina / display-scaling fractional offsets. */
const HOTSPOT_TOLERANCE = 0.6

export function isIBeamHotspot(hotSpot: HotSpot, tolerance: number = HOTSPOT_TOLERANCE): boolean {
  return KNOWN_IBEAM_HOTSPOTS.some(
    (known) => Math.abs(hotSpot.x - known.x) < tolerance && Math.abs(hotSpot.y - known.y) < tolerance
  )
}

/** Exposed for tests / diagnostics. */
export const __internal = { KNOWN_IBEAM_HOTSPOTS, HOTSPOT_TOLERANCE }
