import { useEffect, useRef, useState } from 'react'

/**
 * Flat emission interval for markdown renders: render cost is linear at
 * ~1.1ms per 1000 chars (62.5k chars ≈ 68ms), so 250ms keeps a >3x margin
 * over the render itself at any realistic length while the pane still
 * updates 4x per second.
 */
export const MARKDOWN_RENDER_INTERVAL_MS = 250
/** Changes following the previous change within this window are stream frames. */
export const MARKDOWN_RENDER_STREAM_CADENCE_MS = 120

/**
 * Input-side pacing for the translate page's markdown rendering: stream
 * frames emit at MARKDOWN_RENDER_INTERVAL_MS through one trailing timer
 * (latest wins); the empty string and changes after a quiet gap emit
 * immediately. Consumers that must see every update (copy/export/exchange/
 * char count/raw-text path) stay on the raw value.
 */
export function usePacedMarkdownOutput(value: string): string {
  const [paced, setPaced] = useState(value)
  const pendingValueRef = useRef(value)
  const lastEmitAtRef = useRef<number | undefined>(undefined)
  const lastChangeAtRef = useRef<number | undefined>(undefined)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const now = performance.now()
    const previousChangeAt = lastChangeAtRef.current
    lastChangeAtRef.current = now
    pendingValueRef.current = value

    // Immediate: a pane clear must not wait, and a change that did not
    // follow the previous one within cadence is a discrete swap, not a frame.
    const immediate =
      value === '' || previousChangeAt === undefined || now - previousChangeAt > MARKDOWN_RENDER_STREAM_CADENCE_MS

    if (immediate) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      lastEmitAtRef.current = now
      setPaced(value)
      return
    }

    // Stream frame: one trailing timer per interval emitting the latest value.
    if (timerRef.current !== null) return
    const elapsed = lastEmitAtRef.current === undefined ? Infinity : now - lastEmitAtRef.current
    const delay = Math.max(0, MARKDOWN_RENDER_INTERVAL_MS - elapsed)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      lastEmitAtRef.current = performance.now()
      setPaced(pendingValueRef.current)
    }, delay)
  }, [value])

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    []
  )

  return paced
}
