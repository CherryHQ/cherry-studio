/**
 * The recognized text, laid back over the pixels it was read from, so the user can
 * select and copy it.
 *
 * Each line is one absolutely-positioned `<span>` inside a container pinned to the
 * selection. The container is `pointer-events: none` and the spans are `auto`, so
 * clicks between lines still reach the capture canvas for move / resize.
 *
 * Selection deliberately bypasses Chromium's SelectionController: it runs before
 * DOM events are dispatched, and when the cursor sits in a gap between spans it
 * cannot resolve a text position and collapses the selection — a flicker no DOM
 * handler can undo afterwards. Calling `preventDefault()` on `pointerdown`
 * suppresses the compatibility mouse events it needs, and selection is then driven
 * entirely by pointer events plus `caretRangeFromPoint` and `setBaseAndExtent`.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'

import { Z_INDEX } from '../constants'
import type { OcrTextLine } from '../hooks/useOcr'
import type { SelectionRect } from '../types'

interface OcrTextOverlayProps {
  bounds: SelectionRect
  lines: OcrTextLine[]
  scaleFactor: number
  /** False while annotating, so the text layer never intercepts the tools' pointer events. */
  interactive?: boolean
}

/**
 * One line as a span sized to its recognized box.
 *
 * The rendered glyphs almost never measure the same as the recognized run — a UI
 * font stands in for whatever the screenshot used, and CJK and Latin advance
 * differently — so the intrinsic width is measured after layout and corrected with
 * `scaleX`, which is what keeps the selectable text aligned with the pixels.
 */
function OcrLineSpan({
  line,
  scaleFactor,
  interactive
}: {
  line: OcrTextLine
  scaleFactor: number
  interactive: boolean
}) {
  const spanRef = useRef<HTMLSpanElement>(null)

  // The box is in physical pixels relative to the recognized region, and the
  // container already sits at that region's origin.
  const cssX = line.box.x / scaleFactor
  const cssY = line.box.y / scaleFactor
  const targetWidth = line.box.width / scaleFactor
  const lineHeight = line.box.height / scaleFactor

  useLayoutEffect(() => {
    const span = spanRef.current
    if (!span || targetWidth <= 0) return
    // Read before any transform: transforms do not affect layout, so this is the
    // un-scaled intrinsic width of the text as rendered.
    const actualWidth = span.scrollWidth
    if (actualWidth <= 0) return
    // Written straight to the node: a re-render through React would reset
    // `style.transform` and silently drop the correction.
    span.style.transform = `scaleX(${targetWidth / actualWidth})`
  }, [line.text, targetWidth])

  return (
    <span
      ref={spanRef}
      className={`absolute origin-top-left whitespace-nowrap ${interactive ? 'pointer-events-auto cursor-text select-text' : 'pointer-events-none select-none'}`}
      style={{
        left: cssX,
        top: cssY,
        height: lineHeight,
        // Invisible but selectable, the way a PDF text layer works: the capture already
        // shows the words, and a selection highlight still paints over transparent glyphs.
        color: 'transparent',
        // 85 % of the box height leaves room for ascenders and descenders inside it.
        fontSize: lineHeight * 0.85,
        lineHeight: `${lineHeight}px`
      }}>
      {line.text}
    </span>
  )
}

export function OcrTextOverlay({ bounds, lines, scaleFactor, interactive = true }: OcrTextOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!interactive) return
    const container = containerRef.current
    if (!container) return

    let isDragging = false
    let anchor: { node: Node; offset: number } | null = null

    /** Resolve a caret position from viewport coordinates, gaps included. */
    const caretFromPoint = (x: number, y: number): { node: Node; offset: number } | null => {
      const range = document.caretRangeFromPoint(x, y)
      if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
        return { node: range.startContainer, offset: range.startOffset }
      }

      // In a gap: clamp to the nearest span's rect and resolve from there, which is
      // what makes dragging across the space between lines extend the selection.
      let nearestX = 0
      let nearestY = 0
      let minDistSq = Number.POSITIVE_INFINITY

      for (const span of Array.from(container.querySelectorAll<HTMLSpanElement>(':scope > span'))) {
        const rect = span.getBoundingClientRect()
        const cx = Math.max(rect.left, Math.min(rect.right, x))
        const cy = Math.max(rect.top, Math.min(rect.bottom, y))
        const distSq = (cx - x) ** 2 + (cy - y) ** 2
        if (distSq < minDistSq) {
          minDistSq = distSq
          nearestX = cx
          nearestY = cy
        }
      }
      if (minDistSq === Number.POSITIVE_INFINITY) return null

      const clamped = document.caretRangeFromPoint(nearestX, nearestY)
      if (clamped && clamped.startContainer.nodeType === Node.TEXT_NODE) {
        return { node: clamped.startContainer, offset: clamped.startOffset }
      }
      return null
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return

      // Suppresses the compatibility mouse events, which is what keeps
      // SelectionController from running at all.
      e.preventDefault()

      isDragging = true
      container.style.pointerEvents = 'auto'

      const position = caretFromPoint(e.clientX, e.clientY)
      if (position) {
        anchor = position
        window.getSelection()?.setBaseAndExtent(position.node, position.offset, position.node, position.offset)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return

      const position = caretFromPoint(e.clientX, e.clientY)
      if (!position) return

      if (!anchor) anchor = position
      window.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, position.node, position.offset)
    }

    /**
     * Single exit for every way the drag can end.
     *
     * Idempotent through the `isDragging` guard, so a cancel arriving after a
     * pointerup is a no-op. The anchor deliberately survives — the text stays
     * copyable, and an interruption is no reason to discard what was selected.
     */
    const endSelection = () => {
      if (!isDragging) return
      isDragging = false
      container.style.pointerEvents = ''
    }

    // Capture phase: the container is pointer-events:none, but the span that was hit
    // puts it on the propagation path, and capture reaches it before anything else.
    container.addEventListener('pointerdown', onPointerDown, true)
    // Window level, so a drag that leaves the container keeps extending the selection.
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endSelection)
    // Without this a system-interrupted gesture never ends: the layer stays pointer-events:auto and
    // swallows later clicks. No `lostpointercapture` twin — this layer follows the drag on window.
    window.addEventListener('pointercancel', endSelection)

    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endSelection)
      window.removeEventListener('pointercancel', endSelection)
    }
  }, [interactive])

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute overflow-hidden"
      style={{
        zIndex: Z_INDEX.OCR_OVERLAY,
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height
      }}>
      {lines.map((line, index) => (
        <OcrLineSpan key={index} line={line} scaleFactor={scaleFactor} interactive={interactive} />
      ))}
    </div>
  )
}
