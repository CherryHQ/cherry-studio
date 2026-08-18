import type { JobScheduleSnapshot } from '@shared/data/api/schemas/jobs'

/**
 * Delay until an interval schedule's next fire, or `undefined` for cron / once
 * (they carry their own timing).
 *
 * Interval fires land on a fixed wall-clock grid anchored at `createdAt`
 * (`createdAt + k × ms`), so "every 6 hours" means every 6 hours of wall-clock
 * time rather than every 6 hours of process uptime. Without the anchor each
 * re-arm (restart, resume, template edit) restarts the count from "now", and a
 * schedule whose period exceeds the app's typical uptime never fires at all.
 *
 * Pure function — extracted from JobManager so the grid arithmetic can be
 * tested without standing up the service.
 *
 * @param schedule - Schedule row snapshot
 * @param nowMs - Current wall-clock time
 * @returns Delay in `(0, ms]`, so a re-arm never fires instantly and an elapsed
 *   grid point is skipped rather than made up; `undefined` for non-interval
 */
export function intervalFirstDelay(schedule: JobScheduleSnapshot, nowMs: number): number | undefined {
  if (schedule.trigger.kind !== 'interval') return undefined
  return nextIntervalFire(schedule, schedule.trigger.ms, nowMs) - nowMs
}

/**
 * The first grid point strictly after `afterMs` — the single definition of an
 * interval's calendar, shared by arming (`afterMs = now`) and overdue detection
 * (`afterMs = lastRun`), so the two cannot drift apart.
 *
 * @param schedule - Schedule row snapshot; only `createdAt` is read
 * @param ms - Interval length, passed in so callers keep the narrowed trigger
 * @param afterMs - Point to search forward from
 * @returns Timestamp of the next fire, always `> afterMs`
 */
export function nextIntervalFire(schedule: JobScheduleSnapshot, ms: number, afterMs: number): number {
  const elapsed = afterMs - Date.parse(schedule.createdAt)
  // Double modulo keeps the phase positive when createdAt sits in the future
  // (clock moved backwards between creation and arming).
  return afterMs + ms - (((elapsed % ms) + ms) % ms)
}
