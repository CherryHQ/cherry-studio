/** Node timers above this limit fire after 1ms instead of waiting. */
const MAX_TIMER_MS = 2_147_483_647
const DEFAULT_IDLE_TTL_MINUTES = 5

/** Zero means immediate recycling; malformed preferences keep the historical five-minute default. */
export function resolveAgentIdleTtlMs(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) return DEFAULT_IDLE_TTL_MINUTES * 60_000
  return Math.min(minutes * 60_000, MAX_TIMER_MS)
}
