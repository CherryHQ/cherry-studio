/**
 * Drives text recognition for the settled selection.
 *
 * A selection change debounces 200 ms and then asks the main process to OCR that
 * region of the frozen capture; a generation counter drops results whose selection
 * has already moved on. Recognition runs through the main process; the hook holds
 * only coordinates and text.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { OcrTextLine } from '@shared/ipc/schemas/screenshot'

import type { SelectionRect } from '../types'

const logger = loggerService.withContext('useOcr')

/** Minimum selection size (CSS px) to trigger OCR. Without it every drag starts
 *  with a doomed full recognition of the first few pixels. */
const MIN_SIZE = 30
const DEBOUNCE_MS = 200

/**
 * Where a recognition stands.
 *
 * `pending` is the entry point when auto OCR is off — collapsing it into `idle`
 * would leave those users no manual trigger at all. `unavailable` is separate
 * from `idle` for the same reason in reverse: "the model is missing" and "this
 * region has no text" must not look identical.
 */
export type OcrStatus = 'idle' | 'pending' | 'recognizing' | 'done' | 'error' | 'unavailable'

export interface OcrState {
  status: OcrStatus
  lines: OcrTextLine[]
  /** Only set alongside `status: 'error'`. */
  errorMessage?: string
}

const INITIAL_STATE: OcrState = { status: 'idle', lines: [] }

/**
 * @param mediaId - Identifies this overlay's frozen capture to the main process.
 * @param bounds - The settled selection in CSS px, or null when there is nothing to recognize.
 * @param available - Whether a screenshot OCR engine was available when the session started.
 * @param autoStart - Recognize as soon as the selection settles, rather than on request.
 */
export function useOcr(
  mediaId: string | null,
  bounds: SelectionRect | null,
  scaleFactor: number,
  available: boolean,
  autoStart: boolean
): OcrState & { triggerOcr: () => void; copyText: () => void; resetOcr: () => void } {
  const [state, setState] = useState<OcrState>(INITIAL_STATE)
  const generationRef = useRef(0)
  const autoStartRef = useRef(autoStart)
  autoStartRef.current = autoStart
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds

  const runOcr = useCallback(
    async (currentBounds: SelectionRect, generation: number) => {
      if (!mediaId) return

      // Physical pixels and integral: the capture is stored at device resolution and
      // the main-process crop rejects a fractional rect.
      const region = {
        x: Math.round(currentBounds.x * scaleFactor),
        y: Math.round(currentBounds.y * scaleFactor),
        width: Math.round(currentBounds.width * scaleFactor),
        height: Math.round(currentBounds.height * scaleFactor)
      }

      try {
        const result = await ipcApi.request('screenshot.recognize_text', { mediaId, region })
        if (generationRef.current !== generation) return

        // Superseded or expired, not failed — flashing an error here would be a lie.
        if (result.status === 'rejected') return
        if (result.status === 'unavailable') {
          setState({ status: 'unavailable', lines: [] })
          return
        }
        setState({ status: 'done', lines: result.lines })
      } catch (error) {
        if (generationRef.current !== generation) return
        logger.error('Text recognition failed', error as Error)
        // Spread rather than replace: only the failure fields change, so a text layer
        // already on screen is never blanked by the error.
        setState((prev) => ({ ...prev, status: 'error', errorMessage: (error as Error).message }))
      }
    },
    [mediaId, scaleFactor]
  )

  useEffect(() => {
    // Anything below MIN_SIZE is treated as "no selection yet": the user is still
    // starting a drag, not asking for the first few pixels to be recognized.
    if (!bounds || bounds.width < MIN_SIZE || bounds.height < MIN_SIZE) {
      generationRef.current++
      setState(INITIAL_STATE)
      return
    }

    const generation = ++generationRef.current

    // Nothing to ask for, but the affordance must still say why — silently sitting
    // in `idle` would read as "this region has no text".
    if (!available) {
      setState({ status: 'unavailable', lines: [] })
      return
    }

    if (!autoStartRef.current) {
      setState({ status: 'pending', lines: [] })
      return
    }

    setState({ status: 'recognizing', lines: [] })
    const timer = setTimeout(() => {
      if (generationRef.current !== generation) return
      void runOcr(bounds, generation)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [bounds, available, runOcr])

  const triggerOcr = useCallback(() => {
    const currentBounds = boundsRef.current
    if (!currentBounds || currentBounds.width < MIN_SIZE || currentBounds.height < MIN_SIZE) return
    const generation = ++generationRef.current
    setState({ status: 'recognizing', lines: [] })
    void runOcr(currentBounds, generation)
  }, [runOcr])

  /** The toolbar's copy action: every recognized line, newline-joined. */
  const lines = state.lines
  const copyText = useCallback(() => {
    if (lines.length === 0) return
    void navigator.clipboard.writeText(lines.map((line) => line.text).join('\n'))
  }, [lines])

  /** Per-session reset for the pooled overlay, which never unmounts. */
  const resetOcr = useCallback(() => {
    // Incremented, never reset to 0: an uncancellable recognition always returns eventually, and a
    // counter restarting at 0 would collide with it and paint the old capture's text onto the new one.
    generationRef.current++
    setState(INITIAL_STATE)
  }, [])

  return { ...state, triggerOcr, copyText, resetOcr }
}
