/**
 * Drawing surface laid exactly over the selection.
 *
 * Renders every committed annotation plus the in-progress one each frame, and owns
 * the pointer flow while an annotation tool is active.
 */

import type { PointerEvent as ReactPointerEvent, Ref } from 'react'
import { memo, useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react'

import { Z_INDEX } from '../constants'
import type { Annotation, AnnotationTool, Point, SelectionRect } from '../types'
import { buildAnnotation, isSignificantAnnotation } from '../utils/annotation'
import { drawAnnotation } from '../utils/drawAnnotation'
import { getSelectionImageData, renderMosaicAbsolute } from '../utils/mosaic'

/** The overlay covers the whole display, so viewport coordinates already are image-absolute. */
function pointerToAbsolute(e: ReactPointerEvent): Point {
  return { x: e.clientX, y: e.clientY }
}

interface AnnotationCanvasProps {
  /** The capture, needed to read original pixels for mosaic. */
  image: HTMLImageElement
  selection: SelectionRect
  scaleFactor: number
  /** Null means render-only. */
  activeTool: AnnotationTool | null
  annotations: Annotation[]
  activeDrawing: Annotation | null
  color: string
  strokeWidth: number
  /** False = render-only; events pass through to the selection underneath. */
  interactive: boolean
  onActiveDrawingChange: (annotation: Annotation | null) => void
  onCommit: (annotation: Annotation) => void
  onTextRequest: (position: Point) => void
  /** Published to the parent, which composites this layer into the exported PNG. */
  ref?: Ref<HTMLCanvasElement | null>
}

export const AnnotationCanvas = memo(function AnnotationCanvas({
  image,
  selection,
  scaleFactor,
  activeTool,
  annotations,
  activeDrawing,
  color,
  strokeWidth,
  interactive,
  onActiveDrawingChange,
  onCommit,
  onTextRequest,
  ref
}: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Both sides need the element: this component to draw, the parent to composite it
  // into the export. Without the handoff the export silently loses every annotation.
  useImperativeHandle<HTMLCanvasElement | null, HTMLCanvasElement | null>(ref, () => canvasRef.current, [])
  const drawingRef = useRef<{ tool: AnnotationTool; startPoint: Point; points: Point[] } | null>(null)
  /** Readback of the frozen pixels under the selection, reused across draw frames. */
  const mosaicSourceRef = useRef<{ key: string; image: HTMLImageElement; data: ImageData } | null>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = Math.round(selection.width * scaleFactor)
    canvas.height = Math.round(selection.height * scaleFactor)
  }, [selection.width, selection.height, scaleFactor])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(scaleFactor, 0, 0, scaleFactor, 0, 0)
    ctx.clearRect(0, 0, selection.width, selection.height)

    // Cached, not merely gated: `hasMosaic` stays true for the rest of the session once one
    // mosaic is committed, so without this every frame of every other tool would allocate an
    // offscreen canvas and read the whole selection back — tens of MB per pointermove.
    // The capture's pixels are frozen, so only a new selection or image can invalidate it.
    let imageData: ImageData | null = null
    const hasMosaic = annotations.some((a) => a.type === 'mosaic') || activeDrawing?.type === 'mosaic'
    if (hasMosaic) {
      const key = `${selection.x},${selection.y},${selection.width},${selection.height},${scaleFactor}`
      const cached = mosaicSourceRef.current
      if (cached && cached.key === key && cached.image === image) {
        imageData = cached.data
      } else {
        imageData = getSelectionImageData(image, selection, scaleFactor)
        mosaicSourceRef.current = imageData ? { key, image, data: imageData } : null
      }
    }

    // Annotations are stored image-absolute; this maps them into canvas-local space.
    // Mosaic needs selection-local coordinates for its pixel lookup, so it undoes this.
    ctx.translate(-selection.x, -selection.y)

    for (const annotation of annotations) {
      if (annotation.type === 'mosaic' && imageData) {
        renderMosaicAbsolute(ctx, annotation, imageData, selection, scaleFactor)
      } else {
        drawAnnotation(ctx, annotation)
      }
    }

    if (activeDrawing) {
      if (activeDrawing.type === 'mosaic' && imageData) {
        renderMosaicAbsolute(ctx, activeDrawing, imageData, selection, scaleFactor)
      } else {
        drawAnnotation(ctx, activeDrawing)
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }, [annotations, activeDrawing, selection, scaleFactor, image])

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0 || !activeTool) return
      // Or the capture canvas underneath starts a move / new selection mid-stroke.
      e.stopPropagation()
      const point = pointerToAbsolute(e)

      // Text is entered in a floating editor, so no capture and no drag state here.
      if (activeTool === 'text') {
        onTextRequest(point)
        return
      }

      canvasRef.current?.setPointerCapture(e.pointerId)
      drawingRef.current = { tool: activeTool, startPoint: point, points: [point] }
    },
    [activeTool, onTextRequest]
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const drawing = drawingRef.current
      if (!drawing) return
      const point = pointerToAbsolute(e)
      drawing.points.push(point)

      const preview = buildAnnotation(drawing.tool, drawing.startPoint, point, drawing.points, color, strokeWidth)
      if (preview) {
        onActiveDrawingChange(preview)
      }
    },
    [color, strokeWidth, onActiveDrawingChange]
  )

  /**
   * Single exit for every way a stroke can end.
   *
   * Idempotent: reads and clears `drawingRef` in one pass, so the second of
   * pointerup / pointercancel / lostpointercapture cannot commit the same stroke twice.
   * The `else` branch matters too — dropping it leaves a too-small gesture's live
   * preview on screen forever, and in the export.
   */
  const finishDrawing = useCallback(
    (finalPoint?: Point) => {
      const drawing = drawingRef.current
      if (!drawing) return
      drawingRef.current = null

      const endPoint = finalPoint ?? drawing.points[drawing.points.length - 1]
      const annotation = buildAnnotation(drawing.tool, drawing.startPoint, endPoint, drawing.points, color, strokeWidth)
      if (annotation) {
        if (isSignificantAnnotation(annotation)) {
          onCommit(annotation)
        } else {
          onActiveDrawingChange(null)
        }
      }
    },
    [color, strokeWidth, onCommit, onActiveDrawingChange]
  )

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent) => {
      if (!drawingRef.current) return

      if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
        canvasRef.current.releasePointerCapture(e.pointerId)
      }

      // The only path with a meaningful final point.
      finishDrawing(pointerToAbsolute(e))
    },
    [finishDrawing]
  )

  /** System-initiated interruption. No final point: a cancel event's coordinates are not meaningful. */
  const handlePointerCancel = useCallback(() => {
    finishDrawing()
  }, [finishDrawing])

  /** Safety net for capture lost without a pointerup. */
  const handleLostPointerCapture = useCallback(() => {
    finishDrawing()
  }, [finishDrawing])

  const cursor = interactive ? (activeTool === 'text' ? 'text' : 'crosshair') : undefined

  return (
    <canvas
      ref={canvasRef}
      className="absolute"
      style={{
        zIndex: Z_INDEX.ANNOTATION_CANVAS,
        left: selection.x,
        top: selection.y,
        width: selection.width,
        height: selection.height,
        cursor,
        // This canvas covers the whole selection; left interactive after the tool is
        // deselected it would block move and resize entirely.
        pointerEvents: interactive ? 'auto' : 'none'
      }}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? handlePointerUp : undefined}
      onPointerCancel={interactive ? handlePointerCancel : undefined}
      onLostPointerCapture={interactive ? handleLostPointerCapture : undefined}
    />
  )
})
