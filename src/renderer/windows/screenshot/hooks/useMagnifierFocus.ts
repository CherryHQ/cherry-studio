import { useMemo } from 'react'

import type { OverlayState } from '../types'

/**
 * Where the magnifier's pixel grid should centre.
 *
 * While the user is dragging an edge, centring on the raw cursor is useless — they
 * are aiming the selection boundary, so the grid centres on the boundary pixel
 * being moved. Returns undefined whenever the cursor itself is the right target.
 */
export function useMagnifierFocus(
  state: OverlayState,
  scaleFactor: number
): { focusX: number; focusY: number } | undefined {
  return useMemo(() => {
    if (!state.selection || !state.pointerPosition) return undefined
    const { x, y, width, height } = state.selection
    // One physical pixel expressed in logical units: on the right/bottom edges this
    // points at the last captured pixel rather than the first one outside the rect.
    const px = 1 / scaleFactor

    if (state.phase === 'resizing' && state.activeHandle && state.selectionAtDragStart) {
      // The reducer flips the rect when a drag crosses the anchored edge; without the
      // matching flip here the grid would stay on the edge that is no longer moving.
      const orig = state.selectionAtDragStart
      const origRight = orig.x + orig.width
      const origBottom = orig.y + orig.height
      let handle: string = state.activeHandle
      if (handle.includes('w') && state.pointerPosition.x > origRight) handle = handle.replace('w', 'e')
      else if (handle.includes('e') && state.pointerPosition.x < orig.x) handle = handle.replace('e', 'w')
      if (handle.includes('n') && state.pointerPosition.y > origBottom) handle = handle.replace('n', 's')
      else if (handle.includes('s') && state.pointerPosition.y < orig.y) handle = handle.replace('s', 'n')

      // Edge handles constrain one axis only; the other falls back to the raw pointer.
      return {
        focusX: handle.includes('w') ? x : handle.includes('e') ? x + width - px : state.pointerPosition.x,
        focusY: handle.includes('n') ? y : handle.includes('s') ? y + height - px : state.pointerPosition.y
      }
    }

    if (state.phase === 'selecting' && state.dragOrigin) {
      // Focus the corner the user is dragging, whichever direction the drag went.
      return {
        focusX: state.pointerPosition.x >= state.dragOrigin.x ? x + width - px : x,
        focusY: state.pointerPosition.y >= state.dragOrigin.y ? y + height - px : y
      }
    }

    return undefined
  }, [
    state.phase,
    state.selection,
    state.selectionAtDragStart,
    state.pointerPosition,
    state.activeHandle,
    state.dragOrigin,
    scaleFactor
  ])
}
