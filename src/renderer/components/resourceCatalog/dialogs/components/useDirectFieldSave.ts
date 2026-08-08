import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type DirectSaveStatus = 'idle' | 'pending' | 'saving' | 'failed'

export interface DirectFieldSave<TPatch> {
  /** Latest queue state — drives the editor's inline save indicator. */
  status: DirectSaveStatus
  /** Buffer `patch` and send it now (behind any in-flight request). */
  commit: (patch: TPatch) => void
  /** Buffer `patch` and send it once typing settles; later calls re-arm the timer. */
  schedule: (patch: TPatch) => void
  /** Send everything buffered right away; resolves when the queue drains. */
  flush: () => Promise<void>
  /** Re-send the buffered patch whose last attempt failed. */
  retry: () => void
}

/**
 * Per-field save queue for the resource editors.
 *
 * These dialogs are property editors, not submit-style forms: every control
 * persists only the field it owns, so a stale or invalid value elsewhere on the
 * resource can never block an unrelated edit.
 *
 * Writes to one resource are strictly serialized, and patches that pile up while
 * a request is in flight are merged (via `merge`) into a single follow-up — so
 * an older response can never overwrite a newer value.
 *
 * A rejected patch stays buffered instead of being dropped: the next edit to the
 * same field replaces it, and {@link DirectFieldSave.retry} re-sends it. Failure
 * is surfaced through `onError` and `status` only; it never blocks the dialog.
 */
export function useDirectFieldSave<TPatch extends object>({
  save,
  merge,
  onError,
  delay = 500
}: {
  save: (patch: TPatch) => Promise<unknown>
  /** Combine a buffered patch with a newer one; `next` wins on conflicts. */
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

  const pendingRef = useRef<TPatch | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drainingRef = useRef(false)
  const inFlightRef = useRef<Promise<void>>(Promise.resolve())
  const mountedRef = useRef(true)

  useEffect(
    () => () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  // The queue outlives the dialog (a close flushes and returns immediately), so
  // late settlements must not push state into an unmounted tree.
  const publishStatus = useCallback((next: DirectSaveStatus) => {
    if (mountedRef.current) setStatus(next)
  }, [])

  const drain = useCallback((): Promise<void> => {
    if (drainingRef.current) return inFlightRef.current
    drainingRef.current = true
    inFlightRef.current = (async () => {
      try {
        while (pendingRef.current) {
          const patch = pendingRef.current
          pendingRef.current = null
          publishStatus('saving')
          try {
            await saveRef.current(patch)
          } catch (error) {
            // Keep the rejected patch buffered so an explicit retry — or the
            // user's next edit, which merges on top — can resend it.
            pendingRef.current = pendingRef.current ? mergeRef.current(patch, pendingRef.current) : patch
            publishStatus('failed')
            onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)))
            return
          }
        }
        publishStatus('idle')
      } finally {
        drainingRef.current = false
      }
    })()
    return inFlightRef.current
  }, [publishStatus])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const enqueue = useCallback((patch: TPatch) => {
    pendingRef.current = pendingRef.current ? mergeRef.current(pendingRef.current, patch) : patch
  }, [])

  const commit = useCallback(
    (patch: TPatch) => {
      clearTimer()
      enqueue(patch)
      void drain()
    },
    [clearTimer, drain, enqueue]
  )

  const schedule = useCallback(
    (patch: TPatch) => {
      clearTimer()
      enqueue(patch)
      publishStatus('pending')
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void drain()
      }, delay)
    },
    [clearTimer, delay, drain, enqueue, publishStatus]
  )

  const flush = useCallback((): Promise<void> => {
    clearTimer()
    return drain()
  }, [clearTimer, drain])

  const retry = useCallback(() => {
    clearTimer()
    void drain()
  }, [clearTimer, drain])

  // Stable except when the reported status changes, so the field tree built on
  // top of it doesn't re-render on every keystroke.
  return useMemo(() => ({ status, commit, schedule, flush, retry }), [commit, flush, retry, schedule, status])
}
