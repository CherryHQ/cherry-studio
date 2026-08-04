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
  const [displayValue, setDisplayValue] = useState(nextValue)
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

    const commitValue = (value: TValue) => {
      displayValueRef.current = value
      lastChangeAtRef.current = Date.now()
      setDisplayValue(value)
    }

    const currentValue = displayValueRef.current
    if (getKey(currentValue) === getKey(nextValue)) {
      clearPendingTimer()
      pendingValueRef.current = null
      displayValueRef.current = nextValue
      setDisplayValue(nextValue)
      return clearPendingTimer
    }

    if (!enabled || shouldBypass?.(currentValue, nextValue)) {
      clearPendingTimer()
      pendingValueRef.current = null
      commitValue(nextValue)
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
      commitValue(pendingValue.value)
    }, remainingMs)

    return clearPendingTimer
  }, [enabled, getKey, minimumDurationMs, nextValue, shouldBypass])

  const currentValue = displayValueRef.current
  if (!enabled || shouldBypass?.(currentValue, nextValue) || getKey(currentValue) === getKey(nextValue)) {
    return nextValue
  }

  return displayValue
}
