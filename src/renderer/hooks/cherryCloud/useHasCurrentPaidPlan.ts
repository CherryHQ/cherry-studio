import { useEffect, useReducer } from 'react'

import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'

// setTimeout overflows above this delay and would fire immediately.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

/** Whether fresh plans show an active paid entitlement that has not reached its recorded expiry. */
export function useHasCurrentPaidPlan(enabled = true): boolean {
  const { activePaid, isPlansReady } = useCherryCloudPlans(enabled)
  const expiresAt = activePaid?.expires_at ? Date.parse(activePaid.expires_at) : undefined
  const [tick, recheck] = useReducer((count: number) => count + 1, 0)

  const current = enabled && isPlansReady && !!activePaid && (expiresAt === undefined || expiresAt > Date.now())

  useEffect(() => {
    if (expiresAt === undefined) return
    const delay = expiresAt - Date.now()
    // The deadline can pass between render and this effect; re-render once so the result catches up.
    if (delay <= 0) {
      if (current) recheck()
      return
    }
    const timer = setTimeout(recheck, Math.min(delay, MAX_TIMER_DELAY_MS))
    return () => clearTimeout(timer)
  }, [current, expiresAt, tick])

  return current
}
