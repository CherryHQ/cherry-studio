/**
 * Floating `W × H` badge for the selection (or the hovered window while idle).
 *
 * Placed above the rect, else outside its left edge, else outside its right edge —
 * never inside, so it cannot cover the content being captured.
 */

import { memo } from 'react'

import { BORDER_WIDTH, Z_INDEX } from '../constants'
import type { SelectionRect } from '../types'

interface DimensionLabelProps {
  rect: SelectionRect
  scaleFactor: number
  /** Toolbar bounds, passed only when the toolbar sits above the selection. */
  toolbarRect?: { top: number; height: number; left: number; width: number }
}

/** Label height estimate in CSS px, used for the flip decision. */
const LABEL_HEIGHT = 22
/**
 * Gap between the rect edge and the label, in CSS px.
 *
 * KNOWN UNIT MISMATCH, ported as-is: `BORDER_WIDTH` is a PHYSICAL-pixel constant
 * being used here as a CSS offset, so the gap over-shoots the drawn border by
 * ~1.5 px at 2× scaling. Purely cosmetic, but it is the one place the physical /
 * logical split is violated — do not "tidy" it without deciding what the gap should be.
 */
const GAP = BORDER_WIDTH + 2
/** Conservative width estimate in CSS px (the label is never measured), e.g. "99999 × 99999". */
const LABEL_WIDTH_ESTIMATE = 110

export const DimensionLabel = memo(function DimensionLabel({ rect, scaleFactor, toolbarRect }: DimensionLabelProps) {
  // Reported in PHYSICAL pixels — that is what the exported file will be.
  const w = Math.round(rect.width * scaleFactor)
  const h = Math.round(rect.height * scaleFactor)

  let fitsAbove = rect.y >= LABEL_HEIGHT + GAP

  if (fitsAbove && toolbarRect) {
    const dimTop = rect.y - LABEL_HEIGHT - GAP
    const dimBottom = dimTop + LABEL_HEIGHT
    const dimLeft = rect.x
    const dimRight = rect.x + LABEL_WIDTH_ESTIMATE

    const tbBottom = toolbarRect.top + toolbarRect.height

    const vertOverlap = dimTop < tbBottom && dimBottom > toolbarRect.top
    const horizOverlap = dimLeft < toolbarRect.left + toolbarRect.width && dimRight > toolbarRect.left

    if (vertOverlap && horizOverlap) {
      fitsAbove = false
    }
  }

  const fitsLeft = rect.x >= LABEL_WIDTH_ESTIMATE + GAP

  let top: number
  let left: number
  let transform: string | undefined

  if (fitsAbove) {
    top = rect.y - LABEL_HEIGHT - GAP
    left = rect.x
  } else if (fitsLeft) {
    top = rect.y
    left = rect.x - GAP
    transform = 'translateX(-100%)'
  } else {
    top = rect.y
    left = rect.x + rect.width + GAP
  }

  return (
    <div
      className="pointer-events-none absolute rounded-sm border border-border bg-popover/85 px-1.5 py-0.5 font-mono text-popover-foreground text-xs shadow-sm backdrop-blur-xs"
      style={{ zIndex: Z_INDEX.DIMENSION_LABEL, top, left, transform }}>
      {w} × {h}
    </div>
  )
})
