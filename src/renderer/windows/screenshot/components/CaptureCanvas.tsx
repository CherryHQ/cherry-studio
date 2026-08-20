/**
 * Full-screen canvas holding the frozen capture, the dark mask, the hovered-window
 * highlight and the selection cutout.
 *
 * Owns the pointer flow for creating a selection, moving it, and clicking a window.
 * Resize handles are separate DOM elements that stop propagation before this sees them.
 */

import type { Dispatch, PointerEvent as ReactPointerEvent } from 'react'
import { memo, useCallback, useLayoutEffect, useRef } from 'react'

import { ACCENT_COLOR, BORDER_WIDTH, MASK_COLOR, Z_INDEX } from '../constants'
import type { OverlayAction, OverlayState, SelectionRect } from '../types'

interface CaptureCanvasProps {
  image: HTMLImageElement
  state: OverlayState
  dispatch: Dispatch<OverlayAction>
  /** Viewport width in logical (CSS) pixels. */
  logicalWidth: number
  /** Viewport height in logical (CSS) pixels. */
  logicalHeight: number
  scaleFactor: number
  /** Rect to highlight under the cursor while idle — a detected window, or the whole display. */
  highlightRect: SelectionRect | null
  /** With an annotation tool active, clicks outside the selection are ignored. */
  lockSelection?: boolean
  /** Fired once, right after the capture has been drawn for the first time. */
  onFirstPaint?: () => void
}

/** Drag distance (logical px) at which a pending window click becomes a drag selection. */
const DRAG_INTENT_THRESHOLD = 4

/**
 * Border drawn entirely OUTSIDE the rect, as four filled strips.
 *
 * `strokeRect` centres the stroke on the path, so half of it would cover the
 * outermost pixels of the captured region and the preview would stop matching the export.
 */
function fillBorderOutside(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bw: number) {
  ctx.fillRect(x - bw, y - bw, w + 2 * bw, bw)
  ctx.fillRect(x - bw, y + h, w + 2 * bw, bw)
  ctx.fillRect(x - bw, y, bw, h)
  ctx.fillRect(x + w, y, bw, h)
}

