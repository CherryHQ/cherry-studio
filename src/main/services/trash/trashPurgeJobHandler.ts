import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { assistantDataService } from '@data/services/AssistantService'
import { fileEntryService } from '@data/services/FileEntryService'
import { paintingService } from '@data/services/PaintingService'
import { promptService } from '@data/services/PromptService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import type { JobHandlerFor } from '@main/core/job/types'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    /** Trash retention purge. `emptyAll: true` = "empty trash now" (ignores retention). */
    'trash.purge': { emptyAll?: boolean }
  }
}

const logger = loggerService.withContext('TrashPurgeJobHandler')

/** Rows hard-deleted per domain per write transaction. */
const PURGE_BATCH_SIZE = 500

const DAY_MS = 86_400_000

interface PurgeBatch {
  readonly purgedIds: readonly string[]
  readonly hasMore: boolean
  /** Run immediately after the batch's write transaction commits. */
  readonly notifyPurged: () => void
}

function completedPurgeBatch(purgedIds: readonly string[], hasMore: boolean, notifyPurged: () => void): PurgeBatch {
  return { purgedIds, hasMore, notifyPurged }
}

/**
 * RFC §6 purge order — containers before independent rows: topic (messages
 * cascade via purge path) → session (session messages FK-cascade) → agent →
 * assistant → painting → file entry. Messages are never moved to the Recycle Bin on their own,
 * so they have no domain here. Each domain owns its purge operation; disk reclamation
 * happens in the post-commit sweeps.
 */
const PURGE_DOMAINS: ReadonlyArray<{
  name: string
  purgeExpired: (cutoffMs: number, limit: number) => PurgeBatch | Promise<PurgeBatch>
}> = [
  {
    name: 'topic',
    purgeExpired: (cutoffMs, limit) => {
      const purgedIds = application
        .get('DbService')
        .withWriteTx((tx) => topicService.purgeExpiredTx(tx, cutoffMs, limit))
      return completedPurgeBatch(purgedIds, purgedIds.length === limit, () => topicService.notifyPurged(purgedIds))
    }
  },
  {
    name: 'session',
    purgeExpired: async (cutoffMs, limit) => {
      const batch = await application.get('AgentLifecycleService').purgeExpiredSessions(cutoffMs, limit)
      return completedPurgeBatch(batch.purgedIds, batch.hasMore, () => {})
    }
  },
  {
    name: 'agent',
    purgeExpired: async (cutoffMs, limit) => {
      const batch = await application.get('AgentLifecycleService').purgeExpiredAgents(cutoffMs, limit)
      return completedPurgeBatch(batch.purgedIds, batch.hasMore, () => {})
    }
  },
  {
    name: 'assistant',
    purgeExpired: (cutoffMs, limit) => {
      const purgedIds = application
        .get('DbService')
        .withWriteTx((tx) => assistantDataService.purgeExpiredTx(tx, cutoffMs, limit))
      return completedPurgeBatch(purgedIds, purgedIds.length === limit, () => {
        assistantDataService.notifyReadModelChange(purgedIds, 'membership')
        promptService.notifyTargetBindingsChanged()
      })
    }
  },
  {
    name: 'painting',
    purgeExpired: (cutoffMs, limit) => {
      const purgedIds = application
        .get('DbService')
        .withWriteTx((tx) => paintingService.purgeExpiredTx(tx, cutoffMs, limit))
      return completedPurgeBatch(purgedIds, purgedIds.length === limit, () =>
        paintingService.notifyReadModelChange(purgedIds, 'membership')
      )
    }
  },
  {
    name: 'fileEntry',
    purgeExpired: (cutoffMs, limit) => {
      const purgedIds = application
        .get('DbService')
        .withWriteTx((tx) => fileEntryService.purgeExpiredTx(tx, cutoffMs, limit))
      return completedPurgeBatch(purgedIds, purgedIds.length === limit, () =>
        notifyDataApiDataChange([
          { endpoint: '/files/entries', kind: 'membership', entityIds: purgedIds },
          { endpoint: '/files/entries/:id', entityIds: purgedIds }
        ])
      )
    }
  }
]

/**
 * Hard-deletes trashed rows whose retention window has expired, then reclaims
 * orphaned disk artifacts (file blobs + agent directories).
 *
 * Recovery 'singleton': after a restart only the newest non-terminal purge
 * survives — one full sweep covers everything an older queued run would have
 * done.
 */
