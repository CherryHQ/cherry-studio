/**
 * Annotation state for the overlay.
 *
 * `annotations` doubles as the undo stack — undo pops it, redo restores. The three
 * style values are persisted user preferences and deliberately outlive a capture
 * session; everything else is transient and cleared by {@link resetAnnotations}.
 */

import { useCallback, useMemo, useState } from 'react'

import { usePersistCache } from '@data/hooks/useCache'

import type { Annotation, AnnotationTool } from '../types'

export interface AnnotationState {
  /** Active tool, or null when no annotation mode is engaged. */
  activeTool: AnnotationTool | null
  /** Committed annotations, oldest first. Also the undo stack. */
  annotations: Annotation[]
  /** Undone annotations, cleared as soon as something new is drawn. */
  redoStack: Annotation[]
  /** In-progress annotation, rendered as a live preview. */
  activeDrawing: Annotation | null
  color: string
  strokeWidth: number
  fontSize: number
}

/** The part of the state a capture session owns; the styles live in persist cache instead. */
interface TransientAnnotationState {
  activeTool: AnnotationTool | null
  annotations: Annotation[]
  redoStack: Annotation[]
  activeDrawing: Annotation | null
}

const INITIAL_TRANSIENT_STATE: TransientAnnotationState = {
  activeTool: null,
  annotations: [],
  redoStack: [],
  activeDrawing: null
}

export function useAnnotation() {
  const [transient, setTransient] = useState<TransientAnnotationState>(INITIAL_TRANSIENT_STATE)
  // No `?? DEFAULT_x` here: the cache schema owns these defaults, and a second
  // fallback would be a second source of truth to drift from.
  const [color, setColor] = usePersistCache('ui.screenshot.annotation_color')
  const [strokeWidth, setStrokeWidth] = usePersistCache('ui.screenshot.annotation_stroke_width')
  const [fontSize, setFontSize] = usePersistCache('ui.screenshot.annotation_font_size')

  const state = useMemo<AnnotationState>(
    () => ({ ...transient, color, strokeWidth, fontSize }),
    [transient, color, strokeWidth, fontSize]
  )

  /** Clicking the active tool turns it off again. */
  const toggleTool = useCallback((tool: AnnotationTool | null) => {
    setTransient((prev) => ({
      ...prev,
      activeTool: prev.activeTool === tool ? null : tool,
      activeDrawing: null
    }))
  }, [])

  const setActiveDrawing = useCallback((activeDrawing: Annotation | null) => {
    setTransient((prev) => ({ ...prev, activeDrawing }))
  }, [])

  const commitDrawing = useCallback((annotation: Annotation) => {
    setTransient((prev) => ({
      ...prev,
      annotations: [...prev.annotations, annotation],
      redoStack: [],
      activeDrawing: null
    }))
  }, [])

  const undo = useCallback(() => {
    setTransient((prev) => {
      if (prev.annotations.length === 0) return prev
      return {
        ...prev,
        annotations: prev.annotations.slice(0, -1),
        redoStack: [...prev.redoStack, prev.annotations[prev.annotations.length - 1]],
        activeDrawing: null
      }
    })
  }, [])

  const redo = useCallback(() => {
    setTransient((prev) => {
      if (prev.redoStack.length === 0) return prev
      return {
        ...prev,
        annotations: [...prev.annotations, prev.redoStack[prev.redoStack.length - 1]],
        redoStack: prev.redoStack.slice(0, -1),
        activeDrawing: null
      }
    })
  }, [])

  /**
   * Drop tool, shapes and history. Stable identity by construction — three effects
   * in the overlay list it as a dependency and re-run if it changes.
   */
  const resetAnnotations = useCallback(() => {
    setTransient(INITIAL_TRANSIENT_STATE)
  }, [])

  return {
    state,
    toggleTool,
    setActiveDrawing,
    commitDrawing,
    undo,
    redo,
    setColor,
    setStrokeWidth,
    setFontSize,
    resetAnnotations
  }
}
