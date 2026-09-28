/**
 * Wall-clock grid for repeating intervals: fires at `anchorMs + k × periodMs`.
 * Shared by SchedulerService re-arms and JobManager overdue / arming logic.
 */
export function nextIntervalFireAt(anchorMs: number, periodMs: number, afterMs: number): number {
  const elapsed = afterMs - anchorMs
  return afterMs + periodMs - (((elapsed % periodMs) + periodMs) % periodMs)
}
