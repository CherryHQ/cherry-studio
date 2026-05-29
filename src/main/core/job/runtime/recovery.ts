import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import type { JobError } from '@shared/data/api/schemas/jobs'

import { JOB_ERROR_CODES } from '../errorCodes'
import type { JobHandler } from '../types'

const logger = loggerService.withContext('JobRecovery')

export interface RecoveryStats {
  cancelled: number
  pendingReset: number
  delayedKept: number
  singletonKept: number
}

/**
 * Per-processor declarative recovery. Walks the registered handlers, applies
 * each type's `recovery` strategy to its non-terminal jobs, then handles
 * orphan running jobs whose handler is no longer registered.
 *
 * Step order matters: cancelRequested=true overrides any strategy — those
 * jobs are cancelled regardless. The strategy then applies to the rest.
 *
 * Write serialization note: `jobService.cancelByIds` / `resetToPendingByIds`
 * are thin wrappers over `DbService.withWriteTx`, so each call below is
 * already serialized against concurrent JobManager writes through the
 * process-wide write mutex (Layer 0). No explicit transaction composition is
 * needed here — recovery is restartable and per-handler iterations do not
 * require cross-call atomicity.
 */
export async function runStartupRecovery(handlers: ReadonlyMap<string, JobHandler>): Promise<RecoveryStats> {
  const stats: RecoveryStats = { cancelled: 0, pendingReset: 0, delayedKept: 0, singletonKept: 0 }
  const cancelledByRecovery: JobError = {
    code: JOB_ERROR_CODES.CANCELLED,
    message: 'Cancelled by startup recovery',
    retryable: false
  }

  for (const [type, handler] of handlers) {
    const active = await jobService.getActiveByType(type)
    if (active.length === 0) continue

    // 1. cancelRequested → cancelled, regardless of strategy. Includes pending
    //    so a row whose cancelRequested=true flag was flipped between the
    //    cancel tx and a process crash is not silently resurrected by the
    //    next dispatch tick (the WHERE in claimNextPendingTx now excludes
    //    cancelRequested=true rows from being claimed, but a leftover row
    //    must still be reduced to a terminal state here).
    const cancelRequestedIds = active
      .filter((r) => r.cancelRequested && (r.status === 'running' || r.status === 'delayed' || r.status === 'pending'))
      .map((r) => r.id)
    if (cancelRequestedIds.length) {
      await jobService.cancelByIds(cancelRequestedIds, cancelledByRecovery)
      stats.cancelled += cancelRequestedIds.length
      logger.info('Cancelled jobs with cancelRequested=true', { type, count: cancelRequestedIds.length })
    }

    const cancelRequestedSet = new Set(cancelRequestedIds)
    const remaining = active.filter((r) => !cancelRequestedSet.has(r.id))

    // 2. Apply strategy to the rest.
    if (handler.recovery === 'abandon') {
      const ids = remaining.map((r) => r.id)
      if (ids.length) {
        await jobService.cancelByIds(ids, cancelledByRecovery)
        stats.cancelled += ids.length
        logger.info('Abandon recovery: cancelled non-terminal', { type, count: ids.length })
      }
    } else if (handler.recovery === 'retry') {
      const runningIds = remaining.filter((r) => r.status === 'running').map((r) => r.id)
      const delayedCount = remaining.filter((r) => r.status === 'delayed').length
      if (runningIds.length) {
        await jobService.resetToPendingByIds(runningIds)
        stats.pendingReset += runningIds.length
      }
      stats.delayedKept += delayedCount
      if (runningIds.length || delayedCount) {
        logger.info('Retry recovery', { type, reset: runningIds.length, delayedKept: delayedCount })
      }
    } else if (handler.recovery === 'singleton') {
      if (remaining.length === 0) continue
      // remaining is already sorted by createdAt DESC (jobService contract).
      const keep = remaining[0]
      if (keep.status === 'running') {
        await jobService.resetToPendingByIds([keep.id])
        stats.pendingReset += 1
      }
      stats.singletonKept += 1
      const toCancelIds = remaining.slice(1).map((r) => r.id)
      if (toCancelIds.length) {
        await jobService.cancelByIds(toCancelIds, cancelledByRecovery)
        stats.cancelled += toCancelIds.length
      }
      logger.info('Singleton recovery', {
        type,
        keptId: keep.id,
        keptStatus: keep.status,
        cancelled: toCancelIds.length
      })
    }
  }

  // 3. Orphan non-terminal jobs — handler no longer registered. Covers
  // running (would block dispatch via active count), delayed (would be
  // promoted to pending but never run), and pending (would never be
  // claimed). All three should be cancelled so no row leaks indefinitely.
  const allActive = await jobService.getStaleActive()
  const orphans = allActive.filter((r) => !handlers.has(r.type))
  const orphanIds = orphans.map((r) => r.id)
  if (orphanIds.length) {
    await jobService.cancelByIds(orphanIds, {
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