function renderCanvas(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  logicalWidth: number,
  logicalHeight: number,
  scaleFactor: number,
  selection: SelectionRect | null,
  highlightRect: SelectionRect | null
) {
  // BORDER_WIDTH is physical; the context below is scaled, so convert once.
  const borderLw = BORDER_WIDTH / scaleFactor

  ctx.setTransform(scaleFactor, 0, 0, scaleFactor, 0, 0)
  ctx.clearRect(0, 0, logicalWidth, logicalHeight)

  ctx.drawImage(image, 0, 0, logicalWidth, logicalHeight)

  ctx.fillStyle = MASK_COLOR
  ctx.fillRect(0, 0, logicalWidth, logicalHeight)

  // Undim the hovered window by redrawing the capture clipped to it.
  if (highlightRect && highlightRect.width > 0 && highlightRect.height > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(highlightRect.x, highlightRect.y, highlightRect.width, highlightRect.height)
    ctx.clip()
    ctx.drawImage(image, 0, 0, logicalWidth, logicalHeight)
    ctx.restore()

    ctx.fillStyle = ACCENT_COLOR
    fillBorderOutside(ctx, highlightRect.x, highlightRect.y, highlightRect.width, highlightRect.height, borderLw)
  }

  if (selection && selection.width > 0 && selection.height > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(selection.x, selection.y, selection.width, selection.height)
    ctx.clip()
    ctx.drawImage(image, 0, 0, logicalWidth, logicalHeight)
    ctx.restore()

    ctx.fillStyle = ACCENT_COLOR
    fillBorderOutside(ctx, selection.x, selection.y, selection.width, selection.height, borderLw)
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

/** Inclusive on all four sides, so the border pixels count as "inside" for move-vs-reselect. */
function isPointInSelection(x: number, y: number, selection: SelectionRect | null): boolean {
  if (!selection) return false
  return (
    x >= selection.x && x <= selection.x + selection.width && y >= selection.y && y <= selection.y + selection.height
  )
}

export const CaptureCanvas = memo(function CaptureCanvas({
  image,
  state,
  dispatch,
  logicalWidth,
  logicalHeight,
  scaleFactor,
  highlightRect,
  lockSelection,
  onFirstPaint
}: CaptureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** Window to select on pointer-up, discarded once the drag passes the threshold. */
  const pendingWindowRef = useRef<SelectionRect | null>(null)
  /** Pointer-down origin, kept to measure drag distance and to start the rect where the press landed. */
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null)
  /** Whether pointer capture is live; the idempotency flag for {@link finishDrag}. */
  const isDraggingRef = useRef(false)
  const paintedRef = useRef(false)

  // Separate from the render effect: assigning canvas.width/height reallocates the backing store
  // even when the value is unchanged, so merging the two would re-create it on every pointer move.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = logicalWidth * scaleFactor
    canvas.height = logicalHeight * scaleFactor
  }, [logicalWidth, logicalHeight, scaleFactor])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    renderCanvas(ctx, image, logicalWidth, logicalHeight, scaleFactor, state.selection, highlightRect)

    if (!paintedRef.current) {
      paintedRef.current = true
      onFirstPaint?.()
    }
  }, [image, logicalWidth, logicalHeight, scaleFactor, state.selection, highlightRect, onFirstPaint])

  const toCanvasCoords = useCallback((e: ReactPointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      const coords = toCanvasCoords(e)
      if (!coords) return

      if (lockSelection && state.phase === 'selected' && !isPointInSelection(coords.x, coords.y, state.selection)) {
        return
      }

      // Captured synchronously so every later move/up lands here even off-element.
      canvasRef.current?.setPointerCapture(e.pointerId)
      isDraggingRef.current = true

      if (state.phase === 'selected' && isPointInSelection(coords.x, coords.y, state.selection)) {
        pendingWindowRef.current = null
        dragOriginRef.current = null
        dispatch({ type: 'POINTER_DOWN_SELECTION', x: coords.x, y: coords.y })
      } else if (state.phase === 'idle' && highlightRect) {
        // No dispatch: only pointer-up (or the drag threshold) separates clicking a window from
        // dragging a rect, and highlightRect is never null here, so snapping now would kill free-hand.
        pendingWindowRef.current = highlightRect
        dragOriginRef.current = { x: coords.x, y: coords.y }
      } else {
        pendingWindowRef.current = null
        dragOriginRef.current = null
        dispatch({ type: 'POINTER_DOWN_BACKGROUND', x: coords.x, y: coords.y })
      }
    },
    [state.phase, state.selection, dispatch, toCanvasCoords, highlightRect, lockSelection]
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const coords = toCanvasCoords(e)
      if (!coords) return

      if (pendingWindowRef.current && dragOriginRef.current) {
        const dx = Math.abs(coords.x - dragOriginRef.current.x)
        const dy = Math.abs(coords.y - dragOriginRef.current.y)
        if (dx >= DRAG_INTENT_THRESHOLD || dy >= DRAG_INTENT_THRESHOLD) {
          // Start at the ORIGIN, not here: starting at the current point would throw
          // away the first few pixels and the rect would visibly begin off the press.
          dispatch({
            type: 'POINTER_DOWN_BACKGROUND',
            x: dragOriginRef.current.x,
            y: dragOriginRef.current.y
          })
          pendingWindowRef.current = null
          dragOriginRef.current = null
        }
      }

      dispatch({
        type: 'POINTER_MOVE',
        x: coords.x,
        y: coords.y,
        viewportWidth: logicalWidth,
        viewportHeight: logicalHeight
      })
    },
    [dispatch, toCanvasCoords, logicalWidth, logicalHeight]
  )

  /**
   * Single exit for every way a drag can end.
   *
   * Idempotent: reads and clears `isDraggingRef` in one pass so the second of
   * pointerup / pointercancel / lostpointercapture is a no-op instead of a duplicate
   * dispatch. Resolving a still-pending window here is what makes a plain click select
   * it — a bare POINTER_UP in `idle` is an identity transition and nothing would happen.
   */
  const finishDrag = useCallback(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false

    const pending = pendingWindowRef.current
    pendingWindowRef.current = null
    const origin = dragOriginRef.current
    dragOriginRef.current = null

    if (pending && origin) {
      dispatch({ type: 'POINTER_DOWN_WINDOW', x: origin.x, y: origin.y, windowRect: pending })
    } else {
      dispatch({ type: 'POINTER_UP' })
    }
  }, [dispatch])

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!isDraggingRef.current) return

      // Releasing a capture that was never taken throws NotFoundError, which would
      // abort before finishDrag runs and strand the gesture.
      if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
        canvasRef.current.releasePointerCapture(e.pointerId)
      }

      finishDrag()
    },
    [finishDrag]
  )

  /** System-initiated interruption (a trackpad gesture, an OS takeover) — otherwise the drag never ends. */
  const handlePointerCancel = useCallback(() => {
    finishDrag()
  }, [finishDrag])

  /** Safety net for capture lost without a pointerup: element removed, capture stolen, browser revoke. */
  const handleLostPointerCapture = useCallback(() => {
    finishDrag()
  }, [finishDrag])

  const getCursor = () => {
    if (state.phase === 'selecting') return 'crosshair'
    if (state.phase === 'moving') return 'move'
    if (
      state.phase === 'selected' &&
      state.pointerPosition &&
      isPointInSelection(state.pointerPosition.x, state.pointerPosition.y, state.selection)
    ) {
      return 'move'
    }
    return 'crosshair'
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{
        zIndex: Z_INDEX.CAPTURE_CANVAS,
        width: logicalWidth,
        height: logicalHeight,
        cursor: getCursor()
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
    />
  )
})
