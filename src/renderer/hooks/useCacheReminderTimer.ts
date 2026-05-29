import { useCallback, useEffect, useRef, useState } from 'react'

export type CacheReminderState = 'inactive' | 'active' | 'warning' | 'critical'

const WARNING_THRESHOLD_MS = 4 * 60 * 1000 + 30 * 1000
const CRITICAL_THRESHOLD_MS = 5 * 60 * 1000

const cacheStateMap = new Map<string, CacheReminderState>()

export const getTopicCacheState = (topicId: string): CacheReminderState => {
  return cacheStateMap.get(topicId) ?? 'inactive'
}

export interface CacheReminderTimerResult {
  state: CacheReminderState
  elapsedMs: number
  lastInteractionAt: number | null
  startInteraction: () => void
  stopInteraction: () => void
  resetInteraction: () => void
}

export const useCacheReminderTimer = (topicId: string, enabled: boolean): CacheReminderTimerResult => {
  const [state, setState] = useState<CacheReminderState>('inactive')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [lastInteractionAt, setLastInteractionAt] = useState<number | null>(null)

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastAtRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const updateState = useCallback(
    (newState: CacheReminderState) => {
      setState(newState)
      cacheStateMap.set(topicId, newState)
    },
    [topicId]
  )

  const stopInteraction = useCallback(() => {
    clearTimer()
    updateState('inactive')
    setElapsedMs(0)
    lastAtRef.current = null
  }, [clearTimer, updateState])

  const resetInteraction = useCallback(() => {
    clearTimer()
    lastAtRef.current = null
    setLastInteractionAt(null)
    updateState('inactive')
    setElapsedMs(0)
  }, [clearTimer, updateState])

  const startInteraction = useCallback(() => {
    const now = Date.now()
    lastAtRef.current = now
    setLastInteractionAt(now)
    updateState('active')
    setElapsedMs(0)

    clearTimer()
    intervalRef.current = setInterval(() => {
      if (!lastAtRef.current) return
      const elapsed = Date.now() - lastAtRef.current
      setElapsedMs(elapsed)

      if (elapsed >= CRITICAL_THRESHOLD_MS) {
        updateState('critical')
      } else if (elapsed >= WARNING_THRESHOLD_MS) {
        updateState('warning')
      } else {
        updateState('active')
      }
    }, 1000)
  }, [clearTimer, updateState])

  useEffect(() => {
    if (!enabled) {
      stopInteraction()
    }
  }, [enabled, topicId, stopInteraction])

  useEffect(() => {
    return () => {
      clearTimer()
      cacheStateMap.delete(topicId)
    }
  }, [clearTimer, topicId])

  return {
    state,
    elapsedMs,
    lastInteractionAt,
    startInteraction,
    stopInteraction,
    resetInteraction
  }
}
