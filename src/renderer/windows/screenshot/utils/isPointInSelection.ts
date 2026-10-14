import type { SelectionRect } from '../types'

/** Inclusive on all four sides, so the border pixels count as "inside". */
export function isPointInSelection(x: number, y: number, selection: SelectionRect | null): boolean {
  if (!selection) return false
  return (
    x >= selection.x && x <= selection.x + selection.width && y >= selection.y && y <= selection.y + selection.height
  )
}
