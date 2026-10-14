import { useCallback, useEffect, useRef, useState } from 'react'

export interface ImageCaptureTarget<TTarget> {
  requestId: number
  target: TTarget
}

interface ImageCaptureRequest {
  id: number
  promise: Promise<void>
}

interface UseImageCaptureTargetsOptions {
  cancelMessage: string
  delayMs: number
  rejectPendingActions: (targetId: string | undefined, reason: unknown) => void
}

export function useImageCaptureTargets<TTarget>({
  cancelMessage,
  delayMs,
  rejectPendingActions
}: UseImageCaptureTargetsOptions) {
  const [targets, setTargets] = useState<ImageCaptureTarget<TTarget>[]>([])
  const mountedRef = useRef(true)
  const startTimersRef = useRef<Set<number>>(new Set())

  const queueTarget = useCallback(
    (request: ImageCaptureRequest, target: TTarget) => {
      const startTimerId = window.setTimeout(() => {
        startTimersRef.current.delete(startTimerId)
        if (!mountedRef.current) return
        setTargets((current) => [...current, { requestId: request.id, target }])
      }, delayMs)

      startTimersRef.current.add(startTimerId)
      void request.promise
        .finally(() => {
          window.clearTimeout(startTimerId)
          startTimersRef.current.delete(startTimerId)
          if (!mountedRef.current) return
          setTargets((current) => current.filter((candidate) => candidate.requestId !== request.id))
        })
        .catch(() => undefined)
    },
    [delayMs]
  )

  useEffect(() => {
    mountedRef.current = true
    const startTimers = startTimersRef.current

    return () => {
      mountedRef.current = false
      for (const timerId of startTimers) {
        window.clearTimeout(timerId)
      }
      startTimers.clear()
      rejectPendingActions(undefined, new Error(cancelMessage))
    }
  }, [cancelMessage, rejectPendingActions])

  return { queueTarget, targets }
}
