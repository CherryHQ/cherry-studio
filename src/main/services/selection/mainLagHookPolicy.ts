/**
 * Windows-only policy: pause/resume selection OS hooks from measured main-thread lag.
 * Prevents WH_*_LL work from staying installed while Electron main cannot drain TSFN callbacks.
 */

export type MainLagHookAction = 'pause' | 'resume' | 'none'

/** Main-thread setImmediate delay that triggers an OS-hook pause (ms). */
export const MAIN_LAG_HOOK_PAUSE_MS = 50

/** Main-thread setImmediate delay at-or-below which paused hooks may resume (ms). */
export const MAIN_LAG_HOOK_RESUME_MS = 16

/** How often to sample main-thread lag while selection is active (ms). */
export const MAIN_LAG_HOOK_SAMPLE_INTERVAL_MS = 100

export function decideMainLagHookAction(input: {
  paused: boolean
  lagMs: number
  pauseThresholdMs?: number
  resumeThresholdMs?: number
}): MainLagHookAction {
  const pauseThresholdMs = input.pauseThresholdMs ?? MAIN_LAG_HOOK_PAUSE_MS
  const resumeThresholdMs = input.resumeThresholdMs ?? MAIN_LAG_HOOK_RESUME_MS

  if (!input.paused && input.lagMs >= pauseThresholdMs) {
    return 'pause'
  }
  if (input.paused && input.lagMs <= resumeThresholdMs) {
    return 'resume'
  }
  return 'none'
}
