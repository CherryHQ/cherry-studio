/**
 * Lifecycle of the floating text-annotation editor: where it sits, when it is
 * remounted, and when the annotation layer has to be wiped because the selection
 * the annotations were drawn on is gone.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { OverlayPhase, Point, SelectionRect } from '../types'
import type { useAnnotation } from './useAnnotation'

export function useTextInput(
  annotation: ReturnType<typeof useAnnotation>,
  selection: SelectionRect | null,
  phase: OverlayPhase
) {
  const { commitDrawing, resetAnnotations, state: annotationState } = annotation
  const [textInputPosition, setTextInputPosition] = useState<Point | null>(null)
  /** Monotonic remount key, see {@link handleTextRequest}. */
  const [textInputKey, setTextInputKey] = useState(0)
  /** Imperative commit handle published by the editor while it is mounted. */
  const textFlushRef = useRef<(() => void) | null>(null)

  const handleTextRequest = useCallback((position: Point) => {
    // Commit whatever the open editor holds first, or clicking a second spot discards it.
    textFlushRef.current?.()
    setTextInputPosition(position)
    // A new key forces a real unmount / mount: React batches position A → B into one update, so the
    // editor would be reused with its "already committed" guard set and its old safe value intact.
    setTextInputKey((k) => k + 1)
  }, [])

  const handleTextConfirm = useCallback(
    (text: string) => {
      if (textInputPosition && selection) {
        commitDrawing({
          type: 'text',
          color: annotationState.color,
          fontSize: annotationState.fontSize,
          position: textInputPosition,
          content: text,
          // Captured now, not recomputed later: this is what the editor wrapped against,
          // so the canvas render must wrap identically even if the selection moves after.
          maxWidth: selection.x + selection.width - textInputPosition.x
        })
      }
      setTextInputPosition(null)
    },
    [textInputPosition, selection, commitDrawing, annotationState.color, annotationState.fontSize]
  )

  const handleTextCancel = useCallback(() => {
    setTextInputPosition(null)
  }, [])

  const prevPhaseRef = useRef(phase)
  const prevSelectionRef = useRef(selection)
  // Annotations are stored in image-absolute coordinates, so keeping them across a re-selection
  // would re-render them over an unrelated region and composite them into the export.
  useEffect(() => {
    const reselecting = prevPhaseRef.current === 'selected' && phase === 'selecting'
    const selectionCleared = prevSelectionRef.current !== null && !selection

    if (reselecting || selectionCleared) {
      resetAnnotations()
      setTextInputPosition(null)
    }

    prevPhaseRef.current = phase
    prevSelectionRef.current = selection
  }, [phase, selection, resetAnnotations])

  return {
    textInputPosition,
    textInputKey,
    textFlushRef,
    handleTextRequest,
    handleTextConfirm,
    handleTextCancel
  }
}
