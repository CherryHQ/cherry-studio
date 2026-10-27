import type { JobRow } from '@data/db/schemas/job'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import type { JobError } from '@shared/data/api/schemas/jobs'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'

import type { JobHandler, RecoveryStrategy } from '../types'

const logger = loggerService.withContext('JobRecovery')

export interface RecoveryStats {
  cancelled: number
  pendingReset: number
  delayedKept: number
  singletonKept: number
}

const cancelledByRecovery: JobError = {
  code: JOB_ERROR_CODES.CANCELLED,
  message: 'Cancelled by startup recovery',
  retryable: false
}

/** A job's startup recovery strategy: its own override, else its handler's. */
function strategyOf(row: JobRow, handler: JobHandler): RecoveryStrategy {
  return row.recovery ?? handler.recovery
}

/**
 * Cancels the previous launch's rows of one type that recover by `abandon`.
 * JobManager runs it as soon as both the leftover snapshot and the type's
 * handler exist. A type can be neither enqueued nor executed before its handler
 * registers, so no code of this launch has claimed these rows, deduplicated an
 * enqueue against them, or awaited them yet: a bare cancel leaves nobody
 * waiting. `runStartupRecovery` reconciles the other strategies later.
 *
 * @param leftoverJobIds - Rows that were non-terminal when JobManager initialized
 */
export function abandonLeftovers(type: string, handler: JobHandler, leftoverJobIds: ReadonlySet<string>): void {
  try {
    const ids = jobService
      .getActiveByType(type)
      .filter((row) => leftoverJobIds.has(row.id) && strategyOf(row, handler) === 'abandon')
      .map((row) => row.id)
    if (ids.length === 0) return
    jobService.cancelByIds(ids, cancelledByRecovery)
    logger.info('Abandon recovery: cancelled leftovers', { type, count: ids.length })
  } catch (err) {
    logger.error('Abandon recovery failed', err as Error, { type })
  }
}

/**
 * Per-processor declarative recovery. Walks the registered handlers, applies
 * each type's `retry` or `singleton` strategy to its non-terminal jobs (a job
 * enqueued with its own `recovery` uses that instead), then handles orphan
 * running jobs whose handler is no longer registered. `abandon` leftovers are
 * already cancelled by `abandonLeftovers` when their handler registered.
 *
 * Current-launch exclusion: rows the CURRENT process owns (reported via
 * `isOwnedByCurrentLaunch`) are filtered out up front, before any strategy or
 * the cancelRequested override. Recovery exists to reconcile leftovers from a
 * PRIOR process. A job enqueued during the startup quiet window is owned by this
 * process whether it is running, queued behind its concurrency cap, or waiting
 * out a retry backoff when the sweep fires, and so is a leftover this process
 * already picked up. Touching either breaks it: the retry/singleton reset would
 * re-dispatch a running job (running it twice), and cancelRequested would race a
 * second terminal write against its live handler (#16291). `cancel()` already
 * owns cancellation of this process's jobs, so excluding them from every branch
 * is safe.
 *
 * Step order matters: cancelRequested=true overrides any strategy — those
 * jobs are cancelled regardless. The strategy then applies to the rest.
 *
 * Write serialization note: `jobService.cancelByIds` / `resetToPendingByIds`
 * are thin wrappers over `DbService.withWriteTx`, so each call below is
 * already serialized against concurrent JobManager writes through Layer 0's
 * synchronous `BEGIN IMMEDIATE` write transaction. No explicit transaction composition is
 * needed here — recovery is restartable and per-handler iterations do not
 * require cross-call atomicity.
 *
 * @param handlers - Registered handler map (type → handler) defining each
 *   type's recovery strategy.
 * @param isOwnedByCurrentLaunch - Predicate returning true when the given jobId
 *   belongs to this process (enqueued by it, or already executing in it); such
 *   rows are excluded from all recovery actions.
 */
