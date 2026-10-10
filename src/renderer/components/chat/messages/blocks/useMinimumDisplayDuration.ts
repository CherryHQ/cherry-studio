import { useEffect, useRef, useState } from 'react'

interface MinimumDisplayDurationOptions<TValue> {
  enabled: boolean | undefined
  getKey: (value: TValue) => string
  minimumDurationMs: number
  shouldBypass?: (currentValue: TValue, nextValue: TValue) => boolean
}

export function useMinimumDisplayDuration<TValue>(
  nextValue: TValue,
  { enabled, getKey, minimumDurationMs, shouldBypass }: MinimumDisplayDurationOptions<TValue>
): TValue {
  const [, setRenderVersion] = useState(0)
  const displayValueRef = useRef(nextValue)
  const lastChangeAtRef = useRef(Date.now())
  const pendingValueRef = useRef<{ value: TValue } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const clearPendingTimer = () => {
      if (!timerRef.current) return
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const syncValue = (value: TValue) => {
      displayValueRef.current = value
      lastChangeAtRef.current = Date.now()
    }

    const currentValue = displayValueRef.current
    if (getKey(currentValue) === getKey(nextValue)) {
      clearPendingTimer()
      pendingValueRef.current = null
      displayValueRef.current = nextValue
      return clearPendingTimer
    }

    if (!enabled || shouldBypass?.(currentValue, nextValue)) {
      clearPendingTimer()
      pendingValueRef.current = null
      syncValue(nextValue)
      return clearPendingTimer
    }

    pendingValueRef.current = { value: nextValue }
    const elapsedMs = Date.now() - lastChangeAtRef.current
    const remainingMs = Math.max(0, minimumDurationMs - elapsedMs)

    clearPendingTimer()
    timerRef.current = setTimeout(() => {
      const pendingValue = pendingValueRef.current
      if (!pendingValue) return
      pendingValueRef.current = null
      timerRef.current = null
      syncValue(pendingValue.value)
      setRenderVersion((version) => version + 1)
    }, remainingMs)

    return clearPendingTimer
  }, [enabled, getKey, minimumDurationMs, nextValue, shouldBypass])

  const currentValue = displayValueRef.current
  if (!enabled || shouldBypass?.(currentValue, nextValue) || getKey(currentValue) === getKey(nextValue)) {
    return nextValue
  }

  return displayValueRef.current
}
