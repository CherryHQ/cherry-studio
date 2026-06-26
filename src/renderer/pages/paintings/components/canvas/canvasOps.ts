import type { PaintingMode } from '@shared/data/types/painting'

/**
 * A generation op reachable from a selected card's floating toolbar. Clicking
 * one derives a fresh draft from the card (mode + source outputs as inputs)
 * and opens the immersive composer pre-filled — `generate()` then forks a new
 * painting id, so the result lands as a new connected card.
 *
 * PR1 ships the basic modes (open editing, no prompt templates / no per-mode
 * capability gating — that lands with the configurable tool catalog in PR1b).
 */
export interface CanvasOp {
  id: string
  /** Authoring mode the derived draft runs under. */
  mode: PaintingMode
  /** i18n key for the toolbar label / tooltip. */
  labelKey: string
  /** Whether the op feeds the source image in as a reference/edit input. */
  usesSourceImage: boolean
}

export const CANVAS_OPS: readonly CanvasOp[] = [
  { id: 'variation', mode: 'generate', labelKey: 'paintings.canvas.op.variation', usesSourceImage: false },
  { id: 'edit', mode: 'edit', labelKey: 'paintings.canvas.op.edit', usesSourceImage: true },
  { id: 'reference', mode: 'remix', labelKey: 'paintings.canvas.op.reference', usesSourceImage: true },
  { id: 'upscale', mode: 'upscale', labelKey: 'paintings.canvas.op.upscale', usesSourceImage: true }
]
