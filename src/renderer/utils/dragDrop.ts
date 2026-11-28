import { SortableKeyboardPlugin } from '@dnd-kit/dom/sortable'
import type { DragMoveEvent } from '@dnd-kit/react'

type DragOperation = DragMoveEvent['operation']

/**
 * Sortable plugins for lists that mark an insertion line instead of previewing the order:
 * arrow keys step one row at a time, and without the optimistic sorting plugin no row moves.
 */
export const ROW_STEP_SORTABLE_PLUGINS = [SortableKeyboardPlugin]

/**
 * Which side of the target the dragged row lands on: its center against the target's,
 * derived from the start shape and the transform because `shape.current` is measured a frame late.
 * A keyboard step aligns the row with its target, so a tie falls back to the direction it moved.
 */
export function getInsertionSide({ source, target, shape, transform }: DragOperation): 'before' | 'after' | null {
  if (!source || !target || source.id === target.id) return null
  const startCenterY = shape?.initial.center.y
  const targetCenterY = target.shape?.center.y
  if (startCenterY === undefined || targetCenterY === undefined) return null
  const offset = startCenterY + transform.y - targetCenterY
  if (Math.abs(offset) < 1) return transform.y < 0 ? 'before' : 'after'
  return offset < 0 ? 'before' : 'after'
}
