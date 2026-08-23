import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Debounce window before a settled query is submitted to the search backend.
 * Local SQLite FTS answers in a few milliseconds, so this only needs to
 * collapse keystroke bursts — long enough to skip intermediates, short enough
 * to keep results feeling instant.
 */
export const GLOBAL_SEARCH_QUERY_DEBOUNCE_MS = 200

/**
 * Returns a debounced copy of `value` that is safe for search-as-you-type:
 *
 * - A trailing debounce collapses keystroke bursts into one committed value.
 * - While an IME composition is active (Chinese/Japanese/Korean input), the
 *   committed value is frozen so romanization intermediates ("nihao" while
 *   typing 你好) never reach the search backend; confirming candidates via
 *   `compositionend` flushes the final text immediately, with no extra wait.
 * - Clearing the input (`''`) commits synchronously so stale results reset
 *   without waiting one debounce window.
 *
 * The raw `value` must keep updating on every keystroke (controlled input);
 * only the returned committed copy is gated. Attach `compositionHandlers` to
 * the input element rendering `value`.
 */
export function useImeAwareDebouncedValue(
  value: string,
  delayMs: number = GLOBAL_SEARCH_QUERY_DEBOUNCE_MS
): {
  committedValue: string
  compositionHandlers: {
    onCompositionStart: () => void
    onCompositionEnd: () => void
  }
} {
  const [committedValue, setCommittedValue] = useState(value)
  const isComposingRef = useRef(false)
  // Latest value as seen by effects; read by onCompositionEnd because some
  // engines emit `compositionend` before the final change event.
  const latestValueRef = useRef(value)

  useEffect(() => {
    latestValueRef.current = value

    if (value === '') {
      setCommittedValue('')
      return
    }

    if (isComposingRef.current) return

    const timer = setTimeout(() => setCommittedValue(value), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs, value])

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true
  }, [])

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false
    setCommittedValue(latestValueRef.current)
  }, [])

  return {
    committedValue,
    compositionHandlers: {
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd
    }
  }
}
