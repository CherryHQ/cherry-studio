import dayjs from 'dayjs'
import { useSyncExternalStore } from 'react'

const DAY_CHECK_INTERVAL_MS = 60_000

const getDayStart = () => dayjs().startOf('day').valueOf()

function subscribeToDayCheck(onCheck: () => void) {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') onCheck()
  }
  const intervalId = window.setInterval(onCheck, DAY_CHECK_INTERVAL_MS)
  window.addEventListener('focus', onCheck)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  return () => {
    window.clearInterval(intervalId)
    window.removeEventListener('focus', onCheck)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}

/**
 * Local start-of-day timestamp, for consumers whose output only changes when the calendar day does.
 * Checks are frequent because timers stall across sleep; an unchanged day re-renders nothing.
 */
export function useCurrentDayStart(): number {
  return useSyncExternalStore(subscribeToDayCheck, getDayStart)
}
