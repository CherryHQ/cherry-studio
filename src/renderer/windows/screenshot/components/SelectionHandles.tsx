/**
 * Eight resize handles plus four edge strips around the selection.
 *
 * Each is a DOM element that captures the pointer on press, so the drag keeps
 * tracking after the cursor leaves it, and stops propagation so the capture canvas
 * underneath does not simultaneously start a new selection.
 */

import type { CSSProperties, Dispatch, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { memo, useCallback, useRef } from 'react'

import { ACCENT_COLOR, Z_INDEX } from '../constants'
import type { OverlayAction, ResizeHandle, SelectionRect } from '../types'

interface SelectionHandlesProps {
  /** Already outset by the caller so the handles sit on the outside border strip. */
  selection: SelectionRect
  dispatch: Dispatch<OverlayAction>
  /** Canvas origin offset; the overlay canvas is full-screen, hence the default. */
  canvasOrigin?: { left: number; top: number }
  /** Forwarded in POINTER_MOVE so the reducer can clamp to the display. */
  viewportWidth: number
  viewportHeight: number
}

/** Dot diameter in CSS px. */
const HANDLE_SIZE = 12
const HANDLE_BORDER_COLOR = '#ffffff'
/** Edge-strip thickness in CSS px, centred on the edge so half the grab area lies inside. */
const EDGE_THICKNESS = 8

const EDGE_CONFIGS: Array<{
  id: ResizeHandle
  cursor: string
  getStyle: (s: SelectionRect) => CSSProperties
}> = [
  {
    id: 'n',
    cursor: 'ns-resize',
    getStyle: (s) => ({ left: s.x, top: s.y - EDGE_THICKNESS / 2, width: s.width, height: EDGE_THICKNESS })
  },
  {
    id: 'e',
    cursor: 'ew-resize',
    getStyle: (s) => ({ left: s.x + s.width - EDGE_THICKNESS / 2, top: s.y, width: EDGE_THICKNESS, height: s.height })
  },
  {
    id: 's',
    cursor: 'ns-resize',
    getStyle: (s) => ({ left: s.x, top: s.y + s.height - EDGE_THICKNESS / 2, width: s.width, height: EDGE_THICKNESS })
  },
  {
    id: 'w',
    cursor: 'ew-resize',
    getStyle: (s) => ({ left: s.x - EDGE_THICKNESS / 2, top: s.y, width: EDGE_THICKNESS, height: s.height })
  }
]

const HANDLE_CONFIGS: Array<{
  id: ResizeHandle
  cursor: string
  getPosition: (s: SelectionRect) => { left: number; top: number }
}> = [
  { id: 'nw', cursor: 'nwse-resize', getPosition: (s) => ({ left: s.x, top: s.y }) },
  { id: 'n', cursor: 'ns-resize', getPosition: (s) => ({ left: s.x + s.width / 2, top: s.y }) },
  { id: 'ne', cursor: 'nesw-resize', getPosition: (s) => ({ left: s.x + s.width, top: s.y }) },
  { id: 'e', cursor: 'ew-resize', getPosition: (s) => ({ left: s.x + s.width, top: s.y + s.height / 2 }) },
  { id: 'se', cursor: 'nwse-resize', getPosition: (s) => ({ left: s.x + s.width, top: s.y + s.height }) },
  { id: 's', cursor: 'ns-resize', getPosition: (s) => ({ left: s.x + s.width / 2, top: s.y + s.height }) },
  { id: 'sw', cursor: 'nesw-resize', getPosition: (s) => ({ left: s.x, top: s.y + s.height }) },
  { id: 'w', cursor: 'ew-resize', getPosition: (s) => ({ left: s.x, top: s.y + s.height / 2 }) }
]

export const SelectionHandles = memo(function SelectionHandles({
  selection,
  dispatch,
  canvasOrigin = { left: 0, top: 0 },
  viewportWidth,
  viewportHeight
}: SelectionHandlesProps) {
  const isDraggingRef = useRef(false)

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent, handle: ResizeHandle) => {
      if (e.button !== 0) return
      // Without this the canvas underneath also starts a background selection and the
      // two dispatches fight over the phase.
      e.stopPropagation()
      // Captured on the event target rather than a stable ref, so moves keep arriving
      // at this same element once the pointer leaves the 12 px dot.
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      isDraggingRef.current = true
      dispatch({
        type: 'POINTER_DOWN_HANDLE',
        x: e.clientX - canvasOrigin.left,
        y: e.clientY - canvasOrigin.top,
        handle
      })
    },
    [dispatch, canvasOrigin]
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!isDraggingRef.current) return
      dispatch({
        type: 'POINTER_MOVE',
        x: e.clientX - canvasOrigin.left,
        y: e.clientY - canvasOrigin.top,
        viewportWidth,
        viewportHeight
      })
    },
    [dispatch, canvasOrigin, viewportWidth, viewportHeight]
  )

  /** Idempotent, exactly as in CaptureCanvas: pointerup and lostpointercapture both fire for one gesture. */
  const finishResize = useCallback(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    dispatch({ type: 'POINTER_UP' })
  }, [dispatch])

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!isDraggingRef.current) return

      if ((e.target as HTMLElement).hasPointerCapture(e.pointerId)) {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      }

      finishResize()
    },
    [finishResize]
  )

  /** System-initiated interruption; without it the rect keeps following the cursor after release. */
  const handlePointerCancel = useCallback(() => {
    finishResize()
  }, [finishResize])

  /** Safety net for capture lost without a pointerup. */
  const handleLostPointerCapture = useCallback(() => {
    finishResize()
  }, [finishResize])

  /**
   * Half of every strip and dot lies inside the selection, so a double-click aimed at a
   * resize would otherwise reach the overlay's confirm handler and capture instead.
   */
  const handleDoubleClick = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation()
  }, [])

  return (
    <>
      {EDGE_CONFIGS.map((config) => (
        <div
          key={config.id}
          className="absolute"
          style={{
            zIndex: Z_INDEX.HANDLE_EDGE,
            ...config.getStyle(selection),
            cursor: config.cursor
          }}
          onPointerDown={(e) => handlePointerDown(e, config.id)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handleLostPointerCapture}
          onDoubleClick={handleDoubleClick}
        />
      ))}
      {HANDLE_CONFIGS.map((config) => {
        const pos = config.getPosition(selection)
        return (
          <div
            key={config.id}
            className="absolute rounded-full"
            style={{
              // Above the edge strips so a corner always wins where the two overlap.
              zIndex: Z_INDEX.HANDLE_CORNER,
              left: pos.left - HANDLE_SIZE / 2,
              top: pos.top - HANDLE_SIZE / 2,
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              cursor: config.cursor,
              backgroundColor: ACCENT_COLOR,
              border: `2.5px solid ${HANDLE_BORDER_COLOR}`
            }}
            onPointerDown={(e) => handlePointerDown(e, config.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handleLostPointerCapture}
            onDoubleClick={handleDoubleClick}
          />
        )
      })}
    </>
  )
})