export function runStartupRecovery(
  handlers: ReadonlyMap<string, JobHandler>,
  isOwnedByCurrentLaunch: (jobId: string) => boolean
): RecoveryStats {
  const stats: RecoveryStats = { cancelled: 0, pendingReset: 0, delayedKept: 0, singletonKept: 0 }

  for (const [type, handler] of handlers) {
    const rows = jobService.getActiveByType(type)
    // Above the cancelRequested override and every strategy, so none of them
    // ever touches a job of this process (#16291).
    const active = rows.filter((r) => !isOwnedByCurrentLaunch(r.id))
    if (active.length === 0) continue

    // 1. cancelRequested → cancelled, regardless of strategy. Includes pending
    //    so a row whose cancelRequested=true flag was flipped between the
    //    cancel tx and a process crash is not silently resurrected by the
    //    next dispatch tick (the WHERE in claimNextPendingTx now excludes
    //    cancelRequested=true rows from being claimed, but a leftover row
    //    must still be reduced to a terminal state here).
    //    finishedAt gets sweep time (the real transition); read models order
    //    cancelled runs by cancelRequestedAt, so the late settle reorders nothing.
    const cancelRequestedIds = active
      .filter((r) => r.cancelRequested && (r.status === 'running' || r.status === 'delayed' || r.status === 'pending'))
      .map((r) => r.id)
    if (cancelRequestedIds.length) {
      jobService.cancelByIds(cancelRequestedIds, cancelledByRecovery)
      stats.cancelled += cancelRequestedIds.length
      logger.info('Cancelled jobs with cancelRequested=true', { type, count: cancelRequestedIds.length })
    }

    const cancelRequestedSet = new Set(cancelRequestedIds)
    const remaining = active.filter((r) => !cancelRequestedSet.has(r.id))

    // 2. Apply each row's strategy to the rest: the job's own override, else its handler's.
    const retried = remaining.filter((r) => strategyOf(r, handler) === 'retry')
    const singletons = remaining.filter((r) => strategyOf(r, handler) === 'singleton')

    if (retried.length) {
      const runningIds = retried.filter((r) => r.status === 'running').map((r) => r.id)
      const delayedCount = retried.filter((r) => r.status === 'delayed').length
      if (runningIds.length) {
        jobService.resetToPendingByIds(runningIds)
        stats.pendingReset += runningIds.length
      }
      stats.delayedKept += delayedCount
      if (runningIds.length || delayedCount) {
        logger.info('Retry recovery', { type, reset: runningIds.length, delayedKept: delayedCount })
      }
    }
    if (singletons.length) {
      // An instance this launch owns supersedes every leftover. Otherwise keep the newest one:
      // singletons keep the createdAt DESC order of the jobService read.
      const ownsInstance = rows.some((r) => isOwnedByCurrentLaunch(r.id) && strategyOf(r, handler) === 'singleton')
      const keep = ownsInstance ? undefined : singletons[0]
      if (keep?.status === 'running') {
        jobService.resetToPendingByIds([keep.id])
        stats.pendingReset += 1
      }
      if (keep) stats.singletonKept += 1
      const toCancelIds = singletons.filter((r) => r !== keep).map((r) => r.id)
      if (toCancelIds.length) {
        jobService.cancelByIds(toCancelIds, cancelledByRecovery)
        stats.cancelled += toCancelIds.length
      }
      logger.info('Singleton recovery', {
        type,
        keptId: keep?.id ?? null,
        keptStatus: keep?.status ?? null,
        cancelled: toCancelIds.length
      })
    }
  }

  // 3. Orphan non-terminal jobs — handler no longer registered. Covers
  // running (would block dispatch via active count), delayed (would be
  // promoted to pending but never run), and pending (would never be
  // claimed). All three should be cancelled so no row leaks indefinitely.
  const allActive = jobService.getStaleActive()
  const orphans = allActive.filter((r) => !handlers.has(r.type))
  const orphanIds = orphans.map((r) => r.id)
  if (orphanIds.length) {
    jobService.cancelByIds(orphanIds, {
      code: JOB_ERROR_CODES.CANCELLED,
      message: 'Orphan job: handler no longer registered',
      retryable: false
    })
    stats.cancelled += orphanIds.length
    logger.warn('Cancelled orphan non-terminal jobs (no handler registered)', {
      count: orphanIds.length,
      types: Array.from(new Set(orphans.map((r) => r.type))),
      statuses: Array.from(new Set(orphans.map((r) => r.status)))
    })
  }

  return stats
}
