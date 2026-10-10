/**
 * Overlay state machine.
 *
 * Owns selection creation, move and resize. All coordinates are logical (CSS) pixels.
 */

import type { OverlayAction, OverlayState, SelectionRect } from './types'

/** Minimum drag extent (logical px) on BOTH axes before a selection commits. */
const MIN_SELECTION_SIZE = 3

export const initialState: OverlayState = {
  phase: 'idle',
  selection: null,
  dragOrigin: null,
  selectionAtDragStart: null,
  activeHandle: null,
  pointerPosition: null
}

/** Normalize two arbitrary points into a positive-size rect, so reverse drags work. */
function rectFromPoints(x1: number, y1: number, x2: number, y2: number): SelectionRect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}

/**
 * Resize `original` by dragging `handle` to (px, py).
 *
 * The opposite edge is the anchor; dragging past it flips the rect instead of
 * collapsing it, and the 1 px floor keeps every downstream canvas non-degenerate
 * (`canvas.width = 0` renders blank or throws). Always fed the drag-start
 * snapshot, never the previous frame's result, so a long drag cannot creep.
 */
function resizeSelection(original: SelectionRect, handle: string, px: number, py: number): SelectionRect {
  let { x, y, width, height } = original
  const right = x + width
  const bottom = y + height

  if (handle.includes('w')) {
    width = Math.max(1, Math.abs(px - right))
    x = px <= right ? right - width : right
  } else if (handle.includes('e')) {
    width = Math.max(1, Math.abs(px - original.x))
    x = px >= original.x ? original.x : original.x - width
  }

  if (handle.includes('n')) {
    height = Math.max(1, Math.abs(py - bottom))
    y = py <= bottom ? bottom - height : bottom
  } else if (handle.includes('s')) {
    height = Math.max(1, Math.abs(py - original.y))
    y = py >= original.y ? original.y : original.y - height
  }

  return { x, y, width, height }
}

/** Keep a moved rect inside the viewport by adjusting position only — its size must survive the clamp. */
function clampMovePosition(rect: SelectionRect, vw: number, vh: number): SelectionRect {
  return {
    ...rect,
    x: Math.max(0, Math.min(rect.x, vw - rect.width)),
    y: Math.max(0, Math.min(rect.y, vh - rect.height))
  }
}

export function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  switch (action.type) {
    case 'POINTER_DOWN_BACKGROUND': {
      return {
        ...state,
        phase: 'selecting',
        dragOrigin: { x: action.x, y: action.y },
        selection: { x: action.x, y: action.y, width: 0, height: 0 },
        selectionAtDragStart: null,
        activeHandle: null,
        pointerPosition: { x: action.x, y: action.y }
      }
    }

    case 'POINTER_DOWN_SELECTION': {
      if (state.phase !== 'selected' || !state.selection) return state
      return {
        ...state,
        // Stays in 'selected': entering 'moving' here would let a bare click flip the phase and
        // remount everything gated on 'selected' — toolbar, property panel, annotation interactivity.
        dragOrigin: { x: action.x, y: action.y },
        selectionAtDragStart: { ...state.selection },
        pointerPosition: { x: action.x, y: action.y }
      }
    }

    case 'POINTER_DOWN_WINDOW': {
      return {
        ...state,
        phase: 'selected',
        selection: { ...action.windowRect },
        dragOrigin: null,
        selectionAtDragStart: null,
        activeHandle: null,
        pointerPosition: { x: action.x, y: action.y }
      }
    }

    case 'POINTER_DOWN_HANDLE': {
      if (state.phase !== 'selected' || !state.selection) return state
      return {
        ...state,
        phase: 'resizing',
        dragOrigin: { x: action.x, y: action.y },
        selectionAtDragStart: { ...state.selection },
        activeHandle: action.handle,
        pointerPosition: { x: action.x, y: action.y }
      }
    }

    case 'POINTER_MOVE': {
      // Raw, never clamped: the magnifier must keep following the real cursor once it
      // leaves the display, and the resize-handle flip detection compares against it.
      const pointerPosition = { x: action.x, y: action.y }

      // Clamped copy, used only where the RECT EDGE itself must stop at the display edge.
      const vw = action.viewportWidth
      const vh = action.viewportHeight
      const cx = vw != null ? Math.max(0, Math.min(action.x, vw)) : action.x
      const cy = vh != null ? Math.max(0, Math.min(action.y, vh)) : action.y

      if (state.phase === 'selecting' && state.dragOrigin) {
        return {
          ...state,
          selection: rectFromPoints(state.dragOrigin.x, state.dragOrigin.y, cx, cy),
          pointerPosition
        }
      }

      // Lazy transition: the first real move after POINTER_DOWN_SELECTION.
      if (state.phase === 'selected' && state.dragOrigin && state.selectionAtDragStart) {
        return {
          ...state,
          phase: 'moving',
          selection: moveSelection(state.selectionAtDragStart, state.dragOrigin, action),
          pointerPosition
        }
      }

      if (state.phase === 'moving' && state.dragOrigin && state.selectionAtDragStart) {
        return {
          ...state,
          selection: moveSelection(state.selectionAtDragStart, state.dragOrigin, action),
          pointerPosition
        }
      }

      if (state.phase === 'resizing' && state.activeHandle && state.selectionAtDragStart) {
        return {
          ...state,
          selection: resizeSelection(state.selectionAtDragStart, state.activeHandle, cx, cy),
          pointerPosition
        }
      }

      // idle / armed-but-unmoved: nothing but cursor tracking for the magnifier.
      return { ...state, pointerPosition }
    }

    case 'POINTER_UP': {
      // Click inside the selection that never moved — disarm without changing phase: a leftover
      // dragOrigin lets the next cursor-tracking POINTER_MOVE take the lazy branch and teleport it.
      if (state.phase === 'selected' && state.dragOrigin) {
        return { ...state, dragOrigin: null, selectionAtDragStart: null }
      }

      if (state.phase === 'selecting' && state.selection) {
        if (state.selection.width < MIN_SELECTION_SIZE || state.selection.height < MIN_SELECTION_SIZE) {
          return {
            ...state,
            phase: 'idle',
            selection: null,
            dragOrigin: null,
            selectionAtDragStart: null,
            activeHandle: null
          }
        }
        return { ...state, phase: 'selected', dragOrigin: null, selectionAtDragStart: null }
      }

      if (state.phase === 'moving' || state.phase === 'resizing') {
        return {
          ...state,
          phase: 'selected',
          dragOrigin: null,
          selectionAtDragStart: null,
          activeHandle: null
        }
      }

      // Same reference on purpose: a stray pointerup must not re-render the capture canvas.
      return state
    }

    case 'RESET': {
      return { ...initialState }
    }

    default:
      return state
  }
}

/**
 * Translate the drag-start snapshot by the RAW pointer delta, then clamp the result.
 *
 * Clamping the delta instead would make the rect stick at the display edge and then
 * jump: drag off-screen and back, and the selection would be offset by the overshoot.
 */
function moveSelection(
  selectionAtDragStart: SelectionRect,
  dragOrigin: { x: number; y: number },
  action: { x: number; y: number; viewportWidth?: number; viewportHeight?: number }
): SelectionRect {
  const moved: SelectionRect = {
    ...selectionAtDragStart,
    x: selectionAtDragStart.x + (action.x - dragOrigin.x),
    y: selectionAtDragStart.y + (action.y - dragOrigin.y)
  }
  if (action.viewportWidth == null || action.viewportHeight == null) return moved
  return clampMovePosition(moved, action.viewportWidth, action.viewportHeight)
}
