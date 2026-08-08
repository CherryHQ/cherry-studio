import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type DirectSaveStatus = 'idle' | 'pending' | 'saving' | 'failed'

export interface DirectFieldSave<TPatch> {
  /** Latest queue state — drives the editor's inline save indicator. */
  status: DirectSaveStatus
  /** Buffer one field intent and send it now (behind any in-flight request). */
  commit: (key: string, patch: TPatch) => void
  /** Buffer one field intent and send it once typing settles; later calls re-arm the timer. */
  schedule: (key: string, patch: TPatch) => void
  /** Remove buffered or rejected intents owned by these fields. */
  discard: (...keys: string[]) => void
  /** Send everything buffered right away; resolves when the queue drains. */
  flush: () => Promise<void>
  /** Re-send the field intents whose last attempts failed. */
  retry: () => void
}

/**
 * Per-field save queue for the resource editors.
 *
 * These dialogs are property editors, not submit-style forms: every control
 * persists only the field it owns, so a stale or invalid value elsewhere on the
 * resource can never block an unrelated edit.
 *
 * Writes to one resource are strictly serialized. New writes replace or merge
 * only the failed/pending intent for the same field key; a rejected field never
 * blocks unrelated queued fields.
 *
 * A rejected intent belongs to the current dialog session. Inline retry resends
 * it and discard removes it; reopening remounts the queue from server data.
 */
export function useDirectFieldSave<TPatch extends object>({
  save,
  merge,
  onError,
  delay = 500
}: {
  save: (patch: TPatch) => Promise<unknown>
  /** Combine an older same-field patch with a newer one; `next` wins on conflicts. */
  merge: (base: TPatch, next: TPatch) => TPatch
  onError?: (error: Error) => void
  delay?: number
}): DirectFieldSave<TPatch> {
  const [status, setStatus] = useState<DirectSaveStatus>('idle')

  const saveRef = useRef(save)
  const mergeRef = useRef(merge)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    saveRef.current = save
    mergeRef.current = merge
    onErrorRef.current = onError
  })

  const pendingRef = useRef(new Map<string, TPatch>())
  const failedRef = useRef(new Map<string, TPatch>())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drainingRef = useRef(false)
  const inFlightRef = useRef<Promise<void>>(Promise.resolve())
  const mountedRef = useRef(true)

  // The queue can finish after the dialog closes, so late settlements must not
  // push state into an unmounted tree.
  const publishStatus = useCallback((next: DirectSaveStatus) => {
    if (mountedRef.current) setStatus(next)
  }, [])

  const publishSettledStatus = useCallback(() => {
    if (failedRef.current.size > 0) publishStatus('failed')
    else if (pendingRef.current.size > 0) publishStatus('pending')
    else publishStatus('idle')
  }, [publishStatus])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const drain = useCallback((): Promise<void> => {
    if (drainingRef.current) return inFlightRef.current
    drainingRef.current = true
    inFlightRef.current = (async () => {
      try {
        // An armed timer means the buffered intents are still debouncing. Every
        // non-debounced entry point clears it before asking the queue to drain.
        while (pendingRef.current.size > 0 && timerRef.current === null) {
          const entry = pendingRef.current.entries().next().value
          if (!entry) break

          const [key, patch] = entry
          pendingRef.current.delete(key)
          publishStatus('saving')

          try {
            await saveRef.current(patch)
          } catch (error) {
            // A newer intent for this field supersedes the rejected request. Do
            // not resurrect or report the stale value when its request settles.
            if (!pendingRef.current.has(key)) {
              failedRef.current.set(key, patch)
              onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)))
            }
          }
        }
        publishSettledStatus()
      } finally {
        drainingRef.current = false
      }
    })()
    return inFlightRef.current
  }, [publishSettledStatus, publishStatus])

  const enqueue = useCallback((key: string, patch: TPatch) => {
    const buffered = pendingRef.current.get(key) ?? failedRef.current.get(key)
    const nextPatch = buffered ? mergeRef.current(buffered, patch) : patch

    failedRef.current.delete(key)
    pendingRef.current.set(key, nextPatch)
  }, [])

  const commit = useCallback(
    (key: string, patch: TPatch) => {
      clearTimer()
      enqueue(key, patch)
      void drain()
    },
    [clearTimer, drain, enqueue]
  )

  const schedule = useCallback(
    (key: string, patch: TPatch) => {
      clearTimer()
      enqueue(key, patch)
      publishSettledStatus()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void drain()
      }, delay)
    },
    [clearTimer, delay, drain, enqueue, publishSettledStatus]
  )

  const discard = useCallback(
    (...keys: string[]) => {
      for (const key of keys) {
        pendingRef.current.delete(key)
        failedRef.current.delete(key)
      }

      if (pendingRef.current.size === 0) clearTimer()
      if (!drainingRef.current) publishSettledStatus()
    },
    [clearTimer, publishSettledStatus]
  )

  const flush = useCallback((): Promise<void> => {
    clearTimer()
    return drain()
  }, [clearTimer, drain])

  const retry = useCallback(() => {
    clearTimer()
    for (const [key, failed] of failedRef.current) {
      pendingRef.current.set(key, failed)
    }
    failedRef.current.clear()
    void drain()
  }, [clearTimer, drain])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
      // Best effort: do not silently drop the final debounced edit on an
      // unexpected unmount. Explicit closes already call flush themselves.
      void drain()
    }
  }, [clearTimer, drain])

  // Stable except when the reported status changes, so the field tree built on
  // top of it doesn't re-render on every keystroke.
  return useMemo(
    () => ({ status, commit, schedule, discard, flush, retry }),
    [commit, discard, flush, retry, schedule, status]
  )
}
