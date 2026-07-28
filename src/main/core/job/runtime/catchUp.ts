import { loggerService } from '@logger'
import type { JobScheduleSnapshot } from '@shared/data/api/schemas/jobs'

import type { JobHandler, JobMissEvent } from '../types'

const logger = loggerService.withContext('JobCatchUp')

/**
 * What the caller (JobManager) should do for this schedule.
 *
 * `shouldEnqueue=false + missEvent=null` means the schedule is fine — no
 * action needed. `shouldEnqueue=false + missEvent != null` means notify the
 * handler that a fire was missed but do not enqueue (skip-missed policy).
 */
export interface CatchUpAction {
  scheduleId: string
  type: string
  shouldEnqueue: boolean
  /** Delay before enqueuing the make-up job. Used by `after-startup`. */
  enqueueDelayMs: number
  missEvent: JobMissEvent | null
}

/**
 * Compute the catch-up action for one schedule given current time and the
 * handler registered for its type. Pure function — JobManager owns the
 * iteration and the actual side-effect dispatch.
 *
 * "Overdue" depends on trigger kind:
 *   - cron: `schedule.nextRun <= now` (Scheduler / JobManager keep this updated)
 *   - interval: `(lastRun ?? createdAt) + ms <= now` — Scheduler does not
 *     compute a nextRun for non-cron triggers, so the catch-up branch falls
 *     back to lastRun + interval. Without this, an interval schedule with
 *     `after-startup` would never enqueue a make-up job.
 *   - once: never overdue here. A `once` trigger that already fired
 *     consumed itself; if it never fired, the SchedulerService timer will.
 *
 * Catch-up policies:
 *   - skip-missed   : do NOT enqueue, but still emit missEvent (observability).
 *   - after-startup : enqueue once after `minutes * 60_000` ms; emit missEvent.
 *
 * `after-idle` is deferred (requires PowerMonitor.getSystemIdleTime API).
 */
export function computeCatchUpAction(schedule: JobScheduleSnapshot, handler: JobHandler, nowMs: number): CatchUpAction {
  const lastRunMs = schedule.lastRun ? Date.parse(schedule.lastRun) : null
  const isOverdue = isScheduleOverdue(schedule, lastRunMs, nowMs)

  if (!isOverdue) {
    return { scheduleId: schedule.id, type: schedule.type, shouldEnqueue: false, enqueueDelayMs: 0, missEvent: null }
  }

  // Always build miss event when overdue + handler defines onMissed.
  // skip-missed still wants the event for observability / breaker logic.
  const missEvent: JobMissEvent | null = handler.onMissed
    ? {
        scheduleId: schedule.id,
        type: schedule.type,
        missedCount: 1,
        lastFireAt: lastRunMs
      }
    : null

  if (schedule.catchUpPolicy.kind === 'skip-missed') {
    logger.debug('Catch-up: skip-missed', { scheduleId: schedule.id, type: schedule.type })
    return { scheduleId: schedule.id, type: schedule.type, shouldEnqueue: false, enqueueDelayMs: 0, missEvent }
  }

  // after-startup
  const delayMs = schedule.catchUpPolicy.minutes * 60_000
  logger.debug('Catch-up: after-startup', { scheduleId: schedule.id, type: schedule.type, delayMs })
  return { scheduleId: schedule.id, type: schedule.type, shouldEnqueue: true, enqueueDelayMs: delayMs, missEvent }
}

/**
 * Per-trigger overdue rule. Separated out so the trigger-kind switch is one
 * place and computeCatchUpAction stays focused on policy.
 */
function isScheduleOverdue(schedule: JobScheduleSnapshot, lastRunMs: number | null, nowMs: number): boolean {
  const trigger = schedule.trigger
  if (trigger.kind === 'cron') {
    const nextRunMs = schedule.nextRun ? Date.parse(schedule.nextRun) : null
    return nextRunMs !== null && nextRunMs <= nowMs
  }
  if (trigger.kind === 'interval') {
    // Anchor: lastRun (if ever fired) else createdAt. Scheduler does not write
    // nextRun for non-cron triggers, so the anchor + ms math is the authority.
    const anchorMs = lastRunMs ?? Date.parse(schedule.createdAt)
    return anchorMs + trigger.ms <= nowMs
  }
  // once: armed in SchedulerService via setTimeout. If it hasn't fired by now,
  // the timer is still pending — not overdue from catch-up's perspective.
  return false
}