export const trashPurgeJobHandler: JobHandlerFor<'trash.purge'> = {
  recovery: 'singleton',
  defaultConcurrency: 1,
  async execute(ctx) {
    const emptyAll = ctx.input?.emptyAll === true
    const retentionDays = application.get('PreferenceService').get('data.trash.retention_days')
    // Retention 0 disables the row purge, not disk reclamation: permanent deletes still
    // strand runtime state, and skipping the sweeps would leave it there forever.
    const retentionDisabled = !emptyAll && retentionDays === 0
    if (retentionDisabled) logger.info('Trash auto-purge disabled (retention_days = 0) — sweeping residue only')

    // MAX_SAFE_INTEGER + strict `deletedAt < cutoff` captures rows moved to the Recycle Bin "now".
    const cutoffMs = emptyAll ? Number.MAX_SAFE_INTEGER : Date.now() - retentionDays * DAY_MS
    const totalSteps = PURGE_DOMAINS.length + 3 // + task schedule, file, and agent-dir sweeps
    const purged: Record<string, number> = {}

    for (const [index, domain] of retentionDisabled ? [] : PURGE_DOMAINS.entries()) {
      ctx.signal.throwIfAborted()
      const purgedIds: string[] = []
      let batch: PurgeBatch
      // DB-only domains keep each synchronous transaction short; Session additionally
      // drains its runtime before entering the transaction.
      do {
        // One batch is the cancellation boundary; a Session runtime drain is allowed
        // to finish before the next check.
        ctx.signal.throwIfAborted()
        batch = await domain.purgeExpired(cutoffMs, PURGE_BATCH_SIZE)
        purgedIds.push(...batch.purgedIds)
        // A later batch may fail after this transaction has already committed.
        if (batch.purgedIds.length > 0) batch.notifyPurged()
      } while (batch.hasMore)
      purged[domain.name] = purgedIds.length
      ctx.reportProgress(Math.round(((index + 1) / totalSteps) * 100))
    }
    const retainedReferencedFileCount = emptyAll ? fileEntryService.getStats().trashTotal : 0

    // Schedule reconciliation strictly AFTER all transactions committed. It runs even
    // when retention is disabled so an interrupted event cleanup heals on the next pass.
    ctx.signal.throwIfAborted()
    await application.get('AgentLifecycleService').reconcile()
    ctx.reportProgress(Math.round(((PURGE_DOMAINS.length + 1) / totalSteps) * 100))

    // Filesystem reclamation strictly AFTER all transactions committed.
    // Failures are logged, never thrown — the DB rows are already gone and any
    // disk residue is picked up by the next purge run's sweeps.
    ctx.signal.throwIfAborted()
    // The sweeps walk the whole agents/files tree, so a cancel arriving here would
    // otherwise go unobserved until they finish.
    let reclaimed = true
    try {
      const report = await application.get('FileManager').runSweep()
      // The sweep aborts itself when the residue looks like a restore, and caps entry
      // cleanup per pass — reporting an unqualified success would hide leftover blobs.
      if (report.outcome !== 'completed' || report.entryCleanup.hasPendingWork) {
        reclaimed = false
        logger.warn('File orphan sweep did not reclaim everything', {
          outcome: report.outcome,
          entryCleanup: report.entryCleanup
        })
      }
    } catch (error) {
      if (ctx.signal.aborted) throw error
      reclaimed = false
      logger.warn('File orphan sweep failed — residue retried next purge run', { error })
    }
    ctx.reportProgress(Math.round(((PURGE_DOMAINS.length + 2) / totalSteps) * 100))

    ctx.signal.throwIfAborted()
    try {
      const { failedDrivers } = await application.get('AgentLifecycleService').sweepOrphans(ctx.signal)
      if (failedDrivers.length > 0) {
        reclaimed = false
        logger.warn('Agent orphan sweep left runtime residue', { failedDrivers })
      }
    } catch (error) {
      // A cancel is not residue — let it surface so the job settles as cancelled.
      if (ctx.signal.aborted) throw error
      reclaimed = false
      logger.warn('Agent orphan sweep failed — residue retried next purge run', { error })
    }
    ctx.reportProgress(100)

    logger.info('Trash purge complete', {
      emptyAll,
      purged,
      reclaimed,
      retainedReferencedFileCount,
      retentionDisabled
    })
    return { skipped: retentionDisabled, purged, reclaimed, retainedReferencedFileCount }
  }
}
